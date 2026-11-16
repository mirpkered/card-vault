import {
  validateCatalog,
  type CardSet,
  type CardVariant,
  type Franchise,
  type Publisher,
  type Series,
  type VaultData,
} from './domain';

export type FinalFantasyCatalogCard = { number: string; name: string; rarity: 'C' | 'R' | 'H' | 'L'; imageUrl: string };
export type FinalFantasyCatalogUpdate = {
  schemaVersion: 1;
  source: 'Square Enix official Card Browser';
  cataloguedAt: string;
  browserUrl: string;
  productUrl: string;
  release: {
    id: 'set:final-fantasy-tcg:memories-of-life';
    seriesId: 'series:final-fantasy-tcg';
    name: 'Memories of Life';
    releaseNumber: 'Opus 30';
    expectedCardCount: 118;
    rarityScheme: ['C', 'R', 'H', 'L'];
    rarityCounts: { C: 48; R: 30; H: 26; L: 14 };
  };
  cards: FinalFantasyCatalogCard[];
};

export type FinalFantasyCatalogUpdatePlan = {
  recordsToAdd: number;
  cardsToAdd: number;
  imagesToAdd: number;
  conflicts: string[];
  hasChanges: boolean;
};

const SOURCE = 'Square Enix official Card Browser';
const BROWSER_URL = 'https://fftcg.square-enix-games.com/na/card-browser';
const PRODUCT_URL = 'https://fftcg.square-enix-games.com/na/news/new-product-information-memories-of-life-booster-set';
const RELEASE_ID = 'set:final-fantasy-tcg:memories-of-life';
const SERIES_ID = 'series:final-fantasy-tcg';
const EXPECTED_RARITIES = { C: 48, R: 30, H: 26, L: 14 } as const;
const CARD_NUMBER = /^30-\d{3}[CRHL](?:\/\d{1,2}-\d{3}[CRHL])?$/;

function definitions(update: FinalFantasyCatalogUpdate) {
  const publisher: Publisher = { id: 'publisher:square-enix', name: 'Square Enix' };
  const franchise: Franchise = { id: 'franchise:final-fantasy', publisherId: publisher.id, name: 'Final Fantasy' };
  const series: Series = { id: SERIES_ID, franchiseId: franchise.id, name: 'Final Fantasy TCG', category: 'cards' };
  const set: CardSet = {
    id: update.release.id,
    seriesId: series.id,
    name: update.release.name,
    releaseNumber: update.release.releaseNumber,
    expectedCardCount: update.release.expectedCardCount,
    rarityScheme: [...update.release.rarityScheme],
  };
  return { publisher, franchise, series, set };
}

function cardId(setId: string, number: string) { return `${setId}:${number}`; }

export function parseFinalFantasyCatalogUpdate(value: unknown): FinalFantasyCatalogUpdate {
  if (!value || typeof value !== 'object') throw new Error('Final Fantasy catalog update must be a JSON object.');
  const update = value as Partial<FinalFantasyCatalogUpdate>;
  if (update.schemaVersion !== 1 || update.source !== SOURCE || update.browserUrl !== BROWSER_URL || update.productUrl !== PRODUCT_URL || !Array.isArray(update.cards) || !update.release) {
    throw new Error('Final Fantasy catalog update has an unsupported format or source.');
  }
  if (!Number.isFinite(Date.parse(update.cataloguedAt ?? ''))
    || update.release.id !== RELEASE_ID
    || update.release.seriesId !== SERIES_ID
    || update.release.name !== 'Memories of Life'
    || update.release.releaseNumber !== 'Opus 30'
    || update.release.expectedCardCount !== 118
    || JSON.stringify(update.release.rarityScheme) !== JSON.stringify(['C', 'R', 'H', 'L'])
    || JSON.stringify(update.release.rarityCounts) !== JSON.stringify(EXPECTED_RARITIES)) {
    throw new Error('Final Fantasy catalog release details failed validation.');
  }
  if (update.cards.length !== 118) throw new Error('Memories of Life is incomplete; expected all 118 standard cards.');

  const numbers = new Set<string>();
  const rarityCounts = { C: 0, R: 0, H: 0, L: 0 };
  for (const card of update.cards) {
    if (!card || typeof card.number !== 'string' || !CARD_NUMBER.test(card.number)
      || typeof card.name !== 'string' || !card.name.trim()
      || !Object.hasOwn(EXPECTED_RARITIES, card.rarity)
      || card.number.split('/')[0].slice(-1) !== card.rarity) {
      throw new Error('Final Fantasy catalog contains a card with invalid identity or details.');
    }
    if (numbers.has(card.number)) throw new Error('Final Fantasy catalog repeats card ' + card.number + '.');
    let imageUrl: URL;
    try { imageUrl = new URL(card.imageUrl); } catch { throw new Error('Final Fantasy catalog has an invalid image URL for ' + card.number + '.'); }
    if (imageUrl.protocol !== 'https:' || imageUrl.hostname !== 'fftcg.cdn.sewest.net'
      || !imageUrl.pathname.startsWith('/images/cards/full/')
      || !imageUrl.pathname.toLowerCase().endsWith('.jpg')) {
      throw new Error('Final Fantasy catalog has an unapproved image host or path for ' + card.number + '.');
    }
    numbers.add(card.number);
    rarityCounts[card.rarity]++;
  }
  for (const [rarity, expected] of Object.entries(EXPECTED_RARITIES)) {
    if (rarityCounts[rarity as keyof typeof rarityCounts] !== expected) throw new Error('Final Fantasy catalog has an incomplete ' + rarity + ' rarity list.');
  }
  return update as FinalFantasyCatalogUpdate;
}

export function planFinalFantasyCatalogUpdate(vault: VaultData, update: FinalFantasyCatalogUpdate): FinalFantasyCatalogUpdatePlan {
  const { publisher, franchise, series, set } = definitions(update);
  const conflicts: string[] = [];
  let recordsToAdd = 0;
  const checkRecord = (records: { id: string }[], expected: { id: string }, label: string) => {
    const existing = records.find((record) => record.id === expected.id);
    if (!existing) recordsToAdd++;
    else if (JSON.stringify(existing) !== JSON.stringify(expected)) conflicts.push(`${label} ${expected.id} already exists with different details.`);
  };
  checkRecord(vault.catalog.publishers, publisher, 'Publisher');
  checkRecord(vault.catalog.franchises, franchise, 'Franchise');
  checkRecord(vault.catalog.series, series, 'Series');
  checkRecord(vault.catalog.sets, set, 'Set');

  const existingCards = new Map(vault.catalog.cards.map((card) => [card.id, card]));
  const existingVariants = new Map(vault.catalog.variants.map((variant) => [variant.id, variant]));
  let cardsToAdd = 0;
  let imagesToAdd = 0;
  for (const entry of update.cards) {
    const id = cardId(set.id, entry.number);
    const current = existingCards.get(id);
    if (!current) cardsToAdd++;
    else if (current.setId !== set.id) conflicts.push(`Card ${id} belongs to a different set.`);
    const variantId = id + ':square-enix-official';
    const image = existingVariants.get(variantId);
    if (!image) imagesToAdd++;
    else if (image.cardId !== id || image.imageUrls[0]?.url !== entry.imageUrl) conflicts.push(`Official image record for ${entry.number} already differs.`);
  }
  return { recordsToAdd, cardsToAdd, imagesToAdd, conflicts, hasChanges: recordsToAdd + cardsToAdd + imagesToAdd > 0 };
}

export function applyFinalFantasyCatalogUpdate(vault: VaultData, update: FinalFantasyCatalogUpdate): VaultData {
  const plan = planFinalFantasyCatalogUpdate(vault, update);
  if (plan.conflicts.length) throw new Error('Final Fantasy catalog update paused for review: ' + plan.conflicts.join(' '));

  const { publisher, franchise, series, set } = definitions(update);
  const publishers = new Map(vault.catalog.publishers.map((item) => [item.id, item]));
  const franchises = new Map(vault.catalog.franchises.map((item) => [item.id, item]));
  const seriesRecords = new Map(vault.catalog.series.map((item) => [item.id, item]));
  const sets = new Map(vault.catalog.sets.map((item) => [item.id, item]));
  const cards = new Map(vault.catalog.cards.map((item) => [item.id, item]));
  const variants = new Map(vault.catalog.variants.map((item) => [item.id, item]));
  publishers.set(publisher.id, publishers.get(publisher.id) ?? publisher);
  franchises.set(franchise.id, franchises.get(franchise.id) ?? franchise);
  seriesRecords.set(series.id, seriesRecords.get(series.id) ?? series);
  sets.set(set.id, sets.get(set.id) ?? set);

  for (const entry of update.cards) {
    const id = cardId(set.id, entry.number);
    cards.set(id, cards.get(id) ?? { id, setId: set.id, number: entry.number, name: entry.name, rarity: entry.rarity });
    const variantId = id + ':square-enix-official';
    if (!variants.has(variantId)) {
      const variant: CardVariant = {
        id: variantId,
        cardId: id,
        name: 'Official card image',
        imageUrls: [{ url: entry.imageUrl, source: 'verified-remote', verifiedAt: update.cataloguedAt }],
      };
      variants.set(variantId, variant);
    }
  }

  const result: VaultData = {
    ...vault,
    updatedAt: new Date().toISOString(),
    catalog: {
      ...vault.catalog,
      publishers: [...publishers.values()],
      franchises: [...franchises.values()],
      series: [...seriesRecords.values()],
      sets: [...sets.values()],
      cards: [...cards.values()],
      variants: [...variants.values()],
    },
  };
  const errors = validateCatalog(result.catalog);
  if (errors.length) throw new Error('Final Fantasy catalog update failed validation: ' + errors.join(' '));
  return result;
}
