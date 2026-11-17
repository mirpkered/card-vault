#!/usr/bin/env python3
"""Convert the supplied SRG workbook into a Collect Everything backup.

Uses only Python's standard library and reads the source workbook without saving it.
The backup is personal inventory data; write it to the ignored private-data directory.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
import zipfile
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from xml.etree import ElementTree as ET

MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"m": MAIN, "r": REL, "p": PKG_REL}
EXPECTED = ["Title", "1", "2", "3", "4", "5"]


def col_index(reference: str) -> int:
    letters = re.match(r"[A-Z]+", reference)
    if not letters:
        raise ValueError(f"Invalid cell reference: {reference}")
    result = 0
    for char in letters.group():
        result = result * 26 + ord(char) - 64
    return result


def slug(value: str) -> str:
    plain = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    result = re.sub(r"[^a-z0-9]+", "-", plain).strip("-")
    return result or "untitled"


class WorkbookReader:
    def __init__(self, filename: Path):
        self.archive = zipfile.ZipFile(filename)
        workbook = ET.fromstring(self.archive.read("xl/workbook.xml"))
        relationships = ET.fromstring(self.archive.read("xl/_rels/workbook.xml.rels"))
        targets = {item.attrib["Id"]: item.attrib["Target"] for item in relationships}
        self.sheets = {}
        for sheet in workbook.findall("m:sheets/m:sheet", NS):
            target = targets[sheet.attrib[f"{{{REL}}}id"]].lstrip("/")
            if not target.startswith("xl/"):
                target = f"xl/{target}"
            self.sheets[sheet.attrib["name"]] = target
        strings_file = "xl/sharedStrings.xml"
        self.shared_strings = []
        if strings_file in self.archive.namelist():
            strings = ET.fromstring(self.archive.read(strings_file))
            self.shared_strings = [
                "".join(text.text or "" for text in item.findall(".//m:t", NS))
                for item in strings.findall("m:si", NS)
            ]
        style_root = ET.fromstring(self.archive.read("xl/styles.xml"))
        self.xfs = style_root.find("m:cellXfs", NS)
        self.fills = style_root.find("m:fills", NS)

    def cell_value(self, cell):
        if cell is None:
            return ""
        if cell.find("m:f", NS) is not None:
            raise ValueError(f"Formula cells are not supported for inventory import ({cell.attrib['r']}).")
        value = cell.find("m:v", NS)
        cell_type = cell.attrib.get("t")
        if cell_type == "s" and value is not None:
            return self.shared_strings[int(value.text)]
        if cell_type == "inlineStr":
            return "".join(text.text or "" for text in cell.findall(".//m:t", NS))
        return value.text if value is not None else ""

    def title_color(self, cell) -> str | None:
        style_id = int(cell.attrib.get("s", 0))
        fill_id = int(self.xfs[style_id].attrib.get("fillId", 0))
        fill = self.fills[fill_id]
        pattern = fill.find("m:patternFill", NS)
        if pattern is None or pattern.attrib.get("patternType") != "solid":
            return None
        foreground = pattern.find("m:fgColor", NS)
        return foreground.attrib.get("rgb", "").upper() if foreground is not None else None

    def read_rows(self, sheet_name: str):
        if sheet_name not in self.sheets:
            raise ValueError(f"Workbook is missing the required “{sheet_name}” sheet.")
        root = ET.fromstring(self.archive.read(self.sheets[sheet_name]))
        rows = {}
        for row in root.findall("m:sheetData/m:row", NS):
            rows[int(row.attrib["r"])] = {
                col_index(cell.attrib["r"]): cell
                for cell in row.findall("m:c", NS)
            }
        return rows


def number(value, cell: str) -> int:
    if value in (None, ""):
        return 0
    try:
        decimal = Decimal(str(value))
    except InvalidOperation as error:
        raise ValueError(f"{cell} must contain a number, got {value!r}.") from error
    if not decimal.is_finite() or decimal < 0 or decimal != decimal.to_integral_value():
        raise ValueError(f"{cell} must contain a non-negative whole quantity, got {value!r}.")
    return int(decimal)


def import_workbook(source: Path) -> tuple[dict, dict]:
    reader = WorkbookReader(source)
    rows = reader.read_rows("Switch Games")
    if reader.cell_value(rows.get(1, {}).get(1)).strip() != "Game":
        raise ValueError("Switch Games!A1 must be “Game”.")
    expected_headers = {2: "Card #", 3: "Personal", 4: "Dupes"}
    for column, label in expected_headers.items():
        if reader.cell_value(rows.get(2, {}).get(column)).strip() != label:
            raise ValueError(f"Switch Games row 2 column {column} must be “{label}”.")

    releases = []
    current = None
    for row_number, cells in sorted(rows.items()):
        if row_number < 3:
            continue
        title_cell = cells.get(1)
        title = reader.cell_value(title_cell).strip() if title_cell is not None else ""
        if title:
            color = reader.title_color(title_cell)
            indicator = "complete" if color == "FF00FF00" else "incomplete" if color == "FFFFFF00" else "unmarked"
            current = {"title": title, "row": row_number, "indicator": indicator, "slots": []}
            releases.append(current)
        slot_cell = cells.get(2)
        slot_value = reader.cell_value(slot_cell).strip() if slot_cell is not None else ""
        if slot_value:
            if current is None:
                raise ValueError(f"Card slot at row {row_number} is above the first release title.")
            try:
                slot_number = Decimal(slot_value)
                slot = str(int(slot_number)) if slot_number == slot_number.to_integral_value() else slot_value
            except InvalidOperation:
                slot = slot_value
            personal = number(reader.cell_value(cells.get(3)), f"C{row_number}")
            duplicates = number(reader.cell_value(cells.get(4)), f"D{row_number}")
            notes = []
            for column, cell in cells.items():
                if column >= 5:
                    value = str(reader.cell_value(cell)).strip()
                    if value:
                        if column != 5:
                            raise ValueError(f"Unexpected source data in {cell.attrib['r']}; review before import.")
                        notes.append(value)
            current["slots"].append({"number": slot, "row": row_number, "personal": personal, "duplicates": duplicates, "notes": notes})
        elif any(str(reader.cell_value(cell)).strip() for column, cell in cells.items() if column >= 3):
            raise ValueError(f"Source data found without a card number on row {row_number}.")

    title_ids = set()
    aggregate_set_id = "set:srg-switch:nintendo-switch-releases"
    release_records = [{
        "id": aggregate_set_id,
        "seriesId": "series:srg-switch",
        "name": "Nintendo Switch releases",
        "tracked": True,
    }]
    card_records = []
    ownership_records = []
    marker_mismatches = []
    unmarked = []
    totals = Counter()
    source_note_count = 0
    for release in releases:
        release_id = slug(release["title"])
        if release_id in title_ids:
            raise ValueError(f"Release titles collide after namespacing: {release['title']!r}.")
        title_ids.add(release_id)
        slots = release["slots"]
        by_number = {slot["number"]: slot for slot in slots}
        if len(slots) != 6 or len(by_number) != 6 or set(by_number) != set(EXPECTED):
            raise ValueError(f"{release['title']} (row {release['row']}) must have exactly Title and cards 1–5.")
        physically_complete = all(slot["personal"] + slot["duplicates"] > 0 for slot in slots)
        if release["indicator"] == "complete" and not physically_complete:
            marker_mismatches.append({"title": release["title"], "row": release["row"], "missing": [slot["number"] for slot in slots if slot["personal"] + slot["duplicates"] == 0]})
        if release["indicator"] == "incomplete" and physically_complete:
            marker_mismatches.append({"title": release["title"], "row": release["row"], "missing": []})
        if release["indicator"] == "unmarked":
            unmarked.append({"title": release["title"], "row": release["row"], "missing": [slot["number"] for slot in slots if slot["personal"] + slot["duplicates"] == 0]})
        for slot in slots:
            # Preserve the existing per-release namespaced IDs so importing into
            # older vaults can reconcile quantities without changing identity.
            card_id = f"set:srg-switch:{release_id}:{slot['number'].lower()}"
            card = {
                "id": card_id,
                "setId": aggregate_set_id,
                "number": slot["number"],
                "name": "Title card" if slot["number"] == "Title" else f"Card {slot['number']}",
                "category": "Title" if slot["number"] == "Title" else "Numbered",
                "slot": "title" if slot["number"] == "Title" else "numbered",
                "sourceRow": slot["row"],
                "releaseName": release["title"],
                "releaseSourceCompletionIndicator": release["indicator"],
                "releaseSourceRow": release["row"],
            }
            if slot["notes"]:
                card["sourceNote"] = " | ".join(slot["notes"])
                source_note_count += 1
            card_records.append(card)
            ownership_records.append({
                "cardId": card_id,
                "personal": slot["personal"],
                "duplicates": slot["duplicates"],
                "incoming": 0,
                "updatedAt": datetime.now(timezone.utc).isoformat(),
            })
            totals["personal"] += slot["personal"]
            totals["duplicates"] += slot["duplicates"]
            totals["uniqueOwned"] += int(slot["personal"] + slot["duplicates"] > 0)
            totals["duplicateCards"] += int(slot["duplicates"] > 0)

    catalog = {
        "publishers": [{"id": "publisher:super-rare-games", "name": "Super Rare Games"}],
        "franchises": [
            {"id": "franchise:nintendo-switch-release-cards", "publisherId": "publisher:super-rare-games", "name": "Nintendo Switch release cards"},
        ],
        "series": [
            {"id": "series:srg-switch", "franchiseId": "franchise:nintendo-switch-release-cards", "name": "Super Rare Games", "category": "cards"},
        ],
        "sets": release_records,
        "cards": card_records,
        "variants": [],
        "ownership": ownership_records,
        "acquisitions": [],
    }
    backup = {"schemaVersion": 6, "updatedAt": datetime.now(timezone.utc).isoformat(), "catalog": catalog}
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    report = {
        "source": source.name,
        "sha256": source_hash,
        "sheet": "Switch Games",
        "releaseCount": len(releases),
        "markerCounts": dict(Counter(release["indicator"] for release in releases)),
        "cardDefinitions": len(card_records),
        "personalQuantity": totals["personal"],
        "dupeQuantity": totals["duplicates"],
        "uniqueOwnedDefinitions": totals["uniqueOwned"],
        "duplicateCardDefinitions": totals["duplicateCards"],
        "sourceNotesPreserved": source_note_count,
        "markerMismatches": marker_mismatches,
        "unmarkedReleases": unmarked,
    }
    return backup, report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path, help="Source .xlsx. It will not be changed.")
    parser.add_argument("output", type=Path, help="Private Collect Everything JSON backup output path.")
    args = parser.parse_args()
    if not args.workbook.is_file():
        parser.error(f"Workbook not found: {args.workbook}")
    backup, report = import_workbook(args.workbook)
    errors = []
    cards = backup["catalog"]["cards"]
    sets = {item["id"] for item in backup["catalog"]["sets"]}
    card_ids = set()
    for card in cards:
        if card["setId"] not in sets:
            errors.append(f"Card {card['id']} has no set.")
        if card["id"] in card_ids:
            errors.append(f"Duplicate card ID {card['id']}.")
        card_ids.add(card["id"])
    if errors:
        raise ValueError("Import validation failed: " + " ".join(errors))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(backup, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report["output"] = str(args.output)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, zipfile.BadZipFile, KeyError) as error:
        print(f"Import failed: {error}", file=sys.stderr)
        raise SystemExit(1)
