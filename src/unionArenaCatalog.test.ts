import { describe, expect, it } from 'vitest';
import { completion, emptyVault, validateCatalog } from './domain';
import officialSnapshot from '../public/union-arena-catalog.json';
import {
  applyUnionArenaCatalogUpdate,
  parseUnionArenaCatalogUpdate,
  planUnionArenaCatalogUpdate,
  unionArenaCardId,
  unionArenaParallelCardId,
  unionArenaVariantId,
} from './unionArenaCatalog';

const image = (number: string) => `https://www.unionarena-tcg.com/na/images/cardlist/card/${number}.png?v3`;

function catalog() {
  return parseUnionArenaCatalogUpdate({
    schemaVersion: 1,
    source: 'Bandai UNION ARENA English (U.S./Canada) Card Browser',
    cataloguedAt: '2026-11-17T12:00:00.000Z',
    browserUrl: 'https://www.unionarena-tcg.com/na/cardlist/?search=true',
    productCount: 1,
    sourceCardCount: 4,
    sourceSignature: 'a'.repeat(64),
    sets: [{
      id: 'set:union-arena-na:591101', productId: '591101', seriesId: 'series:union-arena-tcg',
      name: 'BLEACH [UE01BT]', cardCount: 2, basePrintCount: 1, parallelCount: 3, sourceRowCount: 4, trackedByDefault: false,
    }],
    cards: [
      { setId: 'set:union-arena-na:591101', number: 'UE01BT/BLC-1-001', name: 'Ichigo Kurosaki', imageUrl: image('UE01BT_BLC-1-001'), parallelOnly: false, parallels: [
        { id: 'p1', imageUrl: image('UE01BT_BLC-1-001_p1') },
        { id: 'p2', imageUrl: image('UE01BT_BLC-1-001_p2') },
      ] },
      { setId: 'set:union-arena-na:591101', number: 'UE01BT/BLC-1-002', name: 'Rukia Kuchiki', imageUrl: image('UE01BT_BLC-1-002_p1'), parallelOnly: true, parallels: [
        { id: 'p1', imageUrl: image('UE01BT_BLC-1-002_p1') },
      ], sourceNote: 'Parallel-only entry.' },
    ],
  });
}

describe('Union Arena catalog import', () => {
  it('validates the complete English snapshot with all product sets turned off', () => {
    const update = parseUnionArenaCatalogUpdate(officialSnapshot);
    expect(update.productCount).toBe(52);
    expect(update.cards).toHaveLength(5804);
    expect(update.sets.every((set) => set.trackedByDefault === false)).toBe(true);
    expect(update.sets.reduce((sum, set) => sum + set.sourceRowCount, 0)).toBe(6955);
    expect(update.cards.reduce((sum, card) => sum + (card.parallelOnly ? card.parallels.length - 1 : card.parallels.length), 0)).toBe(1151);
  });

  it('validates product rows and namespaced card and parallel identities', () => {
    const update = catalog();
    expect(update.sets).toHaveLength(1);
    expect(unionArenaCardId(update.sets[0].id, update.cards[0].number)).not.toBe(unionArenaCardId('set:union-arena-na:591102', update.cards[0].number));
    expect(unionArenaParallelCardId(unionArenaCardId(update.sets[0].id, update.cards[0].number), 'p1'))
      .not.toBe(unionArenaParallelCardId(unionArenaCardId(update.sets[0].id, update.cards[1].number), 'p1'));
    expect(() => parseUnionArenaCatalogUpdate({ ...update, sourceCardCount: 5 })).toThrow(/total does not match/);
    expect(() => parseUnionArenaCatalogUpdate({ ...update, cards: update.cards.map((card) => ({ ...card, imageUrl: 'https://example.com/card.png' })) })).toThrow(/invalid identity/);
    expect(() => parseUnionArenaCatalogUpdate({ ...update, sets: update.sets.map((set) => ({ ...set, trackedByDefault: true })) })).toThrow(/failed validation/);
  });

  it('adds inactive products, Normal/Foil versions, and optional parallel art without counting it toward completion', () => {
    const update = catalog();
    const before = emptyVault();
    const plan = planUnionArenaCatalogUpdate(before, update);
    expect(plan.setsToAdd).toBe(1);
    expect(plan.optionalCardsToAdd).toBe(2);
    expect(plan.variantsToAdd).toBe(6);
    expect(plan.conflicts).toEqual([]);

    const next = applyUnionArenaCatalogUpdate(before, update);
    const set = next.catalog.sets.find((item) => item.id === update.sets[0].id)!;
    expect(set.tracked).toBe(false);
    expect(set.expectedCardCount).toBe(2);
    expect(next.catalog.cards.filter((card) => card.setId === set.id && card.countsTowardSetCompletion !== false)).toHaveLength(2);
    expect(next.catalog.cards.filter((card) => card.setId === set.id && card.countsTowardSetCompletion === false)).toHaveLength(2);
    expect(next.catalog.variants.filter((variant) => variant.cardId === unionArenaCardId(set.id, update.cards[0].number)).map((variant) => variant.treatment)).toEqual(['normal', 'foil']);
    expect(next.catalog.variants.some((variant) => variant.id === unionArenaVariantId(unionArenaParallelCardId(unionArenaCardId(set.id, update.cards[0].number), 'p1'), 'full-art', 'p1'))).toBe(true);
    expect(next.catalog.cards.find((card) => card.number === update.cards[1].number && card.countsTowardSetCompletion !== false)).toBeDefined();
    expect(validateCatalog(next.catalog)).toEqual([]);

    const bonusId = unionArenaParallelCardId(unionArenaCardId(set.id, update.cards[0].number), 'p1');
    expect(completion(next.catalog.cards.filter((card) => card.setId === set.id), [{ cardId: bonusId, personal: 1, duplicates: 0, incoming: 0, updatedAt: '2026-11-17T12:00:00.000Z' }]).owned).toBe(0);
    expect(planUnionArenaCatalogUpdate(next, update).hasChanges).toBe(false);
  });

  it('keeps a user-selected set active and migrates legacy quantities to Normal', () => {
    const update = catalog();
    const baseId = unionArenaCardId(update.sets[0].id, update.cards[0].number);
    const before = emptyVault();
    before.catalog.cards.push({ id: baseId, setId: update.sets[0].id, number: update.cards[0].number, name: update.cards[0].name });
    before.catalog.ownership.push({ cardId: baseId, personal: 2, duplicates: 1, incoming: 3, updatedAt: '2026-11-17T12:00:00.000Z' });
    const next = applyUnionArenaCatalogUpdate(before, update);
    expect(next.catalog.ownership[0]).toMatchObject({ cardId: baseId, variantId: unionArenaVariantId(baseId, 'normal'), personal: 2, duplicates: 1, incoming: 3 });

    const selected = { ...next, catalog: { ...next.catalog, sets: next.catalog.sets.map((set) => set.id === update.sets[0].id ? { ...set, tracked: true } : set) } };
    expect(applyUnionArenaCatalogUpdate(selected, update).catalog.sets.find((set) => set.id === update.sets[0].id)?.tracked).toBe(true);
  });

  it('pauses when a future source snapshot would omit a card already in the vault', () => {
    const current = catalog();
    const imported = applyUnionArenaCatalogUpdate(emptyVault(), current);
    const nextSnapshot = parseUnionArenaCatalogUpdate({
      ...current,
      sourceCardCount: 3,
      sets: [{ ...current.sets[0], cardCount: 1, parallelCount: 2, sourceRowCount: 3 }],
      cards: current.cards.slice(0, 1),
    });
    const plan = planUnionArenaCatalogUpdate(imported, nextSnapshot);
    expect(plan.conflicts.join(' ')).toContain('local cards missing from Bandai’s current list');
  });
});
