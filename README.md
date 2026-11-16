# Collect Everything

Collect Everything is a local-first, image-focused collection manager for Cards, Media, and Misc collections. It runs as a standalone React + TypeScript + Vite PWA, is designed for iPhone portrait use, and remains usable on desktop. Kayou Naruto and Super Rare Games card collections are included, with a Square Enix sourced catalog for Final Fantasy TCG releases. An empty **SNL DVDs** media collection is created without inventing titles, images, or quantities; add DVD titles as you reconcile your collection.

## Run locally

```sh
npm install
npm run dev
```

The app persists its vault in IndexedDB in the current browser. No account is required. The service worker caches the application shell and a bounded number of remote images for offline use.

## Use the app

- Choose Cards, Media, or Misc from the archive categories, then open a collection and set/list.
- Use **Manage sets** to turn releases on or off. Hidden sets and their inventory remain saved; only tracked sets appear in navigation and collection progress.
- Add cards, DVD titles, or other collectible items and track physically owned, duplicate, and incoming quantities separately.
- The Gallery, List, and Checklist controls change presentation only. Search and status filters remain active across view changes.
- Completion counts unique item definitions that have at least one physically owned copy. Extra copies affect duplicate status and quantity, not completion.
- Naruto cards can be enriched with verified names, catalog card codes, and remote thumbnails from NarutoDB. Review and apply the update inside the app; it preserves your inventory quantities and user-added images. Thumbnails stay hosted remotely and are cached after viewing.
- Card details also accept user-provided image URLs. A URL marked “Verified” is stored with a timestamp; verify that it is the exact card before selecting that option.
- Super Rare Games imports preserve Personal and Dupes quantities separately, keep the workbook’s colored completion markers for review, and use six release slots (Title, 1–5). New release sets start with those six slots.

## Data model

Data is stored as a versioned JSON envelope (`schemaVersion`, `updatedAt`, `catalog`). Catalog entity IDs are stable namespaced strings, such as `publisher:kayou`, `set:kayou-naruto-nrea02`, and `set:kayou-naruto-nrea02:01`. Series are assigned a Cards, Media, or Misc category; a series may be independent of a publisher or franchise. The schema keeps publishers, franchises, series, sets/lists, canonical collectible definitions, variants and image sources, ownership, and acquisition records distinct. Ownership stores Personal, Dupes, and incoming counts separately. An optional `duplicatesKnown: false` marks an unreported duplicate quantity; it is shown as unknown instead of zero. Each set has a `tracked` flag, which controls whether it appears in navigation and progress without removing its catalog or inventory records. Completion counts unique definitions with a physically owned copy in tracked sets. Cards may use rarity tiers, while media and misc items do not require rarity. A migration upgrades schema v0–v3 to v4 and adds the blank SNL DVD collection if it is not present. Item identity uses the full namespaced ID, never a printed number or title alone.

`src/domain.ts` documents the TypeScript schema and validation rules. Schema migrations are centralized in `migrateVault`; increment `CURRENT_SCHEMA_VERSION` and add a migration before changing persisted structures. The shared `cards` JSON collection remains the current storage name for all catalog items to preserve existing backup compatibility; section/category metadata identifies the item type.

## Backup and import

- **JSON backup** includes the whole versioned catalog. Restore validates the schema, warns on conflicting overlapping records, and merges only non-conflicting IDs after confirmation. It never deletes records.
- **CSV export** contains `card_id,set_id,card_number,name,personal,duplicates,duplicates_known,incoming`.
- **CSV import** requires `card_id,personal,incoming` and accepts optional `duplicates` and `duplicates_known` columns. It accepts only known card IDs and non-negative whole quantities, and rejects malformed rows and duplicate IDs. It does not create card definitions.
- Keep a backup before moving browser profiles or devices. Clearing browser storage can remove the only local copy.

## GitHub Pages

The `.github/workflows/deploy.yml` workflow builds and publishes the `main` branch to GitHub Pages. The repository URL remains `card-vault` for stability; its Vite base path matches that URL. The shared private-sync app is served from [the Collect Everything Cloudflare Worker](https://collect-everything-private-sync.mirpkered.workers.dev/); use that address when signing in or opening the same collection on another browser.

On iPhone, open the app in Safari and use **Share → Add to Home Screen**. The Pages address remains local-only: browser storage is isolated by site, and this public repository never receives catalog quantities or access tokens. Private sync runs from the separate Cloudflare Worker address described below.

## Synchronization and security

The sync foundation serves the Vite app and `/api/*` from one Cloudflare Worker origin, following the Resale Tracker pattern. The Worker signs the user in with GitHub Device Flow, pins access to one configured private data repository, encrypts expiring GitHub tokens inside an `HttpOnly`, `Secure` session cookie, and writes versioned vault snapshots. Access tokens are never sent to app JavaScript or stored in this public repository. The service worker bypasses API paths so it cannot cache a private response.

After you explicitly create the first private backup, subsequent edits sync automatically after a short pause. GitHub commits keep the previous snapshot under `backups/` and in repository history. Every write checks the current snapshot revision and advances the branch without force; if another device saves first, the local changes stay in IndexedDB and the app opens a record-by-record review. Records that exist on only one side are retained. No record is silently deleted or overwritten during merge.

### Private sync status

The sync app is deployed on [collect-everything-private-sync.mirpkered.workers.dev](https://collect-everything-private-sync.mirpkered.workers.dev/), and its health endpoint currently reports it is configured. The GitHub App **Collect Everything Private Sync** uses Device Flow and expiring user tokens, with **Contents: Read and write** plus required **Metadata: Read**, and is installed only on the private [`collect-everything-data` repository](https://github.com/mirpkered/collect-everything-data). The Worker holds its client secret and session encryption key; these values must stay out of the public repository.

To deploy a future Worker update, push the code and manually run **Deploy private sync app** in GitHub Actions. The workflow reads `CLOUDFLARE_API_TOKEN` from GitHub Actions secrets and runs the build before deployment. That token is scoped to the Collect Everything Worker only.

Sign in at the Worker URL from each browser. If the private repository has no snapshot yet, the app will offer **Save first private backup** after you review the local vault. On iPhone, open the Worker URL in Safari and use **Share → Add to Home Screen**.

GitHub Pages and the Worker are different browser origins, so move existing Pages IndexedDB data with a JSON backup. Data is not sent to the private repository until you explicitly save the first backup. The app and Worker are configured for one owner and a single private JSON snapshot; this is not a multi-user or real-time collaboration service. The Worker accepts the current vault schema and migrates supported older snapshots before saving them.

## Import the Super Rare Games workbook

The importer reads the `Switch Games` sheet, requires its `Game`, `Card #`, `Personal`, and `Dupes` headers, checks every release for exactly six slots (Title and 1–5), validates quantities and namespaced IDs, and reads the literal green/yellow title fills. It preserves unmarked titles and unlabelled card notes without guessing at release numbers, rarities, or image URLs. It never saves changes to the source workbook.

Run the converter with Python 3, using the workbook path and a local-only output path:

```sh
python scripts/import_srg_workbook.py "/path/to/Super Rare Card Intentory.xlsx" private-data/card-vault-srg-import.json
```

The generated backup contains personal inventory data. `private-data/` is ignored by Git and is not part of the production build. In Collect Everything, use **Import** and select that JSON to merge the catalog into this browser’s IndexedDB. Conflicting local records stop the restore for review; unmatched records are retained. The converter reports marker mismatches and unmarked release titles, and the app preserves these source states for review. Card notes in the workbook are preserved verbatim as source notes.

## Naruto catalog and provisional inventory

The Naruto catalog update is built from the user-provided [NREA02](https://narutodb.com/kayou/sets/NREA02) and [NREA03](https://narutodb.com/kayou/sets/NREA03) catalog pages. `python scripts/build_naruto_catalog.py` validates full set counts, rarity totals, unique IDs, names, image hosts, and optional alignment with a local provisional inventory JSON before writing `public/naruto-catalog.json`. The public file contains catalog metadata and remote image URLs only; it never contains personal quantities.

NarutoDB lists 133 NREA02 cards and 123 NREA03 cards, including one Promo card per set. The original inventory package has 132 and 122 positions, so the in-app review shows the two Promo additions explicitly. Applying the update fills blank names and provisional card numbers, links exact non-stand-in thumbnails, and leaves all existing card IDs, Personal, Dupes, incoming quantities, custom names, and user image variants unchanged. Promo cards begin with no ownership recorded.

The inventory converter reads the JSON and CSV members of the user-supplied ZIP, checks every card ID, status, quantity, rarity position, set total, and CSV/JSON match, then writes a schema-v2 backup under `private-data/` for the app's **Import** control:

```sh
python scripts/import_naruto_package.py "/path/to/card-vault-naruto-import-package.zip" private-data/card-vault-naruto-import.json
```

The generated inventory backup stays local and contains personal data. `private-data/` is ignored by Git and excluded from the production build. The app keeps imported ownership quantities separate from the public catalog definitions and image links.

## Final Fantasy TCG catalog

The catalog is built from all 34 release filters currently shown in the [Square Enix official Card Browser](https://fftcg.square-enix-games.com/na/card-browser). The checked-in JSON contains 4,404 set-specific definitions from 4,391 browser records, including the same printed code in separate sets when Square Enix assigns it to multiple releases. IDs include the release namespace. The import includes official names, rarity values when provided, and exact remote image URLs; image files are not downloaded or copied into this repository. Eight entries lack an English name or rarity in the browser and remain identified by their official card codes.

On the app, review the **Final Fantasy TCG catalog is ready** banner and select **Add all releases**. The operation adds the Square Enix publisher, Final Fantasy franchise, Final Fantasy TCG series, sets, card definitions, and official image links. Only Memories of Life is tracked by default; use **Manage sets** to turn on other releases when you want to chase them. Turning a set off does not delete cards or ownership. The import contains no personal quantities and preserves existing quantities, explicit set visibility choices, and user-provided images. Existing overlapping records that no longer match the source pause the update for review.

To validate and refresh the static catalog file from the official card browser, run:

```sh
npm run catalog:fftcg
```

The importer reads the official filter list and complete card-browser response, verifies the expected release names, validates per-set totals and image hosts, then writes `public/fftcg-catalog.json`. It stops without writing if the official set list or response structure changes. Source reference: [Square Enix card browser](https://fftcg.square-enix-games.com/na/card-browser).

## Validate

```sh
npm test
npm run typecheck
npm run build
```
