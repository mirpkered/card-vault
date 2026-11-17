import { validateCatalog, type CardVariant, type Franchise, type Publisher, type Series, type VaultData } from './domain';

const SOURCE = 'Bandai UNION ARENA English (U.S./Canada) Card Browser';
const BROWSER_URL = 'https://www.unionarena-tcg.com/na/cardlist/?search=true';
const SERIES_ID = 'series:union-arena-tcg';
const PUBLISHER: Publisher = { id: 'publisher:bandai', name: 'Bandai' };
const FRANCHISE: Franchise = { id: 'franchise:union-arena', publisherId: PUBLISHER.id, name: 'Union Arena' };
const SERIES: Series = { id: SERIES_ID, franchiseId: FRANCHISE.id, name: 'Union Arena TCG (English)', category: 'cards' };

export type UnionArenaParallel = { id: string; imageUrl: string };
export type UnionArenaCatalogCard = {
  setId: string;
  number: string;
  name: string;
  imageUrl: string;
  parallelOnly: boolean;
  parallels: UnionArenaParallel[];
  sourceNote?: string;
};
export type UnionArenaCatalogSet = {
  id: string;
  productId: string;
  seriesId: typeof SERIES_ID;
  name: string;
  cardCount: number;
  basePrintCount: number;
  parallelCount: number;
  sourceRowCount: number;
  trackedByDefault: false;
};
export type UnionArenaCatalogUpdate = {
  schemaVersion: 1;
  source: typeof SOURCE;
  cataloguedAt: string;
  browserUrl: typeof BROWSER_URL;
  productCount: number;
  sourceCardCount: number;
  sourceSignature: string;
  sets: UnionArenaCatalogSet[];
  cards: UnionArenaCatalogCard[];
};
export type UnionArenaCatalogUpdatePlan = {
  setsToAdd: number;
  cardsToAdd: number;
  optionalCardsToAdd: number;
  variantsToAdd: number;
  imagesToAdd: number;
  ownershipToNormalize: number;
  conflicts: string[];
  hasChanges: boolean;
};

export function unionArenaCardId(setId: string, number: string) { return `${setId}:${number}`; }
export function unionArenaParallelCardId(cardId: string, parallelId: string) { return `${cardId}:parallel:${parallelId}`; }
export function unionArenaVariantId(cardId: string, treatment: 'normal' | 'foil' | 'full-art', parallelId?: string) {
  return `${cardId}:union-arena:${treatment}${parallelId ? `:${parallelId}` : ''}`;
}

function sameRecord(actual: unknown, expected: unknown) { return JSON.stringify(actual) === JSON.stringify(expected); }
function validImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.unionarena-tcg.com'
      && url.pathname.startsWith('/na/images/cardlist/card/') && url.pathname.endsWith('.png');
  } catch { return false; }
}

export function parseUnionArenaCatalogUpdate(value: unknown): UnionArenaCatalogUpdate {
  if (!value || typeof value !== 'object') throw new Error('Union Arena catalog must be a JSON object.');
  const update = value as Partial<UnionArenaCatalogUpdate>;
  if (update.schemaVersion !== 1 || update.source !== SOURCE || update.browserUrl !== BROWSER_URL
    || !Number.isFinite(Date.parse(update.cataloguedAt ?? ''))
    || !Number.isInteger(update.productCount) || update.productCount !== update.sets?.length
    || !Number.isInteger(update.sourceCardCount) || (update.sourceCardCount ?? 0) < 1
    || typeof update.sourceSignature !== 'string' || !/^[0-9a-f]{64}$/.test(update.sourceSignature)
    || !Array.isArray(update.sets) || !Array.isArray(update.cards) || !update.sets.length) {
    throw new Error('Union Arena catalog has an unsupported format or source.');
  }
  const setById = new Map<string, UnionArenaCatalogSet>();
  for (const set of update.sets) {
    if (!set || !/^\d+$/.test(set.productId) || set.id !== `set:union-arena-na:${set.productId}`
      || set.seriesId !== SERIES_ID || !set.name?.trim()
      || !Number.isInteger(set.cardCount) || set.cardCount < 1
      || !Number.isInteger(set.basePrintCount) || set.basePrintCount < 0 || set.basePrintCount > set.cardCount
      || !Number.isInteger(set.parallelCount) || set.parallelCount < 0
      || !Number.isInteger(set.sourceRowCount) || set.sourceRowCount !== set.basePrintCount + set.parallelCount
      || set.trackedByDefault !== false) {
      throw new Error(`Union Arena product ${set?.name ?? '(unknown)'} failed validation.`);
    }
    if (setById.has(set.id)) throw new Error(`Union Arena catalog repeats product ${set.id}.`);
    setById.set(set.id, set);
  }

  const cardsBySet = new Map([...setById.keys()].map((id) => [id, new Map<string, UnionArenaCatalogCard>()]));
  let sourceRowCount = 0;
  for (const card of update.cards) {
    const cards = cardsBySet.get(card?.setId);
    if (!cards || typeof card.number !== 'string' || !card.number.trim() || card.number !== card.number.trim()
      || typeof card.name !== 'string' || !card.name.trim() || typeof card.parallelOnly !== 'boolean'
      || !validImageUrl(card.imageUrl) || (card.sourceNote !== undefined && typeof card.sourceNote !== 'string')
      || !Array.isArray(card.parallels)) {
      throw new Error('Union Arena catalog contains a card with invalid identity, name, or image source.');
    }
    if (cards.has(card.number)) throw new Error(`Union Arena set ${card.setId} repeats card number ${card.number}.`);
    const parallelIds = new Set<string>();
    for (const parallel of card.parallels) {
      if (!parallel || !/^p\d+$/i.test(parallel.id) || !validImageUrl(parallel.imageUrl) || parallelIds.has(parallel.id.toLowerCase())) {
        throw new Error(`Union Arena card ${card.number} has an invalid or repeated parallel print.`);
      }
      parallelIds.add(parallel.id.toLowerCase());
    }
    if (card.parallelOnly && !card.parallels.length) throw new Error(`Union Arena card ${card.number} is missing its parallel source record.`);
    if (card.parallelOnly && card.imageUrl !== card.parallels[0]?.imageUrl) throw new Error(`Union Arena card ${card.number} does not use its first parallel image as the required image.`);
    sourceRowCount += (card.parallelOnly ? 0 : 1) + card.parallels.length;
    cards.set(card.number, card);
  }
  for (const [setId, cards] of cardsBySet) {
    const set = setById.get(setId)!;
    const rows = [...cards.values()];
    const basePrintCount = rows.filter((card) => !card.parallelOnly).length;
    const parallelCount = rows.reduce((sum, card) => sum + card.parallels.length, 0);
    if (rows.length !== set.cardCount || basePrintCount !== set.basePrintCount || parallelCount !== set.parallelCount || set.sourceRowCount !== basePrintCount + parallelCount) {
      throw new Error(`Union Arena set ${set.name} is incomplete or has mismatched parallel totals.`);
    }
  }
  if (sourceRowCount !== update.sourceCardCount || update.sourceCardCount !== update.sets.reduce((sum, set) => sum + set.sourceRowCount, 0)) {
    throw new Error('Union Arena source card total does not match the product rows.');
  }
  return update as UnionArenaCatalogUpdate;
}

function parallelEntries(card: UnionArenaCatalogCard): UnionArenaParallel[] {
  // If Bandai lists only a parallel printing for a number in a product, that
  // printing is its one required checklist card; only additional printings are optional.
  return card.parallelOnly ? card.parallels.slice(1) : card.parallels;
}

function baseVariants(cardId: string, imageUrl: string, cataloguedAt: string): CardVariant[] {
  const source = { url: imageUrl, source: 'verified-remote' as const, verifiedAt: cataloguedAt };
  return [
    { id: unionArenaVariantId(cardId, 'normal'), cardId, name: 'Normal', treatment: 'normal', imageUrls: [source] },
    { id: unionArenaVariantId(cardId, 'foil'), cardId, name: 'Foil', treatment: 'foil', imageUrls: [source], imageNote: 'The official card-list image does not show a separate foil finish.' },
  ];
}

function parallelVariant(baseId: string, parallelId: string, imageUrl: string, cataloguedAt: string): CardVariant {
  const bonusId = unionArenaParallelCardId(baseId, parallelId);
  return {
    id: unionArenaVariantId(bonusId, 'full-art', parallelId),
    cardId: bonusId,
    name: `Full Art · ${parallelId.toUpperCase()}`,
    treatment: 'full-art',
    imageUrls: [{ url: imageUrl, source: 'verified-remote', verifiedAt: cataloguedAt }],
  };
}

export function planUnionArenaCatalogUpdate(vault: VaultData, update: UnionArenaCatalogUpdate): UnionArenaCatalogUpdatePlan {
  const conflicts: string[] = [];
  let setsToAdd = 0;
  let cardsToAdd = 0;
  let optionalCardsToAdd = 0;
  let variantsToAdd = 0;
  let imagesToAdd = 0;
  let ownershipToNormalize = 0;
  const checkParent = <T extends { id: string }>(records: T[], expected: T, label: string) => {
    const existing = records.find((record) => record.id === expected.id);
    if (existing && !sameRecord(existing, expected)) conflicts.push(`${label} ${expected.id} already exists with different details.`);
  };
  checkParent(vault.catalog.publishers, PUBLISHER, 'Publisher');
  checkParent(vault.catalog.franchises, FRANCHISE, 'Franchise');
  checkParent(vault.catalog.series, SERIES, 'Series');

  const existingSets = new Map(vault.catalog.sets.map((set) => [set.id, set]));
  const existingCards = new Map(vault.catalog.cards.map((card) => [card.id, card]));
  const existingVariants = new Map(vault.catalog.variants.map((variant) => [variant.id, variant]));
  for (const sourceSet of update.sets) {
    const currentSet = existingSets.get(sourceSet.id);
    if (!currentSet) setsToAdd++;
    else if (currentSet.seriesId !== SERIES_ID || currentSet.name !== sourceSet.name) conflicts.push(`Set ${sourceSet.id} already exists with different identity details.`);
    const entries = update.cards.filter((card) => card.setId === sourceSet.id);
    const baseIds = new Set(entries.map((card) => unionArenaCardId(sourceSet.id, card.number)));
    const bonusIds = new Set(entries.flatMap((card) => parallelEntries(card).map((parallel) => unionArenaParallelCardId(unionArenaCardId(sourceSet.id, card.number), parallel.id))));
    const localCards = vault.catalog.cards.filter((card) => card.setId === sourceSet.id);
    if (localCards.some((card) => card.countsTowardSetCompletion !== false && !baseIds.has(card.id))) conflicts.push(`Set ${sourceSet.name} has local cards missing from Bandai’s current list; review before applying.`);
    if (localCards.some((card) => card.countsTowardSetCompletion === false && card.relatedCardId && !bonusIds.has(card.id))) conflicts.push(`Set ${sourceSet.name} has optional parallel records missing from Bandai’s current list; review before applying.`);

    for (const entry of entries) {
      const id = unionArenaCardId(sourceSet.id, entry.number);
      const current = existingCards.get(id);
      if (!current) cardsToAdd++;
      else if (current.setId !== sourceSet.id || current.countsTowardSetCompletion === false) conflicts.push(`Card ${id} already belongs to a different identity.`);
      const expectedVersions = baseVariants(id, entry.imageUrl, update.cataloguedAt);
      for (const parallel of parallelEntries(entry)) {
        const bonusId = unionArenaParallelCardId(id, parallel.id);
        const bonus = existingCards.get(bonusId);
        if (!bonus) { cardsToAdd++; optionalCardsToAdd++; }
        else if (bonus.setId !== sourceSet.id || bonus.relatedCardId !== id || bonus.countsTowardSetCompletion !== false) conflicts.push(`Full Art record ${bonusId} is attached to a different card identity.`);
        expectedVersions.push(parallelVariant(id, parallel.id, parallel.imageUrl, update.cataloguedAt));
      }
      for (const expected of expectedVersions) {
        const currentVariant = existingVariants.get(expected.id);
        if (!currentVariant) { variantsToAdd++; imagesToAdd += expected.imageUrls.length; }
        else if (currentVariant.cardId !== expected.cardId || currentVariant.treatment !== expected.treatment) conflicts.push(`Version ${expected.id} belongs to a different card identity.`);
        else imagesToAdd += expected.imageUrls.filter((image) => !currentVariant.imageUrls.some((currentImage) => currentImage.url === image.url)).length;
      }
    }
  }
  const baseIds = new Set(update.cards.map((card) => unionArenaCardId(card.setId, card.number)));
  const normalIds = new Set([...baseIds].map((id) => unionArenaVariantId(id, 'normal')));
  const explicitNormalOwnership = new Set(vault.catalog.ownership.filter((item) => item.variantId && normalIds.has(item.variantId)).map((item) => item.variantId));
  for (const item of vault.catalog.ownership) {
    if (!item.variantId && baseIds.has(item.cardId)) {
      const normalId = unionArenaVariantId(item.cardId, 'normal');
      if (explicitNormalOwnership.has(normalId)) conflicts.push(`Card ${item.cardId} has both legacy and Normal-version quantities; review before importing.`);
      else ownershipToNormalize++;
    }
  }
  const hasChanges = setsToAdd + cardsToAdd + variantsToAdd + imagesToAdd + ownershipToNormalize > 0
    || update.sets.some((sourceSet) => existingSets.get(sourceSet.id)?.expectedCardCount !== sourceSet.cardCount);
  return { setsToAdd, cardsToAdd, optionalCardsToAdd, variantsToAdd, imagesToAdd, ownershipToNormalize, conflicts, hasChanges };
}

export function applyUnionArenaCatalogUpdate(vault: VaultData, update: UnionArenaCatalogUpdate): VaultData {
  const plan = planUnionArenaCatalogUpdate(vault, update);
  if (plan.conflicts.length) throw new Error(`Union Arena catalog update paused for review: ${plan.conflicts.join(' ')}`);

  const publishers = new Map(vault.catalog.publishers.map((record) => [record.id, record]));
  const franchises = new Map(vault.catalog.franchises.map((record) => [record.id, record]));
  const seriesRecords = new Map(vault.catalog.series.map((record) => [record.id, record]));
  const sets = new Map(vault.catalog.sets.map((record) => [record.id, record]));
  const cards = new Map(vault.catalog.cards.map((record) => [record.id, record]));
  const variants = new Map(vault.catalog.variants.map((record) => [record.id, record]));
  publishers.set(PUBLISHER.id, publishers.get(PUBLISHER.id) ?? PUBLISHER);
  franchises.set(FRANCHISE.id, franchises.get(FRANCHISE.id) ?? FRANCHISE);
  seriesRecords.set(SERIES.id, seriesRecords.get(SERIES.id) ?? SERIES);

  for (const sourceSet of update.sets) {
    const current = sets.get(sourceSet.id);
    sets.set(sourceSet.id, {
      ...(current ?? {}), id: sourceSet.id, seriesId: SERIES_ID, name: sourceSet.name,
      expectedCardCount: sourceSet.cardCount, rarityScheme: current?.rarityScheme ?? [], tracked: current?.tracked ?? false,
    });
  }

  const mergeVariant = (expected: CardVariant) => {
    const current = variants.get(expected.id);
    if (!current) { variants.set(expected.id, expected); return; }
    const urls = [...current.imageUrls];
    for (const image of expected.imageUrls) if (!urls.some((existing) => existing.url === image.url)) urls.push(image);
    variants.set(expected.id, {
      ...current,
      name: current.name || expected.name,
      treatment: current.treatment ?? expected.treatment,
      imageUrls: urls,
      imageNote: current.imageNote ?? expected.imageNote,
    });
  };

  for (const entry of update.cards) {
    const id = unionArenaCardId(entry.setId, entry.number);
    const expectedCard = { id, setId: entry.setId, number: entry.number, name: entry.name, ...(entry.sourceNote ? { sourceNote: entry.sourceNote } : {}) };
    const current = cards.get(id);
    cards.set(id, current ? { ...current, name: current.name.trim() ? current.name : entry.name, sourceNote: current.sourceNote ?? entry.sourceNote } : expectedCard);
    for (const expected of baseVariants(id, entry.imageUrl, update.cataloguedAt)) mergeVariant(expected);

    for (const parallel of parallelEntries(entry)) {
      const bonusId = unionArenaParallelCardId(id, parallel.id);
      const bonusLabel = `Full Art · ${parallel.id.toUpperCase()}`;
      const bonusCard = { ...expectedCard, id: bonusId, countsTowardSetCompletion: false, relatedCardId: id, bonusLabel };
      const currentBonus = cards.get(bonusId);
      cards.set(bonusId, currentBonus ? { ...currentBonus, name: currentBonus.name.trim() ? currentBonus.name : entry.name, sourceNote: currentBonus.sourceNote ?? entry.sourceNote } : bonusCard);
      mergeVariant(parallelVariant(id, parallel.id, parallel.imageUrl, update.cataloguedAt));
    }
  }

  const ownership = vault.catalog.ownership.map((item) => !item.variantId && update.cards.some((entry) => unionArenaCardId(entry.setId, entry.number) === item.cardId)
    ? { ...item, variantId: unionArenaVariantId(item.cardId, 'normal') }
    : item);
  const next: VaultData = {
    schemaVersion: vault.schemaVersion, updatedAt: new Date().toISOString(),
    catalog: {
      ...vault.catalog,
      publishers: [...publishers.values()], franchises: [...franchises.values()], series: [...seriesRecords.values()],
      sets: [...sets.values()], cards: [...cards.values()], variants: [...variants.values()], ownership,
    },
  };
  const errors = validateCatalog(next.catalog);
  if (errors.length) throw new Error(`Union Arena catalog failed validation: ${errors.join(' ')}`);
  return next;
}
