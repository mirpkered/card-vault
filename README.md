# Collect Everything

Collect Everything is a local-first, image-focused collection manager. Version 0.1 currently supports trading-card collections and runs as a standalone React + TypeScript + Vite PWA. It is designed for iPhone portrait use and remains usable on desktop. SNL DVD tracking is not implemented yet; the data model and interface need a general collectible-item layer before DVDs are added.

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
- Naruto cards can be enriched with verified names, catalog card codes, and remote thumbnails from NarutoDB. Review and apply the update inside the app; it preserves your inventory quantities and user-added images. Thumbnails stay hosted remotely and are cached after viewing.
- Card details also accept user-provided image URLs. A URL marked “Verified” is stored with a timestamp; verify that it is the exact card before selecting that option.
- A Super Rare Games release set requires a release number and creates the six specified slots (Title, 1–5). This slot structure has not yet been reconciled with the source workbook because it was not supplied.

## Data model

Data is stored as a versioned JSON envelope (`schemaVersion`, `updatedAt`, `catalog`). Catalog entity IDs are stable namespaced strings, such as `publisher:kayou`, `set:kayou-naruto-nrea02`, and `set:kayou-naruto-nrea02:01`. The schema keeps publishers, franchises, series, sets, canonical card definitions, variants and image sources, ownership, and acquisition records distinct. Ownership stores Personal, Dupes, and incoming counts separately. An optional `duplicatesKnown: false` marks an unreported duplicate quantity; it is shown as unknown instead of zero. Completion counts a card definition when Personal + Dupes is greater than zero. Sets can omit rarity schemes; cards can omit rarity. Card identity is the full namespaced ID, never the printed number alone.

`src/domain.ts` documents the TypeScript schema and validation rules. Schema migrations are centralized in `migrateVault`; increment `CURRENT_SCHEMA_VERSION` and add a migration before changing persisted structures.

## Backup and import

- **JSON backup** includes the whole versioned catalog. Restore validates the schema, warns on conflicting overlapping records, and merges only non-conflicting IDs after confirmation. It never deletes records.
- **CSV export** contains `card_id,set_id,card_number,name,personal,duplicates,duplicates_known,incoming`.
- **CSV import** requires `card_id,personal,incoming` and accepts optional `duplicates` and `duplicates_known` columns. It accepts only known card IDs and non-negative whole quantities, and rejects malformed rows and duplicate IDs. It does not create card definitions.
- Keep a backup before moving browser profiles or devices. Clearing browser storage can remove the only local copy.

## GitHub Pages

The `.github/workflows/deploy.yml` workflow builds and publishes the `main` branch to GitHub Pages. The live app is [Collect Everything](https://mirpkered.github.io/card-vault/). The Pages build was verified after deployment. The repository URL remains `card-vault` for stability; its Vite base path matches that URL.

On iPhone, open the app in Safari and use **Share → Add to Home Screen**. The Pages address remains local-only: browser storage is isolated by site, and this public repository never receives catalog quantities or access tokens. Private sync runs from the separate Cloudflare Worker address described below.

## Synchronization and security

The sync foundation serves the Vite app and `/api/*` from one Cloudflare Worker origin, following the Resale Tracker pattern. The Worker signs the user in with GitHub Device Flow, pins access to one configured private data repository, encrypts expiring GitHub tokens inside an `HttpOnly`, `Secure` session cookie, and writes versioned vault snapshots. Access tokens are never sent to app JavaScript or stored in this public repository. The service worker bypasses API paths so it cannot cache a private response.

After you explicitly create the first private backup, subsequent edits sync automatically after a short pause. GitHub commits keep the previous snapshot under `backups/` and in repository history. Every write checks the current snapshot revision and advances the branch without force; if another device saves first, the local changes stay in IndexedDB and the app opens a record-by-record review. Records that exist on only one side are retained. No record is silently deleted or overwritten during merge.

### Remaining account setup

The sync app is deployed on [collect-everything-private-sync.mirpkered.workers.dev](https://collect-everything-private-sync.mirpkered.workers.dev/). Private sign-in is not active until the GitHub App client secret and session encryption key are added. The GitHub App **Collect Everything Private Sync** is enabled for Device Flow and expiring user tokens, with **Contents: Read and write** plus required **Metadata: Read**, and is installed only on the private [`collect-everything-data` repository](https://github.com/mirpkered/collect-everything-data). The data repository is still empty; no collection data has been uploaded.

To activate sync:

1. The app code is deployed. For future code changes, use the manual **Deploy private sync app** GitHub Actions workflow. It reads `CLOUDFLARE_API_TOKEN` from GitHub Actions secrets and only runs when manually started. The token is named **Collect Everything Worker Deploy**, set to **Individual Workers → Editor** for `collect-everything-private-sync` only, and expires after one year; it cannot edit the Resale Tracker Worker. The Cloudflare account ID is in `worker/wrangler.jsonc`.
2. In GitHub App **Collect Everything Private Sync → Credentials**, create a client secret. Add `GITHUB_APP_CLIENT_SECRET` and `SESSION_ENCRYPTION_KEY` as Worker secrets in Cloudflare under **Workers & Pages → collect-everything-private-sync → Settings → Variables and Secrets**. The non-secret Client ID is already configured in `worker/wrangler.jsonc`. Generate a 32-byte encryption key locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. Enter secret values directly into Cloudflare; never put them in GitHub Pages, chat, or a committed `.dev.vars` file. `worker/.dev.vars` is ignored by Git for local development; use `worker/.dev.vars.example` as the local template.
3. Open the Worker URL, sign in, import a JSON backup from the Pages browser if needed, then choose **Save first private backup**. Other browsers can sign in at that Worker URL and load the shared vault. If you install it on iPhone, add the Worker URL to the Home Screen and sign in inside the installed app.

Until the GitHub App client secret and session encryption key are configured, the Worker serves the app in local-only mode. GitHub Pages and the Worker are different browser origins, so move existing Pages IndexedDB data with a JSON backup. Data is not sent to the private repository until you explicitly save the first backup. The app and Worker are configured for one owner and a single private JSON snapshot; this is not a multi-user or real-time collaboration service. The Worker currently accepts the current vault schema version and must be updated alongside future schema migrations.

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

## Validate

```sh
npm test
npm run typecheck
npm run build
```
