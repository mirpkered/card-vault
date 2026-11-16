import { describe, expect, it } from 'vitest';
import { emptyVault } from './domain';
import catalogData from '../public/fftcg-memories-of-life.json';
import {
  applyFinalFantasyCatalogUpdate,
  parseFinalFantasyCatalogUpdate,
  planFinalFantasyCatalogUpdate,
} from './finalFantasyCatalog';

describe('Final Fantasy TCG Memories of Life catalog import', () => {
  it('accepts the complete official standard-card list and verifies its rarity breakdown', () => {
    const update = parseFinalFantasyCatalogUpdate(catalogData);
    expect(update.cards).toHaveLength(118);
    expect(update.release.rarityCounts).toEqual({ C: 48, R: 30, H: 26, L: 14 });
    expect(update.cards.find((card) => card.number === '30-086C/6-106H')).toMatchObject({ name: 'Aymeric', rarity: 'C' });
  });

  it('rejects incomplete, duplicated, or unapproved catalog records', () => {
    const update = parseFinalFantasyCatalogUpdate(catalogData);
    expect(() => parseFinalFantasyCatalogUpdate({ ...update, cards: update.cards.slice(1) })).toThrow('incomplete');
    expect(() => parseFinalFantasyCatalogUpdate({ ...update, cards: [...update.cards.slice(0, -1), update.cards[0]] })).toThrow('repeats');
    expect(() => parseFinalFantasyCatalogUpdate({
      ...update,
      cards: update.cards.map((card, index) => index === 0 ? { ...card, imageUrl: 'https://example.com/card.jpg' } : card),
    })).toThrow('unapproved image host');
  });

  it('adds a blank checklist and official image links while preserving existing quantities and user images', () => {
    const update = parseFinalFantasyCatalogUpdate(catalogData);
    const vault = emptyVault();
    const ownedCard = { id: 'set:kayou-naruto-nrea02:existing-test-card', setId: 'set:kayou-naruto-nrea02', number: 'TEST01', name: 'Existing owned card' };
    vault.catalog.cards.push(ownedCard);
    const ownership = { cardId: ownedCard.id, personal: 2, duplicates: 3, incoming: 1, updatedAt: '2026-11-15T00:00:00.000Z' };
    const userImage = {
      id: ownedCard.id + ':personal-photo', cardId: ownedCard.id, name: 'Personal photo',
      imageUrls: [{ url: 'https://example.com/my-card.jpg', source: 'user-provided' as const }],
    };
    vault.catalog.ownership.push(ownership);
    vault.catalog.variants.push(userImage);

    expect(planFinalFantasyCatalogUpdate(vault, update)).toMatchObject({ recordsToAdd: 4, cardsToAdd: 118, imagesToAdd: 118, conflicts: [], hasChanges: true });
    const imported = applyFinalFantasyCatalogUpdate(vault, update);

    expect(imported.catalog.sets.find((set) => set.id === update.release.id)).toMatchObject({ name: 'Memories of Life', releaseNumber: 'Opus 30', expectedCardCount: 118 });
    expect(imported.catalog.cards.filter((card) => card.setId === update.release.id)).toHaveLength(118);
    expect(imported.catalog.cards.some((card) => card.id === `${update.release.id}:30-002C`)).toBe(true);
    expect(imported.catalog.ownership).toEqual([ownership]);
    expect(imported.catalog.variants).toContainEqual(userImage);
    expect(imported.catalog.variants.find((variant) => variant.id === `${update.release.id}:30-002C:square-enix-official`)).toMatchObject({
      imageUrls: [{ source: 'verified-remote', url: update.cards.find((card) => card.number === '30-002C')?.imageUrl }],
    });
  });

  it('pauses if a catalog identity already contains different parent details', () => {
    const update = parseFinalFantasyCatalogUpdate(catalogData);
    const vault = emptyVault();
    vault.catalog.publishers.push({ id: 'publisher:square-enix', name: 'Different publisher' });
    const before = JSON.stringify(vault);
    expect(planFinalFantasyCatalogUpdate(vault, update).conflicts).toContain('Publisher publisher:square-enix already exists with different details.');
    expect(() => applyFinalFantasyCatalogUpdate(vault, update)).toThrow('paused for review');
    expect(JSON.stringify(vault)).toBe(before);
  });
});
