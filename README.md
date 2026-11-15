# Card Vault

Card Vault is a local-first, image-focused trading card collection tracker. This v0.1 foundation is a standalone React + TypeScript + Vite PWA. It is designed for iPhone portrait use and remains usable on desktop.

## Run locally

```sh
npm install
npm run dev
```

The app persists its vault in IndexedDB in the current browser. No account is required. The service worker caches the application shell and a bounded number of remote images for offline use.

## Use the app

- Open a collection and set, add canonical cards, and track physically owned and incoming quantities separately.
- The Gallery, List, and Checklist controls change presentation only. Search and status filters remain active across view changes.
- Completion counts unique card definitions that have at least one physically owned copy. Extra copies affect duplicate status and quantity, not completion.
- Card details accept user-provided image URLs. A URL marked “Verified” is stored with a timestamp; verify that it is the exact card before selecting that option. The app does not scrape card images.
- A Super Rare Games release set requires a release number and creates the six specified slots (Title, 1–5). This slot structure has not yet been reconciled with the source workbook because it was not supplied.

## Data model

Data is stored as a versioned JSON envelope (`schemaVersion`, `updatedAt`, `catalog`). Catalog entity IDs are stable namespaced strings, such as `publisher:kayou`, `set:kayou-naruto-nrea02`, and `set:kayou-naruto-nrea02:01`. The schema keeps publishers, franchises, series, sets, canonical card definitions, variants and image sources, ownership, and acquisition records distinct. Ownership stores Personal, Dupes, and incoming counts separately. Completion counts a card definition when Personal + Dupes is greater than zero. Sets can omit rarity schemes; cards can omit rarity. Card identity is the full namespaced ID, never the printed number alone.

`src/domain.ts` documents the TypeScript schema and validation rules. Schema migrations are centralized in `migrateVault`; increment `CURRENT_SCHEMA_VERSION` and add a migration before changing persisted structures.

## Backup and import

- **JSON backup** includes the whole versioned catalog. Restore validates the schema, warns on conflicting overlapping records, and merges only non-conflicting IDs after confirmation. It never deletes records.
- **CSV export** contains `card_id,set_id,card_number,name,personal,duplicates,incoming`.
- **CSV import** requires `card_id,personal,incoming` and accepts an optional `duplicates` column. It accepts only known card IDs and non-negative whole quantities, and rejects malformed rows and duplicate IDs. It does not create card definitions.
- Keep a backup before moving browser profiles or devices. Clearing browser storage can remove the only local copy.

## GitHub Pages

The `.github/workflows/deploy.yml` workflow builds and publishes the `main` branch to GitHub Pages. The live app is [Card Vault](https://mirpkered.github.io/card-vault/). The Pages build was verified after deployment. Its Vite base path is set for a repository named `card-vault`; change `base` in `vite.config.ts` and the workflow setting if the repository name differs.

On iPhone, open the app in Safari and use **Share → Add to Home Screen**. Use **Import** in the app to load a JSON backup from Files. Catalog and inventory data stay in that browser’s IndexedDB and are not uploaded to the public repository. Private GitHub synchronization is not connected.

## Synchronization and security

Manual private GitHub data-repository synchronization is not connected in v0.1. No token is requested or stored in this public application. A future sync implementation needs a token-safe backend or user-side GitHub OAuth/device flow, remote snapshot versioning, and a review UI that shows record-level differences before applying a merge. Until then use JSON backup/restore to move data, and review reported conflicts in the two backup files before deciding which values to keep.

## Import the Super Rare Games workbook

The importer reads the `Switch Games` sheet, requires its `Game`, `Card #`, `Personal`, and `Dupes` headers, checks every release for exactly six slots (Title and 1–5), validates quantities and namespaced IDs, and reads the literal green/yellow title fills. It preserves unmarked titles and unlabelled card notes without guessing at release numbers, rarities, or image URLs. It never saves changes to the source workbook.

Run the converter with Python 3, using the workbook path and a local-only output path:

```sh
python scripts/import_srg_workbook.py "/path/to/Super Rare Card Intentory.xlsx" private-data/card-vault-srg-import.json
```

The generated backup contains personal inventory data. `private-data/` is ignored by Git and is not part of the production build. In Card Vault, use **Import** and select that JSON to merge the catalog into this browser’s IndexedDB. Conflicting local records stop the restore for review; unmatched records are retained. The converter reports marker mismatches and unmarked release titles, and the app preserves these source states for review. Card notes in the workbook are preserved verbatim as source notes.

The three Kayou source inventory notes were not part of the provided files, so the NREA02/NREA03 sets remain empty. No canonical Naruto cards or quantities have been added.

## Validate

```sh
npm test
npm run typecheck
npm run build
```
