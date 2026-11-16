import {
  validateCatalog,
  type CardVariant,
  type Franchise,
  type Publisher,
  type Series,
  type VaultData,
} from './domain';

export type FinalFantasyCatalogSet = {
  id: string;
  seriesId: 'series:final-fantasy-tcg';
  name: string;
  cardCount: number;
  rarityScheme: string[];
  rarityCounts: Record<string, number>;
  trackedByDefault: boolean;
};
export type FinalFantasyCatalogCard = {
  setId: string;
  number: string;
  name: string;
  rarity?: string;
  imageUrls: string[];
  sourceNote?: string;
};
export type FinalFantasyCatalogUpdate = {
  schemaVersion: 2;
  source: 'Square Enix official Card Browser';
  cataloguedAt: string;
  browserUrl: string;
  sourceCardCount: number;
  sets: FinalFantasyCatalogSet[];
  cards: FinalFantasyCatalogCard[];
};

export type FinalFantasyCatalogUpdatePlan = {
  recordsToAdd: number;
  setsToAdd: number;
  cardsToAdd: number;
  cardDetailsToFill: number;
  imagesToAdd: number;
  conflicts: string[];
  hasChanges: boolean;
};

const SOURCE = 'Square Enix official Card Browser';
const BROWSER_URL = 'https://fftcg.square-enix-games.com/na/card-browser';
const SERIES_ID = 'series:final-fantasy-tcg';
const SET_NAMES = [
  'Opus I', 'Opus II', 'Opus III', 'Opus IV', 'Opus V', 'Opus VI', 'Opus VII',
  'Opus VIII', 'Opus IX', 'Opus X', 'Opus XI', 'Opus XII', 'Opus XIII', 'Opus XIV',
  'Crystal Dominion', 'Emissaries of Light', "Rebellion's Call", 'Resurgence of Power',
  'From Nightmares', 'Dawn of Heroes', 'Beyond Destiny', 'Hidden Hope', 'Hidden Trials',
  'Hidden Legends', 'Tears of the Planet', 'Gunslinger in the Abyss', 'Journey of Discovery',
  'Dreamlike Oceans', 'Blissful Eternity', 'Memories of Life', 'Boss Deck Chaos',
  'Boss Deck FFVII', 'Dissidia Collection Set', 'Legacy Collection',
];

function slugify(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function cardId(setId: string, number: string) { return `${setId}:${number}`; }
function setId(name: string) { return `set:final-fantasy-tcg:${slugify(name)}`; }
function sameRecord(actual: unknown, expected: unknown) { return JSON.stringify(actual) === JSON.stringify(expected); }

function imageSource(url: string, cataloguedAt: string) {
  return { url, source: 'verified-remote' as const, verifiedAt: cataloguedAt };
}

export function parseFinalFantasyCatalogUpdate(value: unknown): FinalFantasyCatalogUpdate {
  if (!value || typeof value !== 'object') throw new Error('Final Fantasy catalog update must be a JSON object.');
  const update = value as Partial<FinalFantasyCatalogUpdate>;
  if (update.schemaVersion !== 2 || update.source !== SOURCE || update.browserUrl !== BROWSER_URL
    || !Number.isFinite(Date.parse(update.cataloguedAt ?? ''))
    || !Number.isInteger(update.sourceCardCount) || (update.sourceCardCount ?? 0) < 1
    || !Array.isArray(update.sets) || !Array.isArray(update.cards)) {
    throw new Error('Final Fantasy catalog update has an unsupported format or source.');
  }
  if (update.sets.length !== SET_NAMES.length || update.sets.some((set, index) => !set || set.name !== SET_NAMES[index])) {
    throw new Error('Final Fantasy catalog must contain the full official set list in source order.');
  }

  const entriesBySet = new Map<string, FinalFantasyCatalogCard[]>();
  for (const set of update.sets) {
    if (!set || set.id !== setId(set.name) || set.seriesId !== SERIES_ID
      || !Number.isInteger(set.cardCount) || set.cardCount < 1
      || !Array.isArray(set.rarityScheme) || !set.rarityScheme.every((rarity) => typeof rarity === 'string' && !!rarity)
      || !set.rarityCounts || typeof set.rarityCounts !== 'object'
      || typeof set.trackedByDefault !== 'boolean'
      || set.trackedByDefault !== (set.name === 'Memories of Life')) {
      throw new Error(`Final Fantasy set ${set?.name ?? '(unknown)'} failed validation.`);
    }
    entriesBySet.set(set.id, []);
  }

  for (const card of update.cards) {
    const entries = entriesBySet.get(card?.setId);
    if (!entries || typeof card.number !== 'string' || !card.number.trim() || card.number !== card.number.trim()
      || typeof card.name !== 'string' || (card.name !== card.name.trim()) || (card.rarity !== undefined && (typeof card.rarity !== 'string' || !card.rarity.trim() || card.rarity !== card.rarity.trim()))
      || (card.sourceNote !== undefined && typeof card.sourceNote !== 'string')
      || (!card.name.trim() || !card.rarity) && !card.sourceNote
      || !Array.isArray(card.imageUrls) || card.imageUrls.length < 1 || new Set(card.imageUrls).size !== card.imageUrls.length
      || !card.imageUrls.every((url) => typeof url === 'string' && isOfficialImageUrl(url))) {
      throw new Error('Final Fantasy catalog contains a card with invalid identity, details, or image source.');
    }
    entries.push(card);
  }
  for (const set of update.sets) {
    const entries = entriesBySet.get(set.id)!;
    if (entries.length !== set.cardCount) throw new Error(`Set ${set.name} is incomplete; expected ${set.cardCount} card definitions.`);
    if (new Set(entries.map((card) => card.number)).size !== entries.length) throw new Error(`Set ${set.name} repeats a card code.`);
    const rarityCounts: Record<string, number> = {};
    for (const card of entries) if (card.rarity) rarityCounts[card.rarity] = (rarityCounts[card.rarity] ?? 0) + 1;
    if (!sameRecord(set.rarityScheme, Object.keys(rarityCounts)) || !sameRecord(set.rarityCounts, rarityCounts)) {
      throw new Error(`Set ${set.name} has rarity totals that do not match its card definitions.`);
    }
  }
  return update as FinalFantasyCatalogUpdate;
}

function isOfficialImageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'fftcg.cdn.sewest.net'
      && url.pathname.startsWith('/images/cards/full/') && url.pathname.toLowerCase().endsWith('.jpg');
  } catch { return false; }
}

export function planFinalFantasyCatalogUpdate(vault: VaultData, update: FinalFantasyCatalogUpdate): FinalFantasyCatalogUpdatePlan {
  const conflicts: string[] = [];
  let recordsToAdd = 0;
  let setsToAdd = 0;
  let cardsToAdd = 0;
  let cardDetailsToFill = 0;
  let imagesToAdd = 0;
  const publisher: Publisher = { id: 'publisher:square-enix', name: 'Square Enix' };
  const franchise: Franchise = { id: 'franchise:final-fantasy', publisherId: publisher.id, name: 'Final Fantasy' };
  const series: Series = { id: SERIES_ID, franchiseId: franchise.id, name: 'Final Fantasy TCG', category: 'cards' };
  const checkParent = (records: { id: string }[], expected: { id: string }, label: string) => {
    const existing = records.find((record) => record.id === expected.id);
    if (!existing) recordsToAdd++;
    else if (!sameRecord(existing, expected)) conflicts.push(`${label} ${expected.id} already exists with different details.`);
  };
  checkParent(vault.catalog.publishers, publisher, 'Publisher');
  checkParent(vault.catalog.franchises, franchise, 'Franchise');
  checkParent(vault.catalog.series, series, 'Series');

  const existingSets = new Map(vault.catalog.sets.map((item) => [item.id, item]));
  const existingCards = new Map(vault.catalog.cards.map((item) => [item.id, item]));
  const existingVariants = new Map(vault.catalog.variants.map((item) => [item.id, item]));
  for (const sourceSet of update.sets) {
    const existingSet = existingSets.get(sourceSet.id);
    if (!existingSet) { recordsToAdd++; setsToAdd++; }
    else if (existingSet.seriesId !== SERIES_ID || existingSet.name !== sourceSet.name) {
      conflicts.push(`Set ${sourceSet.id} already exists with different identity details.`);
    }

    const entries = update.cards.filter((entry) => entry.setId === sourceSet.id);
    const incomingCardIds = new Set(entries.map((entry) => cardId(sourceSet.id, entry.number)));
    const localCards = vault.catalog.cards.filter((card) => card.setId === sourceSet.id);
    const removedFromSource = localCards.filter((card) => !incomingCardIds.has(card.id));
    if (removedFromSource.length) conflicts.push(`Set ${sourceSet.name} has ${removedFromSource.length} local card record(s) missing from the official catalog; review before applying.`);
    for (const entry of entries) {
      const id = cardId(sourceSet.id, entry.number);
      const current = existingCards.get(id);
      if (!current) cardsToAdd++;
      else if (current.setId !== sourceSet.id) conflicts.push(`Card ${id} belongs to a different set.`);
      else if ((!current.name.trim() && !!entry.name.trim()) || (!current.rarity && !!entry.rarity)) cardDetailsToFill++;
      const variantId = id + ':square-enix-official';
      const existing = existingVariants.get(variantId);
      if (!existing) imagesToAdd += entry.imageUrls.length;
      else if (existing.cardId !== id) conflicts.push(`Official image record for ${entry.number} belongs to a different card.`);
      else imagesToAdd += entry.imageUrls.filter((url) => !existing.imageUrls.some((source) => source.url === url)).length;
    }
  }
  return { recordsToAdd, setsToAdd, cardsToAdd, cardDetailsToFill, imagesToAdd, conflicts, hasChanges: recordsToAdd + cardsToAdd + cardDetailsToFill + imagesToAdd > 0 || update.sets.some((sourceSet) => {
    const current = existingSets.get(sourceSet.id);
    return current?.expectedCardCount !== sourceSet.cardCount || !sameRecord(current?.rarityScheme ?? [], sourceSet.rarityScheme);
  }) };
}

export function applyFinalFantasyCatalogUpdate(vault: VaultData, update: FinalFantasyCatalogUpdate): VaultData {
  const plan = planFinalFantasyCatalogUpdate(vault, update);
  if (plan.conflicts.length) throw new Error('Final Fantasy catalog update paused for review: ' + plan.conflicts.join(' '));

  const publisher: Publisher = { id: 'publisher:square-enix', name: 'Square Enix' };
  const franchise: Franchise = { id: 'franchise:final-fantasy', publisherId: publisher.id, name: 'Final Fantasy' };
  const series: Series = { id: SERIES_ID, franchiseId: franchise.id, name: 'Final Fantasy TCG', category: 'cards' };
  const publishers = new Map(vault.catalog.publishers.map((item) => [item.id, item]));
  const franchises = new Map(vault.catalog.franchises.map((item) => [item.id, item]));
  const seriesRecords = new Map(vault.catalog.series.map((item) => [item.id, item]));
  const sets = new Map(vault.catalog.sets.map((item) => [item.id, item]));
  const cards = new Map(vault.catalog.cards.map((item) => [item.id, item]));
  const variants = new Map(vault.catalog.variants.map((item) => [item.id, item]));
  publishers.set(publisher.id, publishers.get(publisher.id) ?? publisher);
  franchises.set(franchise.id, franchises.get(franchise.id) ?? franchise);
  seriesRecords.set(series.id, seriesRecords.get(series.id) ?? series);

  for (const sourceSet of update.sets) {
    const existing = sets.get(sourceSet.id);
    const tracked = existing?.tracked ?? sourceSet.trackedByDefault;
    sets.set(sourceSet.id, {
      ...(existing ?? {}),
      id: sourceSet.id,
      seriesId: SERIES_ID,
      name: sourceSet.name,
      expectedCardCount: sourceSet.cardCount,
      rarityScheme: [...sourceSet.rarityScheme],
      tracked,
    });
  }

  for (const entry of update.cards) {
    const id = cardId(entry.setId, entry.number);
    const currentCard = cards.get(id);
    if (!currentCard) {
      cards.set(id, { id, setId: entry.setId, number: entry.number, name: entry.name, rarity: entry.rarity, sourceNote: entry.sourceNote });
    } else {
      cards.set(id, {
        ...currentCard,
        ...(currentCard.name.trim() ? {} : { name: entry.name }),
        ...(currentCard.rarity || !entry.rarity ? {} : { rarity: entry.rarity }),
        ...(currentCard.sourceNote || !entry.sourceNote ? {} : { sourceNote: entry.sourceNote }),
      });
    }
    const variantId = id + ':square-enix-official';
    const currentVariant = variants.get(variantId);
    const currentUrls = currentVariant?.imageUrls ?? [];
    const newUrls = entry.imageUrls.filter((url) => !currentUrls.some((source) => source.url === url)).map((url) => imageSource(url, update.cataloguedAt));
    const mergedVariant: CardVariant = {
      id: variantId,
      cardId: id,
      name: currentVariant?.name ?? 'Official card images',
      imageUrls: [...currentUrls, ...newUrls],
    };
    variants.set(variantId, mergedVariant);
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
