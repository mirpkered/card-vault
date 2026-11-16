import { describe, expect, it } from 'vitest';
import { cardStatus, completion, emptyVault, filterCards, findConflicts, getTrackedCards, migrateVault, parseCsv, validateCatalog, validateInventoryRows, type CardDefinition, type CardVariant, type Ownership } from './domain';

const cards: CardDefinition[] = [
  { id: 'set:one:01', setId: 'set:one', number: '01', name: 'Kakashi', rarity: 'Rare' },
  { id: 'set:two:01', setId: 'set:two', number: '01', name: 'Naruto' },
  { id: 'set:one:02', setId: 'set:one', number: '02', name: 'Sasuke' },
];
const inventory: Ownership[] = [
  { cardId: 'set:one:01', personal: 1, duplicates: 2, incoming: 1, updatedAt: '2026-01-01' },
  { cardId: 'set:two:01', personal: 0, duplicates: 0, incoming: 2, updatedAt: '2026-01-01' },
];

describe('collection domain', () => {
  it('keeps same card numbers unique across namespaced sets', () => {
    expect(cards[0].number).toBe(cards[1].number);
    expect(cards[0].id).not.toBe(cards[1].id);
  });
  it('tracks owned quantities, duplicates, and incoming separately', () => {
    expect(cardStatus(cards[0].id, inventory)).toBe('duplicate');
    expect(inventory[0].personal + inventory[0].duplicates).toBe(3);
    expect(cardStatus(cards[1].id, inventory)).toBe('incoming');
    expect(cardStatus(cards[2].id, inventory)).toBe('missing');
  });
  it('counts a card held only in the duplicate pile as physically owned', () => {
    const duplicateOnly = [{ cardId: cards[2].id, personal: 0, duplicates: 1, incoming: 0, updatedAt: '2026-01-01' }];
    expect(cardStatus(cards[2].id, duplicateOnly)).toBe('duplicate');
    expect(completion(cards, duplicateOnly).owned).toBe(1);
  });
  it('calculates completion from unique owned card definitions', () => {
    expect(completion(cards, inventory)).toEqual({ owned: 1, total: 3, percent: 33 });
  });
  it('tracks each printing independently while counting its definition once', () => {
    const normal: CardVariant = { id: `${cards[0].id}:normal`, cardId: cards[0].id, name: 'Normal', treatment: 'normal', imageUrls: [] };
    const foil: CardVariant = { id: `${cards[0].id}:foil`, cardId: cards[0].id, name: 'Foil', treatment: 'foil', imageUrls: [] };
    const versions: Ownership[] = [
      { cardId: cards[0].id, variantId: normal.id, personal: 1, duplicates: 0, incoming: 0, updatedAt: '' },
      { cardId: cards[0].id, variantId: foil.id, personal: 1, duplicates: 1, incoming: 2, updatedAt: '' },
    ];
    const catalog = emptyVault().catalog;
    catalog.sets.push({ id: 'set:one', seriesId: 'series:kayou-naruto', name: 'one', tracked: true }, { id: 'set:two', seriesId: 'series:kayou-naruto', name: 'two', tracked: true });
    catalog.cards = cards;
    catalog.variants = [normal, foil];
    catalog.ownership = versions;
    expect(validateCatalog(catalog)).toEqual([]);
    expect(validateCatalog({ ...catalog, ownership: [...versions, { ...versions[0] }] })).toContain('A card version may have only one ownership record.');
    expect(cardStatus(cards[0].id, versions)).toBe('duplicate');
    expect(completion(cards, versions)).toEqual({ owned: 1, total: 3, percent: 33 });
    const oneOfEach = versions.map((item) => ({ ...item, personal: 1, duplicates: 0 }));
    expect(cardStatus(cards[0].id, oneOfEach)).toBe('owned');
    expect(completion(cards, oneOfEach)).toEqual({ owned: 1, total: 3, percent: 33 });
  });
  it('excludes turned-off sets from progress while retaining their card records', () => {
    const catalog = emptyVault().catalog;
    const activeCard = { id: `${catalog.sets[0].id}:01`, setId: catalog.sets[0].id, number: '01', name: 'Active' };
    const hiddenCard = { id: `${catalog.sets[1].id}:01`, setId: catalog.sets[1].id, number: '01', name: 'Hidden' };
    catalog.cards.push(activeCard, hiddenCard);
    catalog.sets[1].tracked = false;
    const active = getTrackedCards(catalog);
    expect(active).toEqual([activeCard]);
    expect(catalog.cards).toHaveLength(2);
    expect(completion(active, [{ cardId: activeCard.id, personal: 1, duplicates: 0, incoming: 0, updatedAt: '' }])).toEqual({ owned: 1, total: 1, percent: 100 });
  });
  it('combines status and text filters', () => {
    expect(filterCards(cards, inventory, 'duplicate', 'kak')).toEqual([cards[0]]);
    expect(filterCards(cards, inventory, 'incoming', 'nar')).toEqual([cards[1]]);
    expect(filterCards(cards, inventory, 'owned', 'sas')).toEqual([]);
  });
  it('validates references and ownership quantities', () => {
    const catalog = emptyVault().catalog;
    expect(validateCatalog(catalog)).toEqual([]);
    const broken = { ...catalog, cards: [{ id: 'x', setId: 'missing', number: '1', name: 'x' }], ownership: [{ cardId: 'x', personal: -1, duplicates: 0, incoming: 0, updatedAt: '' }] };
    expect(validateCatalog(broken)).toContain('Card x references missing set missing.');
    expect(validateCatalog(broken)).toContain('Ownership for x must use non-negative whole quantities.');
  });
  it('parses quoted CSV and validates known card IDs and quantities', () => {
    const parsed = parseCsv('card_id,personal,duplicates,incoming\n"set:one:01",1,2,1');
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({ card_id: 'set:one:01', personal: '1', duplicates: '2' });
    expect(validateInventoryRows(parsed.rows, cards).errors).toEqual([]);
    expect(validateInventoryRows([{ card_id: 'unknown', personal: '-1', duplicates: '0', incoming: '0' }], cards).errors).toHaveLength(2);
  });
  it('validates variant-specific CSV rows and defaults legacy rows to Normal', () => {
    const variants: CardVariant[] = [
      { id: `${cards[0].id}:normal`, cardId: cards[0].id, name: 'Normal', treatment: 'normal', imageUrls: [] },
      { id: `${cards[0].id}:foil`, cardId: cards[0].id, name: 'Foil', treatment: 'foil', imageUrls: [] },
    ];
    const legacy = validateInventoryRows([{ card_id: cards[0].id, personal: '1', incoming: '0' }], cards, variants);
    expect(legacy.errors).toEqual([]);
    expect(legacy.updates[0].variantId).toBe(variants[0].id);
    const separate = validateInventoryRows([
      { card_id: cards[0].id, variant_id: variants[0].id, personal: '1', incoming: '0' },
      { card_id: cards[0].id, variant_id: variants[1].id, personal: '2', incoming: '0' },
    ], cards, variants);
    expect(separate.errors).toEqual([]);
    expect(separate.updates).toHaveLength(2);
    expect(validateInventoryRows([{ card_id: cards[0].id, variant_id: 'foreign', personal: '1', incoming: '0' }], cards, variants).errors).toContain('Row 2 references an unknown card variant foreign.');
  });
  it('preserves an unknown duplicate quantity instead of treating it as zero', () => {
    const parsed = parseCsv('card_id,personal,duplicates,duplicates_known,incoming\n"set:one:01",1,0,false,0');
    const checked = validateInventoryRows(parsed.rows, cards);
    expect(checked.errors).toEqual([]);
    expect(checked.updates[0].duplicatesKnown).toBe(false);
    expect(validateInventoryRows([{ card_id: 'set:one:01', personal: '1', duplicates: '0', duplicates_known: 'maybe', incoming: '0' }], cards).errors).toContain('Row 2 has invalid duplicates_known; use true or false.');
  });
  it('round trips backups and migrates the version zero envelope', () => {
    const current = emptyVault();
    expect(migrateVault(JSON.parse(JSON.stringify(current)))).toEqual(current);
    current.catalog.cards.push({ id: 'set:kayou-naruto-nrea02:R001', setId: 'set:kayou-naruto-nrea02', number: 'R001', name: '' });
    current.catalog.ownership.push({ cardId: 'set:kayou-naruto-nrea02:R001', personal: 1, duplicates: 0, duplicatesKnown: false, incoming: 0, updatedAt: '2026-01-01' });
    expect(migrateVault(JSON.parse(JSON.stringify(current))).catalog.ownership[0].duplicatesKnown).toBe(false);
    const legacyCard = { ...cards[0], setId: 'set:legacy' };
    const legacyCatalog = { ...current.catalog, sets: [...current.catalog.sets, { id: 'set:legacy', seriesId: 'series:kayou-naruto', name: 'legacy' }], cards: [legacyCard], ownership: [{ cardId: legacyCard.id, owned: 2, incoming: 0, updatedAt: '2026-01-01' }] };
    const old = { ...current, schemaVersion: 1, catalog: legacyCatalog };
    expect(migrateVault(old).schemaVersion).toBe(4);
    expect(migrateVault(old).catalog.ownership[0]).toMatchObject({ personal: 2, duplicates: 0, incoming: 0 });
    expect(() => migrateVault({ schemaVersion: 99 })).toThrow('Unsupported');
  });
  it('migrates schema 2 collections into categories and seeds an empty SNL DVD collection', () => {
    const old = emptyVault();
    old.schemaVersion = 2;
    old.catalog.series = old.catalog.series.filter((series) => series.id !== 'series:media:snl-dvds').map(({ category: _category, ...series }) => series);
    old.catalog.sets = old.catalog.sets.filter((set) => set.id !== 'set:media:snl-dvds:collection');
    const migrated = migrateVault(JSON.parse(JSON.stringify(old)));
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.catalog.series.filter((series) => series.category === 'cards')).toHaveLength(2);
    expect(migrated.catalog.series.find((series) => series.id === 'series:media:snl-dvds')).toMatchObject({ name: 'SNL DVDs', category: 'media' });
    expect(migrated.catalog.sets.find((set) => set.id === 'set:media:snl-dvds:collection')).toMatchObject({ seriesId: 'series:media:snl-dvds', name: 'DVD collection' });
    expect(migrated.catalog.cards).toHaveLength(old.catalog.cards.length);
    expect(validateCatalog(migrated.catalog)).toEqual([]);
  });
  it('migrates schema 3 sets to tracked by default and preserves explicit hidden states', () => {
    const old = emptyVault();
    old.schemaVersion = 3;
    Object.assign(old.catalog, { sets: old.catalog.sets.map(({ tracked: _tracked, ...set }, index) => index === 0 ? set : { ...set, tracked: false }) });
    const migrated = migrateVault(JSON.parse(JSON.stringify(old)));
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.catalog.sets[0].tracked).toBe(true);
    expect(migrated.catalog.sets[1].tracked).toBe(false);
  });
  it('detects overlapping records changed in either copy', () => {
    const local = emptyVault(); const remote = emptyVault();
    local.catalog.sets[0].name = 'changed';
    expect(findConflicts(local, remote)).toContain('set set:kayou-naruto-nrea02 differs between local and remote data.');
  });
});
