export type Catalog = {
  publishers: Publisher[];
  franchises: Franchise[];
  series: Series[];
  sets: CardSet[];
  cards: CardDefinition[];
  variants: CardVariant[];
  ownership: Ownership[];
  acquisitions: Acquisition[];
};
export type Publisher = { id: string; name: string };
export type Franchise = { id: string; publisherId: string; name: string };
export type CollectionCategory = 'cards' | 'media' | 'misc';
export type Series = { id: string; franchiseId?: string; name: string; category?: CollectionCategory };
export type CardSet = { id: string; seriesId: string; name: string; releaseNumber?: string; expectedCardCount?: number; rarityScheme?: string[]; sourceCompletionIndicator?: 'complete' | 'incomplete' | 'unmarked'; sourceRow?: number };
export type CardDefinition = { id: string; setId: string; number: string; name: string; category?: string; rarity?: string; slot?: 'title' | 'numbered'; sourceNote?: string };
export type CardVariant = { id: string; cardId: string; name: string; imageUrls: ImageSource[] };
export type ImageSource = { url: string; source: 'verified-remote' | 'user-provided'; verifiedAt?: string };
export type Ownership = { cardId: string; variantId?: string; personal: number; duplicates: number; duplicatesKnown?: boolean; incoming: number; updatedAt: string };
export type Acquisition = { id: string; cardId: string; quantity: number; status: 'incoming' | 'received'; acquiredAt?: string; note?: string };
export type VaultData = { schemaVersion: number; updatedAt: string; catalog: Catalog };

export const CURRENT_SCHEMA_VERSION = 3;
export const emptyCatalog = (): Catalog => ({ publishers: [], franchises: [], series: [], sets: [], cards: [], variants: [], ownership: [], acquisitions: [] });
export function starterCatalog(): Catalog {
  return {
    publishers: [{ id: 'publisher:kayou', name: 'Kayou' }, { id: 'publisher:super-rare-games', name: 'Super Rare Games' }],
    franchises: [{ id: 'franchise:naruto', publisherId: 'publisher:kayou', name: 'Naruto' }, { id: 'franchise:nintendo-switch-release-cards', publisherId: 'publisher:super-rare-games', name: 'Nintendo Switch release cards' }],
    series: [
      { id: 'series:kayou-naruto', franchiseId: 'franchise:naruto', name: 'Kayou Naruto', category: 'cards' },
      { id: 'series:srg-switch', franchiseId: 'franchise:nintendo-switch-release-cards', name: 'Super Rare Games', category: 'cards' },
      { id: 'series:media:snl-dvds', name: 'SNL DVDs', category: 'media' },
    ],
    sets: [
      { id: 'set:kayou-naruto-nrea02', seriesId: 'series:kayou-naruto', name: 'NREA02' },
      { id: 'set:kayou-naruto-nrea03', seriesId: 'series:kayou-naruto', name: 'NREA03' },
      { id: 'set:media:snl-dvds:collection', seriesId: 'series:media:snl-dvds', name: 'DVD collection' },
    ], cards: [], variants: [], ownership: [], acquisitions: [],
  };
}
export const emptyVault = (): VaultData => ({ schemaVersion: CURRENT_SCHEMA_VERSION, updatedAt: new Date().toISOString(), catalog: starterCatalog() });

function ensureSnlDvdCollection(catalog: Catalog): Catalog {
  const seriesId = 'series:media:snl-dvds';
  const setId = 'set:media:snl-dvds:collection';
  const series = catalog.series.some((item) => item.id === seriesId)
    ? catalog.series
    : [...catalog.series, { id: seriesId, name: 'SNL DVDs', category: 'media' as const }];
  const sets = catalog.sets.some((item) => item.id === setId)
    ? catalog.sets
    : [...catalog.sets, { id: setId, seriesId, name: 'DVD collection' }];
  return { ...catalog, series, sets };
}

function isCollectionCategory(value: unknown): value is CollectionCategory {
  return value === 'cards' || value === 'media' || value === 'misc';
}

export function validateCatalog(catalog: Catalog): string[] {
  const errors: string[] = [];
  const collections: [string, { id: string }[]][] = Object.entries(catalog).filter(([name]) => name !== 'ownership') as [string, { id: string }[]][];
  for (const [name, records] of collections) {
    if (!Array.isArray(records)) { errors.push(`${name} must be an array.`); continue; }
    const ids = new Set<string>();
    for (const record of records) {
      if (!record.id) errors.push(`${name} contains a record without an ID.`);
      else if (ids.has(record.id)) errors.push(`${name} contains duplicate ID “${record.id}”.`);
      else ids.add(record.id);
    }
  }
  const has = (key: keyof Catalog, id: string) => (catalog[key] as { id: string }[]).some((item) => item.id === id);
  for (const item of catalog.franchises) if (!has('publishers', item.publisherId)) errors.push(`Franchise ${item.id} references missing publisher ${item.publisherId}.`);
  for (const item of catalog.series) {
    if (item.franchiseId && !has('franchises', item.franchiseId)) errors.push(`Series ${item.id} references missing franchise ${item.franchiseId}.`);
    if (!isCollectionCategory(item.category)) errors.push(`Series ${item.id} must use Cards, Media, or Misc as its category.`);
  }
  for (const item of catalog.sets) if (!has('series', item.seriesId)) errors.push(`Set ${item.id} references missing series ${item.seriesId}.`);
  for (const item of catalog.sets) if (item.expectedCardCount !== undefined && catalog.cards.filter((card) => card.setId === item.id).length !== item.expectedCardCount) errors.push(`Set ${item.id} must define exactly ${item.expectedCardCount} cards.`);
  for (const item of catalog.cards) if (!has('sets', item.setId)) errors.push(`Card ${item.id} references missing set ${item.setId}.`);
  for (const item of catalog.variants) if (!has('cards', item.cardId)) errors.push(`Variant ${item.id} references missing card ${item.cardId}.`);
  for (const item of catalog.ownership) {
    if (!has('cards', item.cardId)) errors.push(`Ownership references missing card ${item.cardId}.`);
    if (!Number.isInteger(item.personal) || item.personal < 0 || !Number.isInteger(item.duplicates) || item.duplicates < 0 || !Number.isInteger(item.incoming) || item.incoming < 0) errors.push(`Ownership for ${item.cardId} must use non-negative whole quantities.`);
    if (item.duplicatesKnown !== undefined && typeof item.duplicatesKnown !== 'boolean') errors.push(`Ownership for ${item.cardId} must mark duplicate quantity knowledge as true or false.`);
  }
  if (new Set(catalog.ownership.map((item) => item.cardId)).size !== catalog.ownership.length) errors.push('A card may have only one ownership record.');
  for (const item of catalog.acquisitions) {
    if (!has('cards', item.cardId)) errors.push(`Acquisition ${item.id} references missing card ${item.cardId}.`);
    if (!Number.isInteger(item.quantity) || item.quantity < 1) errors.push(`Acquisition ${item.id} must have a positive whole quantity.`);
  }
  const ids = new Set(catalog.cards.map((card) => card.id));
  if (ids.size !== catalog.cards.length) errors.push('Card definition IDs must be unique across all sets.');
  return errors;
}

export function validateVault(value: unknown): value is VaultData {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as VaultData;
  return candidate.schemaVersion === CURRENT_SCHEMA_VERSION && !!candidate.catalog && validateCatalog(candidate.catalog).length === 0;
}

export function migrateVault(value: unknown): VaultData {
  if (!value || typeof value !== 'object') throw new Error('Backup must be a JSON object.');
  const source = value as Partial<VaultData>;
  if (source.schemaVersion === CURRENT_SCHEMA_VERSION && source.catalog && validateCatalog(source.catalog).length === 0) return source as VaultData;
  if ((source.schemaVersion === 0 || source.schemaVersion === 1 || source.schemaVersion === 2) && source.catalog) {
    const previous = source.catalog as Omit<Catalog, 'ownership'> & { ownership?: (Partial<Ownership> & { cardId: string; owned?: number })[]; series: Series[] };
    const migratedCatalog = { ...previous, series: previous.series.map((item) => ({ ...item, category: isCollectionCategory(item.category) ? item.category : 'cards' as const })), ownership: (previous.ownership ?? []).map((item) => ({
      cardId: item.cardId, variantId: item.variantId, personal: item.personal ?? item.owned ?? 0,
      duplicates: item.duplicates ?? 0, ...(item.duplicatesKnown === undefined ? {} : { duplicatesKnown: item.duplicatesKnown }),
      incoming: item.incoming ?? 0, updatedAt: item.updatedAt ?? new Date().toISOString(),
    })) } as Catalog;
    const catalog = ensureSnlDvdCollection(migratedCatalog);
    const migrated = { ...source, catalog, schemaVersion: CURRENT_SCHEMA_VERSION, updatedAt: source.updatedAt ?? new Date().toISOString() } as VaultData;
    const errors = validateCatalog(migrated.catalog);
    if (errors.length) throw new Error(`Migration failed: ${errors.join(' ')}`);
    return migrated;
  }
  throw new Error(`Unsupported or invalid backup schema version: ${String(source.schemaVersion)}.`);
}

export type CardStatus = 'owned' | 'missing' | 'incoming' | 'duplicate';
export function cardStatus(cardId: string, inventory: Ownership[]): CardStatus {
  const qty = inventory.find((item) => item.cardId === cardId);
  const total = (qty?.personal ?? 0) + (qty?.duplicates ?? 0);
  if ((qty?.duplicates ?? 0) > 0 || total > 1) return 'duplicate';
  if (total > 0) return 'owned';
  if ((qty?.incoming ?? 0) > 0) return 'incoming';
  return 'missing';
}
export function completion(cards: CardDefinition[], inventory: Ownership[]) {
  const owned = new Set(inventory.filter((item) => item.personal + item.duplicates > 0).map((item) => item.cardId));
  return { owned: cards.filter((card) => owned.has(card.id)).length, total: cards.length, percent: cards.length ? Math.round(cards.filter((card) => owned.has(card.id)).length / cards.length * 100) : 0 };
}
export function findConflicts(local: VaultData, remote: VaultData): string[] {
  const conflicts: string[] = [];
  for (const key of ['publishers', 'franchises', 'series', 'sets', 'cards', 'variants', 'acquisitions'] as const) {
    const remoteById = new Map(remote.catalog[key].map((x) => [x.id, x]));
    for (const record of local.catalog[key]) if (remoteById.has(record.id) && JSON.stringify(record) !== JSON.stringify(remoteById.get(record.id))) conflicts.push(`${key.slice(0, -1)} ${record.id} differs between local and remote data.`);
  }
  const localInventory = new Map(local.catalog.ownership.map((x) => [x.cardId, x]));
  const remoteInventory = new Map(remote.catalog.ownership.map((x) => [x.cardId, x]));
  for (const [id, record] of localInventory) if (remoteInventory.has(id) && JSON.stringify(record) !== JSON.stringify(remoteInventory.get(id))) conflicts.push(`Ownership for ${id} differs between local and remote data.`);
  return conflicts;
}

export function filterCards(cards: CardDefinition[], inventory: Ownership[], filter: CardStatus | 'all', query = ''): CardDefinition[] {
  const normalized = query.trim().toLowerCase();
  return cards.filter((card) => (filter === 'all' || cardStatus(card.id, inventory) === filter) && (!normalized || `${card.name} ${card.number} ${card.rarity ?? ''} ${card.category ?? ''}`.toLowerCase().includes(normalized)));
}

export function validateInventoryRows(rows: Record<string, string>[], cards: CardDefinition[]): { updates: Ownership[]; errors: string[] } {
  const errors: string[] = []; const known = new Set(cards.map((card) => card.id)); const updates: Ownership[] = [];
  rows.forEach((row, index) => {
    const line = index + 2;
    if (!known.has(row.card_id)) errors.push(`Row ${line} references unknown card ID ${row.card_id}.`);
    const personal = Number(row.personal ?? row.owned); const duplicates = Number(row.duplicates ?? row.dupes ?? 0); const incoming = Number(row.incoming);
    if (![personal, duplicates, incoming].every((x) => Number.isInteger(x) && x >= 0)) errors.push(`Row ${line} has invalid Personal, Dupes, or incoming quantities.`);
    else {
      const duplicateFlag = row.duplicates_known?.trim().toLowerCase();
      if (duplicateFlag && duplicateFlag !== 'true' && duplicateFlag !== 'false') errors.push(`Row ${line} has invalid duplicates_known; use true or false.`);
      else updates.push({ cardId: row.card_id, personal, duplicates, incoming, ...(duplicateFlag ? { duplicatesKnown: duplicateFlag === 'true' } : {}), updatedAt: new Date().toISOString() });
    }
  });
  if (new Set(updates.map((x) => x.cardId)).size !== updates.length) errors.push('CSV contains duplicate card_id rows.');
  return { updates, errors };
}

export function parseCsv(text: string): { rows: Record<string, string>[]; errors: string[] } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { rows: [], errors: ['CSV file is empty.'] };
  const parseLine = (line: string) => {
    const cells: string[] = []; let cell = ''; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' && line[i + 1] === '"' && quoted) { cell += '"'; i++; }
      else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { cells.push(cell); cell = ''; }
      else cell += char;
    }
    cells.push(cell);
    return cells.map((x) => x.trim());
  };
  const headers = parseLine(lines[0]).map((x) => x.toLowerCase());
  const errors: string[] = [];
  const rows = lines.slice(1).map((line, index) => {
    const values = parseLine(line);
    if (values.length !== headers.length) errors.push(`Row ${index + 2} has ${values.length} values; expected ${headers.length}.`);
    return Object.fromEntries(headers.map((header, i) => [header, values[i] ?? '']));
  });
  for (const required of ['card_id', 'incoming']) if (!headers.includes(required)) errors.push(`CSV is missing required “${required}” column.`);
  if (!headers.includes('personal') && !headers.includes('owned')) errors.push('CSV is missing required “personal” column.');
  return { rows, errors };
}
