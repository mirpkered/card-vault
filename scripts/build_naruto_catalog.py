#!/usr/bin/env python3
"""Build a public Naruto catalog enrichment file from NarutoDB's public card API.

Only names, canonical card codes, rarity labels, and remote thumbnail URLs are written.
The private inventory backup is used only for optional ID alignment validation and is
never copied into the output.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
API_BASE = "https://api.narutodb.com"
SETS = {
    "NREA02": {
        "id": "set:kayou-naruto-nrea02",
        "count": 133,
        "rarities": {"CR": 4, "◇UR": 4, "AR": 10, "MR": 4, "UR": 15, "SSR": 25, "SR": 20, "R": 50, "PR": 1},
    },
    "NREA03": {
        "id": "set:kayou-naruto-nrea03",
        "count": 123,
        "rarities": {"CR": 4, "SP": 4, "MR": 4, "UR": 15, "SSR": 25, "SR": 20, "R": 50, "PR": 1},
    },
}
RARITY_ID_PREFIX = {"◇UR": "PARALLEL_UR"}
SOURCE_PAGES = {
    code: f"https://narutodb.com/kayou/sets/{code}"
    for code in SETS
}


def get_json(url: str):
    request = Request(url, headers={"User-Agent": "CollectEverything catalog importer/1.0"})
    with urlopen(request, timeout=30) as response:
        if response.status != 200:
            raise ValueError(f"{url} returned HTTP {response.status}.")
        return json.load(response)


def build_set(code: str) -> list[dict]:
    info = SETS[code]
    payload = get_json(f"{API_BASE}/api/sets/{code}/cards")
    if not isinstance(payload, list) or len(payload) != info["count"]:
        raise ValueError(f"{code} returned {len(payload) if isinstance(payload, list) else 'invalid'} cards; expected {info['count']}.")
    counts = Counter()
    seen_numbers = set()
    cards = []
    for row in payload:
        if row.get("set_id") != code:
            raise ValueError(f"{code} response contains a card from {row.get('set_id')!r}.")
        rarity = row.get("rarity_code")
        slot_number = row.get("slot_number")
        card_number = row.get("card_number")
        name = row.get("character_name")
        if rarity not in info["rarities"]:
            raise ValueError(f"{code} has unexpected rarity {rarity!r}.")
        if not isinstance(slot_number, int) or slot_number < 1:
            raise ValueError(f"{code} has an invalid rarity slot.")
        if not isinstance(card_number, str) or not card_number.strip() or card_number in seen_numbers:
            raise ValueError(f"{code} has a blank or repeated canonical card number.")
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"{card_number} has no verified display name.")
        if bool(row.get("is_promo")) != (rarity == "PR"):
            raise ValueError(f"{card_number} has an inconsistent Promo flag.")
        counts[rarity] += 1
        seen_numbers.add(card_number)

        prefix = RARITY_ID_PREFIX.get(rarity, rarity)
        inventory_slot = f"{prefix}{slot_number:03d}"
        image_url = row.get("image_thumb_url")
        if row.get("image_is_stand_in"):
            image_url = None
        elif image_url:
            parsed = urlparse(image_url)
            if parsed.scheme != "https" or parsed.hostname != "cdn.narutodb.com":
                raise ValueError(f"{card_number} uses an unexpected image host.")
        else:
            image_url = None

        cards.append({
            "id": f"kayou-naruto:{code}:{inventory_slot}",
            "setId": info["id"],
            "provisionalNumber": inventory_slot,
            "number": card_number,
            "name": name.strip(),
            "rarity": rarity,
            "imageUrl": image_url,
            "isPromo": rarity == "PR",
        })

    if counts != Counter(info["rarities"]):
        raise ValueError(f"{code} rarity totals differ: got {dict(counts)}, expected {info['rarities']}.")
    if len({card["id"] for card in cards}) != info["count"]:
        raise ValueError(f"{code} produced duplicate app IDs.")
    return cards


def validate_private_inventory(cards: list[dict]) -> None:
    private_path = ROOT / "private-data" / "card-vault-naruto-import.json"
    if not private_path.exists():
        return
    private = json.loads(private_path.read_text(encoding="utf-8-sig"))
    existing = {card["id"] for card in private["catalog"]["cards"]}
    expected = {card["id"] for card in cards if not card["isPromo"]}
    if existing != expected:
        missing = sorted(existing ^ expected)[:5]
        raise ValueError(f"Naruto catalog IDs do not align with the local inventory package: {missing}.")
    for card in private["catalog"]["cards"]:
        if card.get("name") or card.get("id") not in expected:
            raise ValueError("Expected the supplied backup to contain unnamed provisional card rows.")


def main() -> None:
    cards = []
    sets = []
    for code, info in SETS.items():
        cards.extend(build_set(code))
        sets.append({
            "id": info["id"],
            "name": code,
            "cardCount": info["count"],
            "sourceUrl": SOURCE_PAGES[code],
        })
    validate_private_inventory(cards)
    result = {
        "schemaVersion": 1,
        "source": "NarutoDB",
        "cataloguedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "sourcePages": SOURCE_PAGES,
        "sets": sets,
        "cards": cards,
    }
    output = ROOT / "public" / "naruto-catalog.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Validated {len(cards)} Naruto catalog entries ({len(cards) - 2} existing slots and 2 Promo cards); wrote {output}.")


if __name__ == "__main__":
    main()
