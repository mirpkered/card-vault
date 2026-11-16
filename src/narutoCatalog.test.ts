import { describe, expect, it } from 'vitest';
import { emptyVault } from './domain';
import narutoCatalogData from '../public/naruto-catalog.json';
import {
  applyNarutoCatalogUpdate,
  parseNarutoCatalogUpdate,
  planNarutoCatalogUpdate,
  type NarutoCatalogCard,
  type NarutoCatalogUpdate,
} from './narutoCatalog';

function completeUpdate(): NarutoCatalogUpdate {
  const sets = [
    { id: 'set:kayou-naruto-nrea02', name: 'NREA02', cardCount: 133, sourceUrl: 'https://narutodb.com/kayou/sets/NREA02' },
    { id: 'set:kayou-naruto-nrea03', name: 'NREA03', cardCount: 123, sourceUrl: 'https://narutodb.com/kayou/sets/NREA03' },
  ];
  const cards: NarutoCatalogCard[] = [];
  const rarities = {
    NREA02: { CR: 4, '◇UR': 4, AR: 10, MR: 4, UR: 15, SSR: 25, SR: 20, R: 50, PR: 1 },
    NREA03: { CR: 4, SP: 4, MR: 4, UR: 15, SSR: 25, SR: 20, R: 50, PR: 1 },
  };
  for (const set of sets) {
    const code = set.name;
    for (const [rarity, count] of Object.entries(rarities[code as keyof typeof rarities])) {
      for (let index = 1; index <= count; index++) {
        const isPromo = rarity === 'PR';
        const idPrefix = rarity === '◇UR' ? 'PARALLEL_UR' : rarity;
        const slot = idPrefix + String(index).padStart(3, '0');
        cards.push({
          id: 'kayou-naruto:' + code + ':' + slot,
          setId: set.id,
          provisionalNumber: slot,
          number: code + '-' + rarity + '-' + String(index).padStart(3, '0'),
          name: 'Card ' + code + ' ' + rarity + ' ' + index,
          rarity,
          imageUrl: null,
          isPromo,
        });
      }
    }
  }
  return {
    schemaVersion: 1,
    source: 'NarutoDB',
    cataloguedAt: '2026-11-16T00:00:00Z',
    sourcePages: { NREA02: sets[0].sourceUrl, NREA03: sets[1].sourceUrl },
    sets,
    cards,
  };
}

describe('Naruto catalog enrichment', () => {
  it('accepts the generated public NarutoDB catalog', () => {
    const update = parseNarutoCatalogUpdate(narutoCatalogData);
    expect(update.cards).toHaveLength(256);
    expect(update.cards.filter((card) => card.imageUrl)).toHaveLength(256);
    expect(update.cards.filter((card) => card.isPromo)).toHaveLength(2);
  });

  it('accepts only complete, uniquely identified set catalogs', () => {
    const update = completeUpdate();
    expect(parseNarutoCatalogUpdate(update).cards).toHaveLength(256);
    expect(() => parseNarutoCatalogUpdate({ ...update, cards: update.cards.slice(0, -1) })).toThrow('incomplete');
    expect(() => parseNarutoCatalogUpdate({
      ...update,
      cards: update.cards.map((card, index) => index === 0 ? { ...card, id: update.cards[1].id } : card),
    })).toThrow();
  });

  it('fills verified catalog details and preserves quantities and user images', () => {
    const vault = emptyVault();
    const cardId = 'kayou-naruto:NREA02:R001';
    const card = {
      id: cardId,
      setId: 'set:kayou-naruto-nrea02',
      number: 'R001',
      name: '',
      rarity: 'R',
      sourceNote: 'Provisional rarity index; exact card name and printed number are unverified. Duplicate quantity was not supplied.',
    };
    vault.catalog.cards.push(card);
    const ownership = {
      cardId, personal: 2, duplicates: 1, duplicatesKnown: false, incoming: 3, updatedAt: '2026-11-15',
    };
    vault.catalog.ownership.push(ownership);
    const userImage = {
      id: cardId + ':personal-photo',
      cardId,
      name: 'My photo',
      imageUrls: [{ url: 'https://example.com/my-card.jpg', source: 'user-provided' as const }],
    };
    vault.catalog.variants.push(userImage);

    const promoId = 'kayou-naruto:NREA02:PR003';
    const update: NarutoCatalogUpdate = {
      ...completeUpdate(),
      cards: [
        {
          id: cardId, setId: card.setId, provisionalNumber: 'R001', number: 'NREA02-R-001L1',
          name: 'Eye to Eye: Sharingan vs Sharingan', rarity: 'R',
          imageUrl: 'https://cdn.narutodb.com/storage/cards/official/NREA02-R-001L1-thumb.png', isPromo: false,
        },
        {
          id: promoId, setId: card.setId, provisionalNumber: 'PR003', number: 'NREA-PR-003',
          name: 'Naruto Uzumaki', rarity: 'PR',
          imageUrl: 'https://cdn.narutodb.com/storage/cards/NREA/NREA-PR-003_thumb.png', isPromo: true,
        },
      ],
    };

    const plan = planNarutoCatalogUpdate(vault, update);
    expect(plan).toMatchObject({ cardsToAdd: 1, namesToFill: 2, numbersToUpdate: 1, imagesToAdd: 2, sourceNotesToRefresh: 1 });

    const updated = applyNarutoCatalogUpdate(vault, update);
    expect(updated.catalog.cards.find((item) => item.id === cardId)).toMatchObject({
      name: 'Eye to Eye: Sharingan vs Sharingan',
      number: 'NREA02-R-001L1',
      sourceNote: 'Catalog code verified by NarutoDB: NREA02-R-001L1. Duplicate quantity was not supplied.',
    });
    expect(updated.catalog.cards.find((item) => item.id === promoId)).toMatchObject({
      name: 'Naruto Uzumaki', number: 'NREA-PR-003', rarity: 'PR', category: 'Promo',
    });
    expect(updated.catalog.ownership).toEqual([ownership]);
    expect(updated.catalog.variants).toContainEqual(userImage);
    expect(updated.catalog.variants.filter((item) => item.id.endsWith(':narutodb'))).toHaveLength(2);
  });
});
