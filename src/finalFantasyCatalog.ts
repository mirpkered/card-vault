import {
  fullArtBonusCard,
  fullArtBonusCardId,
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
export type FinalFantasyVariantTreatment = 'normal' | 'foil' | 'full-art' | 'special';
export type FinalFantasyCatalogVariant = {
  treatment: FinalFantasyVariantTreatment;
  name: string;
  imageUrls: string[];
  imageNote?: string;
};
export type FinalFantasyCatalogCard = {
  setId: string;
  number: string;
  name: string;
  rarity?: string;
  imageUrls: string[];
  variants: FinalFantasyCatalogVariant[];
  sourceNote?: string;
};
export type FinalFantasyCatalogUpdate = {
  schemaVersion: 3;
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
  variantRecordsToAdd: number;
  variantDetailsToUpdate: number;
  imagesToAdd: number;
  ownershipToNormalize: number;
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

export function finalFantasyVariantId(cardDefinitionId: string, treatment: FinalFantasyVariantTreatment, name?: string) {
  const suffix = treatment === 'special' && name ? `special:${slugify(name)}` : treatment;
  return `${cardDefinitionId}:fftcg:${suffix}`;
}

function imageFileName(url: string) { return new URL(url).pathname.split('/').pop() ?? ''; }

function deriveVariants(setName: string, cardNumber: string, imageUrls: string[]): FinalFantasyCatalogVariant[] {
  const normalImages = imageUrls.filter((url) => !/(?:_FL|_premium|_SP|_SS2|_ho)(?:_|\.|$)/i.test(imageFileName(url)));
  const primaryCode = cardNumber.split('/')[0];
  const normalUrl = normalImages.find((url) => imageFileName(url).toLowerCase() === `${primaryCode.toLowerCase()}_eg.jpg`) ?? normalImages[0] ?? imageUrls[0];
  const premiumImages = imageUrls.filter((url) => /_premium(?:_eg)?\.jpg$/i.test(imageFileName(url)) || /_eg_premium\.jpg$/i.test(imageFileName(url)) || /_ho\.jpg$/i.test(imageFileName(url)));
  const fullArtImages = imageUrls.filter((url) => /_FL(?:_eg)?(?:_[0-9]+)?\.jpg$/i.test(imageFileName(url)) || /_eg_FL(?:_[0-9]+)?\.jpg$/i.test(imageFileName(url)));
  const isNoirTreatment = setName === 'Memories of Life' && cardNumber === '7-034L';
  const specialImages = imageUrls.filter((url) => /_(?:SP|SS2)(?:_|\.|$)/i.test(imageFileName(url)));
  return [
    { treatment: 'normal', name: 'Normal', imageUrls: [normalUrl] },
    {
      treatment: 'foil', name: 'Foil', imageUrls: premiumImages.length ? premiumImages : [normalUrl],
      ...(!premiumImages.length ? { imageNote: 'The foil finish is not visible in Square Enix’s available catalog image.' } : {}),
    },
    ...(fullArtImages.length && !isNoirTreatment ? [{ treatment: 'full-art' as const, name: 'Full Art', imageUrls: fullArtImages }] : []),
    ...(isNoirTreatment ? [{ treatment: 'special' as const, name: 'Noir', imageUrls: fullArtImages }] : []),
    ...(specialImages.length ? [{ treatment: 'special' as const, name: 'Special', imageUrls: specialImages }] : []),
  ];
}

function imageVariantRecord(cardId: string, variant: FinalFantasyCatalogVariant, cataloguedAt: string, ownerCardId = cardId): CardVariant {
  return {
    id: finalFantasyVariantId(cardId, variant.treatment, variant.name),
    cardId: ownerCardId,
    name: variant.name,
    treatment: variant.treatment,
    imageUrls: variant.imageUrls.map((url) => imageSource(url, cataloguedAt)),
    ...(variant.imageNote ? { imageNote: variant.imageNote } : {}),
  };
}

export function parseFinalFantasyCatalogUpdate(value: unknown): FinalFantasyCatalogUpdate {
  if (!value || typeof value !== 'object') throw new Error('Final Fantasy catalog update must be a JSON object.');
  const update = value as Partial<FinalFantasyCatalogUpdate>;
  if (update.schemaVersion !== 3 || update.source !== SOURCE || update.browserUrl !== BROWSER_URL
    || !Number.isFinite(Date.parse(update.cataloguedAt ?? ''))
    || !Number.isInteger(update.sourceCardCount) || (update.sourceCardCount ?? 0) < 1
    || !Array.isArray(update.sets) || !Array.isArray(update.cards)) {
    throw new Error('Final Fantasy catalog update has an unsupported format or source.');
  }
  if (update.sets.length !== SET_NAMES.length || update.sets.some((set, index) => !set || set.name !== SET_NAMES[index])) {
    throw new Error('Final Fantasy catalog must contain the full official set list in source order.');
  }

  const entriesBySet = new Map<string, FinalFantasyCatalogCard[]>();
  const setNames = new Map<string, string>();
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
    setNames.set(set.id, set.name);
  }

  for (const card of update.cards) {
    const entries = entriesBySet.get(card?.setId);
    if (!entries || typeof card.number !== 'string' || !card.number.trim() || card.number !== card.number.trim()
      || typeof card.name !== 'string' || (card.name !== card.name.trim()) || (card.rarity !== undefined && (typeof card.rarity !== 'string' || !card.rarity.trim() || card.rarity !== card.rarity.trim()))
      || (card.sourceNote !== undefined && typeof card.sourceNote !== 'string')
      || (!card.name.trim() || !card.rarity) && !card.sourceNote
      || !Array.isArray(card.imageUrls) || card.imageUrls.length < 1 || new Set(card.imageUrls).size !== card.imageUrls.length
      || !card.imageUrls.every((url) => typeof url === 'string' && isOfficialImageUrl(url))
      || !Array.isArray(card.variants)) {
      throw new Error('Final Fantasy catalog contains a card with invalid identity, details, or image source.');
    }
    const expectedVariants = deriveVariants(setNames.get(card.setId)!, card.number, card.imageUrls);
    if (!sameRecord(card.variants, expectedVariants)) throw new Error(`Final Fantasy card ${card.number} has variant details that do not match its official image files.`);
    if (new Set(expectedVariants.map((variant) => finalFantasyVariantId(cardId(card.setId, card.number), variant.treatment, variant.name))).size !== expectedVariants.length) throw new Error(`Final Fantasy card ${card.number} repeats a version identity.`);
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
  let variantRecordsToAdd = 0;
  let variantDetailsToUpdate = 0;
  let imagesToAdd = 0;
  let ownershipToNormalize = 0;
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
    const incomingBonusIds = new Set(entries.flatMap((entry) => entry.variants.some((variant) => variant.treatment === 'full-art') ? [fullArtBonusCardId(cardId(sourceSet.id, entry.number))] : []));
    const localCards = vault.catalog.cards.filter((card) => card.setId === sourceSet.id);
    const removedFromSource = localCards.filter((card) => card.countsTowardSetCompletion !== false && !incomingCardIds.has(card.id));
    const removedBonusFromSource = localCards.filter((card) => card.countsTowardSetCompletion === false && !incomingBonusIds.has(card.id));
    if (removedFromSource.length) conflicts.push(`Set ${sourceSet.name} has ${removedFromSource.length} local card record(s) missing from the official catalog; review before applying.`);
    if (removedBonusFromSource.length) conflicts.push(`Set ${sourceSet.name} has ${removedBonusFromSource.length} local Full Art bonus record(s) missing from the official catalog; review before applying.`);
    for (const entry of entries) {
      const id = cardId(sourceSet.id, entry.number);
      const current = existingCards.get(id);
      if (!current) cardsToAdd++;
      else if (current.setId !== sourceSet.id) conflicts.push(`Card ${id} belongs to a different set.`);
      else if ((!current.name.trim() && !!entry.name.trim()) || (!current.rarity && !!entry.rarity)) cardDetailsToFill++;
      for (const sourceVariant of entry.variants) {
        const ownerCardId = sourceVariant.treatment === 'full-art' ? fullArtBonusCardId(id) : id;
        if (sourceVariant.treatment === 'full-art') {
          const existingBonus = existingCards.get(ownerCardId);
          if (!existingBonus) cardsToAdd++;
          else if (existingBonus.setId !== sourceSet.id || existingBonus.relatedCardId !== id || existingBonus.countsTowardSetCompletion !== false) conflicts.push(`Full Art record ${ownerCardId} is attached to a different card identity.`);
        }
        const expectedVariant = imageVariantRecord(id, sourceVariant, update.cataloguedAt, ownerCardId);
        const existing = existingVariants.get(expectedVariant.id);
        if (!existing) {
          variantRecordsToAdd++;
          imagesToAdd += expectedVariant.imageUrls.length;
        } else if (existing.cardId !== ownerCardId) conflicts.push(`Official ${sourceVariant.name} version for ${entry.number} belongs to a different card.`);
        else {
          imagesToAdd += expectedVariant.imageUrls.filter((source) => !existing.imageUrls.some((current) => current.url === source.url)).length;
          if (existing.name !== expectedVariant.name || existing.treatment !== expectedVariant.treatment || existing.imageNote !== expectedVariant.imageNote) variantDetailsToUpdate++;
        }
      }
    }
  }
  const incomingCardIds = new Set(update.cards.map((entry) => cardId(entry.setId, entry.number)));
  const normalVariantIds = new Set(update.cards.map((entry) => finalFantasyVariantId(cardId(entry.setId, entry.number), 'normal')));
  const explicitNormalOwnership = new Set(vault.catalog.ownership.filter((item) => item.variantId && normalVariantIds.has(item.variantId)).map((item) => item.variantId));
  for (const item of vault.catalog.ownership) {
    if (!item.variantId && incomingCardIds.has(item.cardId)) {
      const normalId = finalFantasyVariantId(item.cardId, 'normal');
      if (explicitNormalOwnership.has(normalId)) conflicts.push(`Card ${item.cardId} has both legacy and Normal-version quantities; review them before importing.`);
      else ownershipToNormalize++;
    }
  }
  return { recordsToAdd, setsToAdd, cardsToAdd, cardDetailsToFill, variantRecordsToAdd, variantDetailsToUpdate, imagesToAdd, ownershipToNormalize, conflicts, hasChanges: recordsToAdd + cardsToAdd + cardDetailsToFill + variantRecordsToAdd + variantDetailsToUpdate + imagesToAdd + ownershipToNormalize > 0 || update.sets.some((sourceSet) => {
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
    for (const sourceVariant of entry.variants) {
      const ownerCardId = sourceVariant.treatment === 'full-art' ? fullArtBonusCardId(id) : id;
      if (sourceVariant.treatment === 'full-art') {
        const baseCard = cards.get(id)!;
        const expectedBonus = fullArtBonusCard(baseCard, sourceVariant.name);
        const currentBonus = cards.get(ownerCardId);
        cards.set(ownerCardId, currentBonus ? {
          ...expectedBonus,
          ...currentBonus,
          id: ownerCardId,
          setId: baseCard.setId,
          countsTowardSetCompletion: false,
          relatedCardId: id,
          bonusLabel: currentBonus.bonusLabel ?? sourceVariant.name,
        } : expectedBonus);
      }
      const expectedVariant = imageVariantRecord(id, sourceVariant, update.cataloguedAt, ownerCardId);
      const currentVariant = variants.get(expectedVariant.id);
      const currentUrls = currentVariant?.imageUrls ?? [];
      const newUrls = expectedVariant.imageUrls.filter((source) => !currentUrls.some((current) => current.url === source.url));
      const mergedVariant: CardVariant = {
        ...expectedVariant,
        imageUrls: [...currentUrls, ...newUrls],
      };
      variants.set(expectedVariant.id, mergedVariant);
    }
  }

  const incomingCardIds = new Set(update.cards.map((entry) => cardId(entry.setId, entry.number)));
  const ownership = vault.catalog.ownership.map((item) => item.cardId && incomingCardIds.has(item.cardId) && !item.variantId
    ? { ...item, variantId: finalFantasyVariantId(item.cardId, 'normal') }
    : item);

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
      ownership,
    },
  };
  const errors = validateCatalog(result.catalog);
  if (errors.length) throw new Error('Final Fantasy catalog update failed validation: ' + errors.join(' '));
  return result;
}
