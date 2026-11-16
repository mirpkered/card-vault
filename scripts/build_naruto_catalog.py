#!/usr/bin/env python3
"""Build a public Kayou Naruto catalog from NarutoDB's North American set API.

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
SET_ORDER = ("NRSA01", "NRSA02", "NRSA03", "NREA01", "NREA02", "NRCCNA", "NRSA04", "NREA03")
SETS = {
    "NRSA01": {
        "title": "Heaven Scroll", "count": 159,
        "rarities": {"SE": 4, "BP": 7, "SP": 4, "MR": 6, "PU": 8, "UR": 15, "SSR": 24, "SR": 20, "PTR": 20, "R": 50, "PR": 1},
    },
    "NRSA02": {
        "title": "Chapter Jin", "count": 172,
        "rarities": {"SE": 4, "AR": 10, "BP": 7, "SP": 4, "MR": 7, "PU": 8, "UR": 15, "SSR": 23, "SR": 20, "PTR": 20, "R": 50, "PR": 4},
    },
    "NRSA03": {
        "title": "Chapter Jin 3", "count": 187,
        "rarities": {"◇ASP": 8, "ASP": 8, "◇UR": 11, "SE": 4, "AR": 6, "BP": 7, "MR": 8, "PU": 8, "UR": 15, "SSR": 20, "SR": 20, "HR": 20, "R": 50, "PR": 2},
    },
    "NREA01": {
        "title": "Earth Scroll", "count": 132,
        "rarities": {"AR": 10, "SP": 4, "CR": 4, "MR": 4, "UR": 15, "SSR": 24, "SR": 20, "R": 50, "PR": 1},
    },
    "NREA02": {
        "title": "Earth Scroll 2", "count": 133,
        "rarities": {"CR": 4, "◇UR": 4, "AR": 10, "MR": 4, "UR": 15, "SSR": 25, "SR": 20, "R": 50, "PR": 1},
    },
    "NRCCNA": {
        "title": "Ninja Age", "count": 110,
        "rarities": {"◇QR": 1, "◇XR": 7, "◇MR": 2, "QR": 9, "XR": 6, "MR": 8, "SP": 11, "PTR": 20, "UR": 22, "SSR": 20, "PR": 2, "◇PR": 2},
    },
    "NRSA04": {
        "title": "Chapter Jin 4", "count": 186,
        "rarities": {"SE": 4, "◇SP": 8, "SP": 8, "AR": 8, "BP": 5, "MR": 8, "PU": 6, "HR": 20, "◇UR": 12, "UR": 24, "SSR": 13, "SR": 20, "R": 50},
    },
    "NREA03": {
        "title": "Earth Scroll 3", "count": 123,
        "rarities": {"CR": 4, "SP": 4, "MR": 4, "UR": 15, "SSR": 25, "SR": 20, "R": 50, "PR": 1},
    },
}
RARITY_ID_PREFIX = {
    "◇UR": "PARALLEL_UR",
    "◇ASP": "DIAMOND_ASP",
    "◇QR": "DIAMOND_QR",
    "◇XR": "DIAMOND_XR",
    "◇MR": "DIAMOND_MR",
    "◇SP": "DIAMOND_SP",
    "◇PR": "DIAMOND_PR",
}
PROMO_RARITIES = {"PR", "◇PR"}
INVENTORY_SET_CODES = {"NREA02", "NREA03"}
SOURCE_PAGES = {code: f"https://narutodb.com/kayou/sets/{code}" for code in SET_ORDER}
TRACKED_BY_DEFAULT = {"NREA02", "NREA03"}


def get_json(url: str):
    request = Request(url, headers={"User-Agent": "CollectEverything catalog importer/1.0"})
    with urlopen(request, timeout=30) as response:
        if response.status != 200:
            raise ValueError(f"{url} returned HTTP {response.status}.")
        return json.load(response)


def set_id(code: str) -> str:
    return f"set:kayou-naruto-{code.lower()}"


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
        is_promo = rarity in PROMO_RARITIES
        if bool(row.get("is_promo")) != is_promo:
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
            "setId": set_id(code),
            "provisionalNumber": inventory_slot,
            "number": card_number,
            "name": name.strip(),
            "rarity": rarity,
            "imageUrl": image_url,
            "isPromo": is_promo,
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
    inventory_set_ids = {set_id(code) for code in INVENTORY_SET_CODES}
    existing = {card["id"] for card in private["catalog"]["cards"] if card.get("setId") in inventory_set_ids}
    expected = {card["id"] for card in cards if card["setId"] in inventory_set_ids and not card["isPromo"]}
    if existing != expected:
        missing = sorted(existing ^ expected)[:5]
        raise ValueError(f"Naruto catalog IDs do not align with the local inventory package: {missing}.")
    for card in private["catalog"]["cards"]:
        if card.get("setId") in inventory_set_ids and card.get("name"):
            raise ValueError("Expected the supplied backup to contain unnamed provisional NREA02/NREA03 rows.")


def main() -> None:
    cards = []
    sets = []
    for code in SET_ORDER:
        info = SETS[code]
        cards.extend(build_set(code))
        sets.append({
            "id": set_id(code),
            "code": code,
            "title": info["title"],
            "displayName": f"{code} · {info['title']}",
            "cardCount": info["count"],
            "rarityScheme": list(info["rarities"]),
            "rarityCounts": info["rarities"],
            "trackedByDefault": code in TRACKED_BY_DEFAULT,
            "sourceUrl": SOURCE_PAGES[code],
        })
    validate_private_inventory(cards)
    result = {
        "schemaVersion": 2,
        "source": "NarutoDB",
        "market": "North America",
        "cataloguedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "sourcePages": SOURCE_PAGES,
        "sets": sets,
        "cards": cards,
    }
    output = ROOT / "public" / "naruto-catalog.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    images = sum(bool(card["imageUrl"]) for card in cards)
    print(f"Validated {len(sets)} North American sets and {len(cards)} cards; {images} have exact NarutoDB image links. Wrote {output}.")


if __name__ == "__main__":
    main()
