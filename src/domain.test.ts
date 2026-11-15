import { describe, expect, it } from 'vitest';
import { cardStatus, completion, emptyVault, filterCards, findConflicts, migrateVault, parseCsv, validateCatalog, validateInventoryRows, type CardDefinition, type Ownership } from './domain';

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
  it('round trips backups and migrates the version zero envelope', () => {
    const current = emptyVault();
    expect(migrateVault(JSON.parse(JSON.stringify(current)))).toEqual(current);
    const legacyCard = { ...cards[0], setId: 'set:legacy' };
    const legacyCatalog = { ...current.catalog, sets: [...current.catalog.sets, { id: 'set:legacy', seriesId: 'series:kayou-naruto', name: 'legacy' }], cards: [legacyCard], ownership: [{ cardId: legacyCard.id, owned: 2, incoming: 0, updatedAt: '2026-01-01' }] };
    const old = { ...current, schemaVersion: 1, catalog: legacyCatalog };
    expect(migrateVault(old).schemaVersion).toBe(2);
    expect(migrateVault(old).catalog.ownership[0]).toMatchObject({ personal: 2, duplicates: 0, incoming: 0 });
    expect(() => migrateVault({ schemaVersion: 99 })).toThrow('Unsupported');
  });
  it('detects overlapping records changed in either copy', () => {
    const local = emptyVault(); const remote = emptyVault();
    local.catalog.sets[0].name = 'changed';
    expect(findConflicts(local, remote)).toContain('set set:kayou-naruto-nrea02 differs between local and remote data.');
  });
});
