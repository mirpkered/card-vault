import { describe, expect, it } from 'vitest';
import { completion, emptyVault, fullArtBonusCardId } from './domain';
import catalogData from '../public/fftcg-catalog.json';
import previousMemoriesData from './fixtures/fftcg-memories-of-life-v1.json';
import {
  applyFinalFantasyCatalogUpdate,
  parseFinalFantasyCatalogUpdate,
  planFinalFantasyCatalogUpdate,
} from './finalFantasyCatalog';

describe('Final Fantasy TCG catalog import', () => {
  it('accepts every official browser set and all set-specific card definitions', () => {
    const update = parseFinalFantasyCatalogUpdate(catalogData);
    expect(update.schemaVersion).toBe(3);
    expect(update.sets).toHaveLength(34);
    expect(update.cards).toHaveLength(4404);
    expect(update.sourceCardCount).toBe(4391);
    expect(update.sets.find((set) => set.name === 'Memories of Life')?.cardCount).toBe(134);
    expect(update.cards.filter((card) => !card.name || !card.rarity)).toHaveLength(8);
    expect(update.cards.find((card) => card.number === '30-086C/6-106H')).toMatchObject({ name: 'Aymeric', rarity: 'C' });
    expect(update.sets.filter((set) => set.trackedByDefault).map((set) => set.name)).toEqual(['Memories of Life']);
    expect(update.cards.every((card) => card.imageUrls.length > 0)).toBe(true);
    expect(update.cards.every((card) => card.variants.some((variant) => variant.treatment === 'normal') && card.variants.some((variant) => variant.treatment === 'foil'))).toBe(true);
    const versionTotals = update.cards.flatMap((card) => card.variants).reduce<Record<string, number>>((counts, variant) => ({ ...counts, [variant.treatment]: (counts[variant.treatment] ?? 0) + 1 }), {});
    expect(versionTotals).toMatchObject({ normal: 4404, foil: 4404, 'full-art': 765 });
    const caius = update.cards.find((card) => card.setId.endsWith(':hidden-trials') && card.number === '23-002L')!;
    expect(caius.variants.map((variant) => [variant.treatment, variant.imageUrls[0]])).toEqual([
      ['normal', 'https://fftcg.cdn.sewest.net/images/cards/full/23-002L_eg.jpg'],
      ['foil', 'https://fftcg.cdn.sewest.net/images/cards/full/23-002L_eg_Premium.jpg'],
      ['full-art', 'https://fftcg.cdn.sewest.net/images/cards/full/23-002L_eg_FL.jpg'],
    ]);
    const memories = update.sets.find((set) => set.name === 'Memories of Life')!;
    expect(update.cards.filter((card) => card.setId === memories.id && card.variants.some((variant) => variant.treatment === 'full-art'))).toHaveLength(35);
    expect(update.cards.find((card) => card.setId === memories.id && card.number === '7-034L')?.variants).toContainEqual(expect.objectContaining({ treatment: 'special', name: 'Noir' }));
  });

  it('rejects a missing set, incomplete set, duplicate identity, or unapproved image URL', () => {
    const update = parseFinalFantasyCatalogUpdate(catalogData);
    expect(() => parseFinalFantasyCatalogUpdate({ ...update, sets: update.sets.slice(1) })).toThrow('full official set list');
    expect(() => parseFinalFantasyCatalogUpdate({ ...update, cards: update.cards.slice(1) })).toThrow('incomplete');
    const duplicate = [...update.cards];
    duplicate[1] = { ...duplicate[1], setId: duplicate[0].setId, number: duplicate[0].number };
    expect(() => parseFinalFantasyCatalogUpdate({ ...update, cards: duplicate })).toThrow('repeats a card code');
    expect(() => parseFinalFantasyCatalogUpdate({
      ...update,
      cards: update.cards.map((card, index) => index === 0 ? { ...card, imageUrls: ['https://example.com/card.jpg'] } : card),
    })).toThrow('invalid identity, details, or image source');
    expect(() => parseFinalFantasyCatalogUpdate({
      ...update,
      cards: update.cards.map((card, index) => index === 0 ? { ...card, variants: card.variants.slice(1) } : card),
    })).toThrow('variant details that do not match');
  });

  it('expands the earlier 118-card checklist without changing ownership or user images', () => {
    const update = parseFinalFantasyCatalogUpdate(catalogData);
    const old = previousMemoriesData as { release: { id: string; seriesId: string; name: string; releaseNumber: string; expectedCardCount: number; rarityScheme: string[] }; cards: { number: string; name: string; rarity: string; imageUrl: string }[]; cataloguedAt: string };
    const vault = emptyVault();
    vault.catalog.publishers.push({ id: 'publisher:square-enix', name: 'Square Enix' });
    vault.catalog.franchises.push({ id: 'franchise:final-fantasy', publisherId: 'publisher:square-enix', name: 'Final Fantasy' });
    vault.catalog.series.push({ id: old.release.seriesId, franchiseId: 'franchise:final-fantasy', name: 'Final Fantasy TCG', category: 'cards' });
    vault.catalog.sets.push({ ...old.release, tracked: true });
    for (const entry of old.cards) {
      const id = `${old.release.id}:${entry.number}`;
      vault.catalog.cards.push({ id, setId: old.release.id, number: entry.number, name: entry.name, rarity: entry.rarity });
      vault.catalog.variants.push({ id: `${id}:square-enix-official`, cardId: id, name: 'Official card image', imageUrls: [{ url: entry.imageUrl, source: 'verified-remote', verifiedAt: old.cataloguedAt }] });
    }
    const ownedCardId = `${old.release.id}:${old.cards[0].number}`;
    const ownership = { cardId: ownedCardId, personal: 2, duplicates: 3, incoming: 1, updatedAt: '2026-11-15T00:00:00.000Z' };
    const userImage = { id: ownedCardId + ':personal-photo', cardId: ownedCardId, name: 'Personal photo', imageUrls: [{ url: 'https://example.com/my-card.jpg', source: 'user-provided' as const }] };
    vault.catalog.ownership.push(ownership);
    vault.catalog.variants.push(userImage);

    const fullArtCount = update.cards.filter((entry) => entry.variants.some((variant) => variant.treatment === 'full-art')).length;
    expect(planFinalFantasyCatalogUpdate(vault, update)).toMatchObject({ setsToAdd: 33, cardsToAdd: 4404 - 118 + fullArtCount, conflicts: [], hasChanges: true });
    const imported = applyFinalFantasyCatalogUpdate(vault, update);
    const memories = update.sets.find((set) => set.name === 'Memories of Life')!;

    expect(imported.catalog.sets.filter((set) => set.seriesId === 'series:final-fantasy-tcg')).toHaveLength(34);
    expect(imported.catalog.sets.find((set) => set.id === memories.id)).toMatchObject({ expectedCardCount: 134, tracked: true });
    expect(imported.catalog.sets.filter((set) => set.seriesId === 'series:final-fantasy-tcg' && set.tracked).map((set) => set.name)).toEqual(['Memories of Life']);
    expect(imported.catalog.cards.filter((card) => card.setId === memories.id && card.countsTowardSetCompletion !== false)).toHaveLength(134);
    expect(imported.catalog.cards.filter((card) => card.setId === memories.id && card.countsTowardSetCompletion === false)).toHaveLength(35);
    expect(imported.catalog.ownership).toEqual([{ ...ownership, variantId: `${ownedCardId}:fftcg:normal` }]);
    expect(imported.catalog.variants).toContainEqual(userImage);
    const officialVariant = imported.catalog.variants.find((variant) => variant.id === `${ownedCardId}:square-enix-official`)!;
    expect(officialVariant.imageUrls.map((image) => image.url)).toEqual([old.cards[0].imageUrl]);
    const newNormal = imported.catalog.variants.find((variant) => variant.id === `${ownedCardId}:fftcg:normal`);
    expect(newNormal).toMatchObject({ name: 'Normal', treatment: 'normal' });
    expect(newNormal?.imageUrls.map((image) => image.url)).toEqual(update.cards.find((card) => card.setId === memories.id && card.number === old.cards[0].number)?.variants.find((variant) => variant.treatment === 'normal')?.imageUrls);
    expect(imported.catalog.variants.find((variant) => variant.id === `${ownedCardId}:fftcg:foil`)).toMatchObject({ name: 'Foil', treatment: 'foil' });
    expect(planFinalFantasyCatalogUpdate(vault, update).ownershipToNormalize).toBe(1);
  });

    it('creates Normal/Foil variants and a separate optional Full Art entry', () => {
    const update = parseFinalFantasyCatalogUpdate(catalogData);
    const imported = applyFinalFantasyCatalogUpdate(emptyVault(), update);
    const caius = update.cards.find((card) => card.setId.endsWith(':hidden-trials') && card.number === '23-002L')!;
    const cardId = `${caius.setId}:${caius.number}`;
    const normalId = `${cardId}:fftcg:normal`;
    const foilId = `${cardId}:fftcg:foil`;
    const fullArtCardId = fullArtBonusCardId(cardId);
    const fullArtVariantId = `${cardId}:fftcg:full-art`;
    imported.catalog.ownership.push(
      { cardId, variantId: normalId, personal: 1, duplicates: 0, incoming: 0, updatedAt: '2026-11-16' },
      { cardId, variantId: foilId, personal: 2, duplicates: 1, incoming: 1, updatedAt: '2026-11-16' },
      { cardId: fullArtCardId, variantId: fullArtVariantId, personal: 1, duplicates: 0, incoming: 0, updatedAt: '2026-11-16' },
    );
    expect(imported.catalog.ownership.filter((item) => item.cardId === cardId)).toHaveLength(2);
    expect(imported.catalog.ownership.find((item) => item.cardId === fullArtCardId)).toMatchObject({ variantId: fullArtVariantId, personal: 1 });
    expect(imported.catalog.cards.filter((item) => item.id === cardId)).toHaveLength(1);
    expect(imported.catalog.cards.find((item) => item.id === fullArtCardId)).toMatchObject({ countsTowardSetCompletion: false, relatedCardId: cardId, bonusLabel: 'Full Art' });
    expect(imported.catalog.variants.find((variant) => variant.id === fullArtVariantId)).toMatchObject({ cardId: fullArtCardId, treatment: 'full-art' });
    expect(imported.catalog.ownership.reduce((sum, item) => sum + item.personal + item.duplicates, 0)).toBe(5);
    expect(completion(imported.catalog.cards.filter((item) => item.id === cardId || item.id === fullArtCardId), imported.catalog.ownership)).toEqual({ owned: 1, total: 1, percent: 100 });
    expect(completion([imported.catalog.cards.find((item) => item.id === fullArtCardId)!], [{ cardId: fullArtCardId, variantId: fullArtVariantId, personal: 1, duplicates: 0, incoming: 0, updatedAt: '2026-11-16' }])).toEqual({ owned: 0, total: 0, percent: 0 });
  });

  it('pauses if both a legacy quantity row and a Normal row exist for one card', () => {
    const update = parseFinalFantasyCatalogUpdate(catalogData);
    const imported = applyFinalFantasyCatalogUpdate(emptyVault(), update);
    const card = update.cards.find((entry) => entry.number === '23-002L' && entry.setId.endsWith(':hidden-trials'))!;
    const cardId = `${card.setId}:${card.number}`;
    imported.catalog.ownership.push(
      { cardId, personal: 1, duplicates: 0, incoming: 0, updatedAt: 'legacy' },
      { cardId, variantId: `${cardId}:fftcg:normal`, personal: 2, duplicates: 0, incoming: 0, updatedAt: 'normal' },
    );
    const before = JSON.stringify(imported);
    const plan = planFinalFantasyCatalogUpdate(imported, update);
    expect(plan.conflicts).toContain(`Card ${cardId} has both legacy and Normal-version quantities; review them before importing.`);
    expect(() => applyFinalFantasyCatalogUpdate(imported, update)).toThrow('paused for review');
    expect(JSON.stringify(imported)).toBe(before);
  });

  it('preserves an explicit hidden-set choice and pauses when a parent identity conflicts', () => {
    const update = parseFinalFantasyCatalogUpdate(catalogData);
    const vault = emptyVault();
    vault.catalog.publishers.push({ id: 'publisher:square-enix', name: 'Different publisher' });
    const before = JSON.stringify(vault);
    expect(planFinalFantasyCatalogUpdate(vault, update).conflicts).toContain('Publisher publisher:square-enix already exists with different details.');
    expect(() => applyFinalFantasyCatalogUpdate(vault, update)).toThrow('paused for review');
    expect(JSON.stringify(vault)).toBe(before);

    const clean = emptyVault();
    const imported = applyFinalFantasyCatalogUpdate(clean, update);
    const opusOne = imported.catalog.sets.find((set) => set.name === 'Opus I')!;
    const hidden = { ...imported, catalog: { ...imported.catalog, sets: imported.catalog.sets.map((set) => set.id === opusOne.id ? { ...set, tracked: false } : set) } };
    expect(applyFinalFantasyCatalogUpdate(hidden, update).catalog.sets.find((set) => set.id === opusOne.id)?.tracked).toBe(false);
  });
});
