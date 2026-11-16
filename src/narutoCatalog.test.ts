import { describe, expect, it } from 'vitest';
import { emptyVault } from './domain';
import narutoCatalogData from '../public/naruto-catalog.json';
import {
  applyNarutoCatalogUpdate,
  parseNarutoCatalogUpdate,
  planNarutoCatalogUpdate,
} from './narutoCatalog';

const PROVISIONAL_NOTE = 'Provisional rarity index; exact card name and printed number are unverified.';

describe('Kayou Naruto catalog import', () => {
  it('accepts all eight verified North American lists and their image links', () => {
    const update = parseNarutoCatalogUpdate(narutoCatalogData);
    expect(update.sets).toHaveLength(8);
    expect(update.cards).toHaveLength(1202);
    expect(update.cards.filter((card) => card.imageUrl)).toHaveLength(1202);
    expect(update.cards.filter((card) => card.isPromo)).toHaveLength(14);
    expect(update.sets.find((set) => set.code === 'NREA02')).toMatchObject({ cardCount: 133, trackedByDefault: true });
    expect(update.sets.find((set) => set.code === 'NREA03')).toMatchObject({ cardCount: 123, trackedByDefault: true });
    expect(update.sets.filter((set) => !set.trackedByDefault)).toHaveLength(6);
  });

  it('uses set-namespaced IDs for equal rarity slots across different sets', () => {
    const update = parseNarutoCatalogUpdate(narutoCatalogData);
    const sameSlot = update.cards.filter((card) => card.provisionalNumber === 'R001');
    expect(sameSlot.length).toBeGreaterThan(1);
    expect(new Set(sameSlot.map((card) => card.id)).size).toBe(sameSlot.length);
    expect(new Set(sameSlot.map((card) => card.setId)).size).toBe(sameSlot.length);
  });

  it('rejects an incomplete set, repeated card identity, or unapproved image URL', () => {
    const update = parseNarutoCatalogUpdate(narutoCatalogData);
    expect(() => parseNarutoCatalogUpdate({ ...update, sets: update.sets.slice(1) })).toThrow('incomplete');
    expect(() => parseNarutoCatalogUpdate({ ...update, cards: update.cards.slice(1) })).toThrow('incomplete');
    expect(() => parseNarutoCatalogUpdate({
      ...update,
      cards: update.cards.map((card, index) => index === 0 ? { ...card, id: update.cards[1].id } : card),
    })).toThrow();
    expect(() => parseNarutoCatalogUpdate({
      ...update,
      cards: update.cards.map((card, index) => index === 0 ? { ...card, imageUrl: 'https://example.com/wrong-card.png' } : card),
    })).toThrow('unapproved image URL');
    expect(() => parseNarutoCatalogUpdate({
      ...update,
      cards: update.cards.map((card, index) => index === 0 ? { ...card, isPromo: !card.isPromo } : card),
    })).toThrow('invalid card details');
  });

  it('adds all sets, names, card numbers, and images while preserving inventory and personal images', () => {
    const update = parseNarutoCatalogUpdate(narutoCatalogData);
    const vault = emptyVault();
    const earlierCards = update.cards.filter((card) => ['NREA02', 'NREA03'].some((code) => card.id.startsWith('kayou-naruto:' + code + ':') && !card.isPromo));
    expect(earlierCards).toHaveLength(254);
    for (const entry of earlierCards) {
      vault.catalog.cards.push({
        id: entry.id, setId: entry.setId, number: entry.provisionalNumber, name: '', rarity: entry.rarity,
        sourceNote: PROVISIONAL_NOTE + ' Duplicate quantity was not supplied.',
      });
    }
    const ownedCardId = 'kayou-naruto:NREA02:R001';
    const ownership = { cardId: ownedCardId, personal: 2, duplicates: 3, duplicatesKnown: false, incoming: 1, updatedAt: '2026-11-15T00:00:00Z' };
    const userImage = {
      id: ownedCardId + ':personal-photo', cardId: ownedCardId, name: 'My photo',
      imageUrls: [{ url: 'https://example.com/my-card.jpg', source: 'user-provided' as const }],
    };
    vault.catalog.ownership.push(ownership);
    vault.catalog.variants.push(userImage);
    const customCardId = 'kayou-naruto:NREA02:R002';
    vault.catalog.cards.find((card) => card.id === customCardId)!.name = 'My custom card name';

    const plan = planNarutoCatalogUpdate(vault, update);
    expect(plan).toMatchObject({
      setsToAdd: 6,
      cardsToAdd: 948,
      namesToFill: 253,
      numbersToUpdate: 254,
      imagesToAdd: 1202,
      customNamesToPreserve: 1,
      conflicts: [],
      hasChanges: true,
    });

    const imported = applyNarutoCatalogUpdate(vault, update);
    expect(imported.catalog.sets.filter((set) => set.seriesId === 'series:kayou-naruto')).toHaveLength(8);
    expect(imported.catalog.cards.filter((card) => update.sets.some((set) => set.id === card.setId))).toHaveLength(1202);
    expect(imported.catalog.sets.find((set) => set.id === 'set:kayou-naruto-nrea02')).toMatchObject({
      name: 'NREA02 · Earth Scroll 2', expectedCardCount: 133, tracked: true,
    });
    expect(imported.catalog.sets.find((set) => set.id === 'set:kayou-naruto-nrsa01')).toMatchObject({
      name: 'NRSA01 · Heaven Scroll', expectedCardCount: 159, tracked: false,
    });
    expect(imported.catalog.sets.find((set) => set.id === 'set:kayou-naruto-nrea03')?.tracked).toBe(true);
    expect(imported.catalog.cards.find((card) => card.id === customCardId)?.name).toBe('My custom card name');
    expect(imported.catalog.ownership).toEqual([ownership]);
    expect(imported.catalog.variants).toContainEqual(userImage);
    expect(imported.catalog.variants.filter((variant) => variant.id.endsWith(':narutodb'))).toHaveLength(1202);
    expect(imported.catalog.cards.find((card) => card.id === 'kayou-naruto:NREA02:PR003')).toMatchObject({ category: 'Promo' });
  });

  it('preserves an explicit set visibility choice and pauses on local catalog conflicts', () => {
    const update = parseNarutoCatalogUpdate(narutoCatalogData);
    const vault = emptyVault();
    vault.catalog.sets.find((set) => set.id === 'set:kayou-naruto-nrea02')!.tracked = false;
    const imported = applyNarutoCatalogUpdate(vault, update);
    expect(imported.catalog.sets.find((set) => set.id === 'set:kayou-naruto-nrea02')?.tracked).toBe(false);
    expect(imported.catalog.sets.find((set) => set.id === 'set:kayou-naruto-nrea03')?.tracked).toBe(true);

    const conflicted = emptyVault();
    conflicted.catalog.cards.push({ id: 'local:extra-nrea02', setId: 'set:kayou-naruto-nrea02', number: 'CUSTOM', name: 'My extra card' });
    const before = JSON.stringify(conflicted);
    expect(planNarutoCatalogUpdate(conflicted, update).conflicts.join(' ')).toContain('absent from the verified catalog');
    expect(() => applyNarutoCatalogUpdate(conflicted, update)).toThrow('paused for review');
    expect(JSON.stringify(conflicted)).toBe(before);
  });
});
