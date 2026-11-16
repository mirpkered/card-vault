#!/usr/bin/env python3
"""Validate a provisional Naruto inventory ZIP and convert it to a Collect Everything backup."""

from __future__ import annotations

import argparse
import csv
import io
import json
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


EXPECTED_RARITIES = {
    "NREA02": {"R": 50, "SR": 20, "SSR": 25, "UR": 15, "MR": 4, "PARALLEL_UR": 4, "AR": 10, "CR": 4},
    "NREA03": {"R": 50, "SR": 20, "SSR": 25, "UR": 15, "MR": 4, "SP": 4, "CR": 4},
}
RARITY_LABELS = {"PARALLEL_UR": "◇UR"}
SET_IDS = {
    "NREA02": "set:kayou-naruto-nrea02",
    "NREA03": "set:kayou-naruto-nrea03",
}
JSON_ENTRY = "card-vault-naruto-nrea02-nrea03.json"
CSV_ENTRY = "card-vault-naruto-nrea02-nrea03.csv"
FORMAT = "card-vault-provisional-inventory"
SOURCE_NOTE = "Provisional rarity index; exact card name and printed number are unverified. Duplicate quantity was not supplied."


def fail(message: str) -> None:
    raise SystemExit(f"Import validation failed: {message}")


def read_package(path: Path) -> tuple[dict, list[dict[str, str]]]:
    try:
        with zipfile.ZipFile(path) as archive:
            names = set(archive.namelist())
            if JSON_ENTRY not in names or CSV_ENTRY not in names:
                fail(f"ZIP must contain {JSON_ENTRY} and {CSV_ENTRY}.")
            package = json.loads(archive.read(JSON_ENTRY))
            rows = list(csv.DictReader(io.StringIO(archive.read(CSV_ENTRY).decode("utf-8-sig"))))
    except (OSError, zipfile.BadZipFile, UnicodeDecodeError, json.JSONDecodeError, csv.Error) as exc:
        fail(f"could not read package: {exc}")
    return package, rows


def validate_package(package: dict, csv_rows: list[dict[str, str]]) -> tuple[dict, dict]:
    if package.get("format") != FORMAT or package.get("schema_version") != 1:
        fail("unsupported package format or schema version.")
    if package.get("catalog_verification") != "pending":
        fail("expected an explicitly provisional catalog package.")

    set_rows = package.get("sets")
    if not isinstance(set_rows, list) or {x.get("set_id") for x in set_rows} != set(EXPECTED_RARITIES):
        fail("package must contain NREA02 and NREA03 set summaries.")
    set_summary = {x["set_id"]: x for x in set_rows}
    cards = package.get("cards")
    if not isinstance(cards, list):
        fail("cards must be an array.")

    ids: set[str] = set()
    by_set_rarity: dict[tuple[str, str], list[dict]] = defaultdict(list)
    status_counts: dict[str, Counter] = defaultdict(Counter)
    for index, card in enumerate(cards, start=1):
        set_id = card.get("set_id")
        rarity = card.get("rarity")
        number = card.get("number_in_rarity")
        card_number = card.get("card_number")
        card_id = card.get("card_id")
        if set_id not in EXPECTED_RARITIES:
            fail(f"row {index}: unknown set {set_id!r}.")
        if rarity not in EXPECTED_RARITIES[set_id]:
            fail(f"row {index}: unexpected rarity {rarity!r} in {set_id}.")
        if not isinstance(number, int) or number < 1 or card_number != f"{rarity}{number:03d}":
            fail(f"row {index}: rarity position and card number do not agree.")
        if card_id != f"kayou-naruto:{set_id}:{card_number}":
            fail(f"row {index}: card ID is not namespaced to its set and rarity position.")
        if card_id in ids:
            fail(f"duplicate card ID {card_id}.")
        ids.add(card_id)
        if card.get("card_name") or card.get("image_url") or card.get("catalog_verified") is not False:
            fail(f"row {index}: this converter only accepts unnamed, image-free provisional records.")

        owned = card.get("owned_quantity")
        incoming = card.get("incoming_quantity")
        status = card.get("status")
        if not all(isinstance(value, int) and value >= 0 for value in (owned, incoming)):
            fail(f"row {index}: quantities must be non-negative whole numbers.")
        expected_status = "owned" if owned else "incoming" if incoming else "missing"
        if status != expected_status or (owned and incoming):
            fail(f"row {index}: status conflicts with physical and incoming quantities.")
        by_set_rarity[(set_id, rarity)].append(card)
        status_counts[set_id][status] += 1

    for set_id, rarity_counts in EXPECTED_RARITIES.items():
        expected_total = sum(rarity_counts.values())
        if set_summary[set_id].get("expected_total") != expected_total:
            fail(f"{set_id} expected total does not match Kayou's published total {expected_total}.")
        for rarity, expected_count in rarity_counts.items():
            group = by_set_rarity.get((set_id, rarity), [])
            positions = sorted(card["number_in_rarity"] for card in group)
            if len(group) != expected_count or positions != list(range(1, expected_count + 1)):
                fail(f"{set_id} {rarity} positions/count do not match the published total {expected_count}.")
        set_cards = [card for card in cards if card["set_id"] == set_id]
        if len(set_cards) != expected_total:
            fail(f"{set_id} contains {len(set_cards)} records; expected {expected_total}.")
        observed = {
            "owned": status_counts[set_id]["owned"],
            "incoming": status_counts[set_id]["incoming"],
            "missing": status_counts[set_id]["missing"],
        }
        stated = set_summary[set_id].get("counts", {})
        if sum(observed.values()) != expected_total or any(stated.get(key, 0) != value for key, value in observed.items()):
            fail(f"{set_id} summary counts do not match its card rows.")

    # The companion CSV is required to describe the same records as the JSON.
    json_by_id = {card["card_id"]: card for card in cards}
    if len(csv_rows) != len(cards) or len({row.get("card_id") for row in csv_rows}) != len(cards):
        fail("companion CSV must contain the same unique card rows as the JSON.")
    for row in csv_rows:
        card = json_by_id.get(row.get("card_id", ""))
        if not card:
            fail(f"companion CSV contains unknown card ID {row.get('card_id')!r}.")
        for csv_key, json_key in (
            ("publisher", "publisher"), ("series", "series"), ("set_id", "set_id"),
            ("rarity", "rarity"), ("card_number", "card_number"),
            ("number_in_rarity", "number_in_rarity"), ("status", "status"),
            ("owned_quantity", "owned_quantity"), ("incoming_quantity", "incoming_quantity"),
            ("card_name", "card_name"), ("image_url", "image_url"),
            ("catalog_verified", "catalog_verified"), ("source", "source"),
        ):
            if row.get(csv_key) != str(card.get(json_key, "")):
                fail(f"JSON and CSV disagree for {card['card_id']} in {csv_key}.")

    return set_summary, status_counts


def to_vault(package: dict) -> dict:
    updated_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    cards: list[dict] = []
    ownership: list[dict] = []
    acquisitions: list[dict] = []
    for row in package["cards"]:
        card_id = row["card_id"]
        set_id = row["set_id"]
        cards.append({
            "id": card_id,
            "setId": SET_IDS[set_id],
            "number": row["card_number"],
            "name": "",
            "rarity": RARITY_LABELS.get(row["rarity"], row["rarity"]),
            "sourceNote": SOURCE_NOTE,
        })
        physical = row["owned_quantity"]
        incoming = row["incoming_quantity"]
        if physical or incoming:
            ownership.append({
                "cardId": card_id,
                "personal": physical,
                "duplicates": 0,
                "duplicatesKnown": not bool(physical),
                "incoming": incoming,
                "updatedAt": updated_at,
            })
        if incoming:
            acquisitions.append({
                "id": f"acquisition:{card_id}:incoming-import",
                "cardId": card_id,
                "quantity": incoming,
                "status": "incoming",
                "note": "Source package marks this quantity as purchased and not yet received; purchase details were not supplied.",
            })

    return {
        "schemaVersion": 2,
        "updatedAt": updated_at,
        "catalog": {
            "publishers": [{"id": "publisher:kayou", "name": "Kayou"}],
            "franchises": [{"id": "franchise:naruto", "publisherId": "publisher:kayou", "name": "Naruto"}],
            "series": [{"id": "series:kayou-naruto", "franchiseId": "franchise:naruto", "name": "Kayou Naruto"}],
            # Keep these identical to the app's starter records so a restore merges cleanly.
            "sets": [
                {"id": SET_IDS[set_id], "seriesId": "series:kayou-naruto", "name": set_id}
                for set_id in EXPECTED_RARITIES
            ],
            "cards": cards,
            "variants": [],
            "ownership": ownership,
            "acquisitions": acquisitions,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package_zip", type=Path)
    parser.add_argument("output_json", type=Path)
    args = parser.parse_args()

    package, csv_rows = read_package(args.package_zip)
    summaries, statuses = validate_package(package, csv_rows)
    vault = to_vault(package)
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(vault, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Validated {len(vault['catalog']['cards'])} card positions; wrote {args.output_json}.")
    for set_id in EXPECTED_RARITIES:
        print(
            f"{set_id}: {summaries[set_id]['expected_total']} positions; "
            f"{statuses[set_id]['owned']} physical, {statuses[set_id]['incoming']} incoming, "
            f"{statuses[set_id]['missing']} missing."
        )
    print("Names, printed card numbers, and duplicate quantities remain unverified/unknown.")


if __name__ == "__main__":
    main()
