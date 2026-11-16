import { validateCatalog, type CardDefinition, type CardSet, type CardVariant, type VaultData } from './domain';

export type NarutoCatalogCard = {
  id: string;
  setId: string;
  provisionalNumber: string;
  number: string;
  name: string;
  rarity: string;
  imageUrl: string | null;
  isPromo: boolean;
};

export type NarutoCatalogSet = {
  id: string;
  code: string;
  title: string;
  displayName: string;
  cardCount: number;
  rarityScheme: string[];
  rarityCounts: Record<string, number>;
  trackedByDefault: boolean;
  sourceUrl: string;
};

export type NarutoCatalogUpdate = {
  schemaVersion: 2;
  source: 'NarutoDB';
  market: 'North America';
  cataloguedAt: string;
  sourcePages: Record<string, string>;
  sets: NarutoCatalogSet[];
  cards: NarutoCatalogCard[];
};

export type NarutoCatalogUpdatePlan = {
  setsToAdd: number;
  cardsToAdd: number;
  namesToFill: number;
  numbersToUpdate: number;
  raritiesToFill: number;
  imagesToAdd: number;
  sourceNotesToRefresh: number;
  customNamesToPreserve: number;
  customNumbersToPreserve: number;
  conflicts: string[];
  hasChanges: boolean;
};

type ExpectedSet = Pick<NarutoCatalogSet, 'code' | 'title' | 'cardCount' | 'rarityCounts' | 'trackedByDefault'>;
const EXPECTED_SETS: ExpectedSet[] = [
  { code: 'NRSA01', title: 'Heaven Scroll', cardCount: 159, trackedByDefault: false, rarityCounts: { SE: 4, BP: 7, SP: 4, MR: 6, PU: 8, UR: 15, SSR: 24, SR: 20, PTR: 20, R: 50, PR: 1 } },
  { code: 'NRSA02', title: 'Chapter Jin', cardCount: 172, trackedByDefault: false, rarityCounts: { SE: 4, AR: 10, BP: 7, SP: 4, MR: 7, PU: 8, UR: 15, SSR: 23, SR: 20, PTR: 20, R: 50, PR: 4 } },
  { code: 'NRSA03', title: 'Chapter Jin 3', cardCount: 187, trackedByDefault: false, rarityCounts: { '◇ASP': 8, ASP: 8, '◇UR': 11, SE: 4, AR: 6, BP: 7, MR: 8, PU: 8, UR: 15, SSR: 20, SR: 20, HR: 20, R: 50, PR: 2 } },
  { code: 'NREA01', title: 'Earth Scroll', cardCount: 132, trackedByDefault: false, rarityCounts: { AR: 10, SP: 4, CR: 4, MR: 4, UR: 15, SSR: 24, SR: 20, R: 50, PR: 1 } },
  { code: 'NREA02', title: 'Earth Scroll 2', cardCount: 133, trackedByDefault: true, rarityCounts: { CR: 4, '◇UR': 4, AR: 10, MR: 4, UR: 15, SSR: 25, SR: 20, R: 50, PR: 1 } },
  { code: 'NRCCNA', title: 'Ninja Age', cardCount: 110, trackedByDefault: false, rarityCounts: { '◇QR': 1, '◇XR': 7, '◇MR': 2, QR: 9, XR: 6, MR: 8, SP: 11, PTR: 20, UR: 22, SSR: 20, PR: 2, '◇PR': 2 } },
  { code: 'NRSA04', title: 'Chapter Jin 4', cardCount: 186, trackedByDefault: false, rarityCounts: { SE: 4, '◇SP': 8, SP: 8, AR: 8, BP: 5, MR: 8, PU: 6, HR: 20, '◇UR': 12, UR: 24, SSR: 13, SR: 20, R: 50 } },
  { code: 'NREA03', title: 'Earth Scroll 3', cardCount: 123, trackedByDefault: true, rarityCounts: { CR: 4, SP: 4, MR: 4, UR: 15, SSR: 25, SR: 20, R: 50, PR: 1 } },
];
const SERIES_ID = 'series:kayou-naruto';
const PROVISIONAL_NOTE = 'Provisional rarity index; exact card name and printed number are unverified.';
const PROMO_RARITIES = new Set(['PR', '◇PR']);
const ID_PREFIX: Record<string, string> = {
  '◇UR': 'PARALLEL_UR',
  '◇ASP': 'DIAMOND_ASP',
  '◇QR': 'DIAMOND_QR',
  '◇XR': 'DIAMOND_XR',
  '◇MR': 'DIAMOND_MR',
  '◇SP': 'DIAMOND_SP',
  '◇PR': 'DIAMOND_PR',
};
const setIdFor = (code: string) => 'set:kayou-naruto-' + code.toLowerCase();
const displayNameFor = (code: string, title: string) => code + ' · ' + title;
const sourceUrlFor = (code: string) => 'https://narutodb.com/kayou/sets/' + code;
const sameRecord = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sameCounts = (actual: unknown, expected: Record<string, number>) => !!actual && typeof actual === 'object'
  && !Array.isArray(actual) && Object.keys(actual).length === Object.keys(expected).length
  && Object.entries(expected).every(([key, count]) => (actual as Record<string, unknown>)[key] === count);

function expectedCatalogSets(): NarutoCatalogSet[] {
  return EXPECTED_SETS.map((set) => ({
    id: setIdFor(set.code),
    code: set.code,
    title: set.title,
    displayName: displayNameFor(set.code, set.title),
    cardCount: set.cardCount,
    rarityScheme: Object.keys(set.rarityCounts),
    rarityCounts: set.rarityCounts,
    trackedByDefault: set.trackedByDefault,
    sourceUrl: sourceUrlFor(set.code),
  }));
}

function isVerifiedImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'cdn.narutodb.com';
  } catch { return false; }
}

export function parseNarutoCatalogUpdate(value: unknown): NarutoCatalogUpdate {
  if (!value || typeof value !== 'object') throw new Error('Naruto catalog update must be a JSON object.');
  const update = value as Partial<NarutoCatalogUpdate>;
  if (update.schemaVersion !== 2 || update.source !== 'NarutoDB' || update.market !== 'North America'
    || !Number.isFinite(Date.parse(update.cataloguedAt ?? '')) || !Array.isArray(update.sets) || !Array.isArray(update.cards)) {
    throw new Error('Naruto catalog update has an unsupported format.');
  }
  const expectedSets = expectedCatalogSets();
  const expectedCardCount = expectedSets.reduce((sum, set) => sum + set.cardCount, 0);
  if (update.sets.length !== expectedSets.length || update.cards.length !== expectedCardCount) {
    throw new Error('Naruto catalog update is incomplete; expected all eight North American set lists.');
  }
  for (let index = 0; index < expectedSets.length; index++) {
    const expected = expectedSets[index];
    const actual = update.sets[index];
    if (!actual || actual.id !== expected.id || actual.code !== expected.code || actual.title !== expected.title
      || actual.displayName !== expected.displayName || actual.cardCount !== expected.cardCount
      || actual.trackedByDefault !== expected.trackedByDefault
      || actual.sourceUrl !== expected.sourceUrl
      || !sameRecord(actual.rarityScheme, expected.rarityScheme)
      || !sameCounts(actual.rarityCounts, expected.rarityCounts)) {
      throw new Error('Naruto catalog has an unexpected or incomplete set: ' + (actual?.code ?? '(unknown)') + '.');
    }
  }
  const expectedPages = Object.fromEntries(expectedSets.map((set) => [set.code, set.sourceUrl]));
  if (!update.sourcePages || Object.keys(update.sourcePages).length !== Object.keys(expectedPages).length
    || Object.entries(expectedPages).some(([code, url]) => update.sourcePages?.[code] !== url)) {
    throw new Error('Naruto catalog source pages do not match the approved set list.');
  }

  const setsById = new Map(expectedSets.map((set) => [set.id, set]));
  const cardIds = new Set<string>();
  const numbers = new Set<string>();
  const countsBySet = new Map<string, number>();
  const raritiesBySet = new Map<string, Map<string, number>>();
  for (const card of update.cards) {
    const set = card && setsById.get(card.setId);
    if (!set) throw new Error('Naruto catalog contains a card with an unexpected set identity.');
    const idCode = set.code;
    const expectedPrefix = ID_PREFIX[card.rarity] ?? card.rarity;
    const slotMatch = typeof card.provisionalNumber === 'string' ? card.provisionalNumber.match(/^([A-Z_]+)(\d{3})$/) : null;
    const numberPrefix = typeof card.number === 'string' ? card.number.split('-', 1)[0] : '';
    const validNumberPrefix = numberPrefix === idCode
      || (PROMO_RARITIES.has(card.rarity) && (numberPrefix === 'NRSA' || numberPrefix === 'NREA'));
    if (!slotMatch || slotMatch[1] !== expectedPrefix
      || card.id !== 'kayou-naruto:' + idCode + ':' + card.provisionalNumber
      || typeof card.number !== 'string' || !validNumberPrefix || card.number !== card.number.trim()
      || typeof card.name !== 'string' || !card.name.trim() || card.name !== card.name.trim()
      || !Object.prototype.hasOwnProperty.call(set.rarityCounts, card.rarity)
      || typeof card.isPromo !== 'boolean' || card.isPromo !== PROMO_RARITIES.has(card.rarity)) {
      throw new Error('Naruto catalog has invalid card details for ' + (card?.id ?? '(unknown)') + '.');
    }
    if (card.imageUrl !== null && (typeof card.imageUrl !== 'string' || !isVerifiedImageUrl(card.imageUrl))) {
      throw new Error('Naruto catalog has an invalid or unapproved image URL for ' + card.id + '.');
    }
    if (cardIds.has(card.id) || numbers.has(card.setId + ':' + card.number)) {
      throw new Error('Naruto catalog repeats a card identity for ' + card.id + '.');
    }
    cardIds.add(card.id);
    numbers.add(card.setId + ':' + card.number);
    countsBySet.set(card.setId, (countsBySet.get(card.setId) ?? 0) + 1);
    const rarityCounts = raritiesBySet.get(card.setId) ?? new Map<string, number>();
    rarityCounts.set(card.rarity, (rarityCounts.get(card.rarity) ?? 0) + 1);
    raritiesBySet.set(card.setId, rarityCounts);
  }
  for (const set of expectedSets) {
    const id = setIdFor(set.code);
    if (countsBySet.get(id) !== set.cardCount) throw new Error(set.code + ' is missing catalog entries.');
    const actualRarities = raritiesBySet.get(id) ?? new Map<string, number>();
    for (const [rarity, count] of Object.entries(set.rarityCounts)) {
      if (actualRarities.get(rarity) !== count) throw new Error(set.code + ' has an incomplete ' + rarity + ' rarity list.');
    }
  }
  return update as NarutoCatalogUpdate;
}

export function planNarutoCatalogUpdate(vault: VaultData, update: NarutoCatalogUpdate): NarutoCatalogUpdatePlan {
  const conflicts: string[] = [];
  let setsToAdd = 0;
  let cardsToAdd = 0;
  let namesToFill = 0;
  let numbersToUpdate = 0;
  let raritiesToFill = 0;
  let imagesToAdd = 0;
  let sourceNotesToRefresh = 0;
  let customNamesToPreserve = 0;
  let customNumbersToPreserve = 0;
  const sets = new Map(vault.catalog.sets.map((set) => [set.id, set]));
  const cards = new Map(vault.catalog.cards.map((card) => [card.id, card]));
  const variants = new Map(vault.catalog.variants.map((variant) => [variant.id, variant]));

  if (!vault.catalog.series.some((series) => series.id === SERIES_ID)) conflicts.push('The Kayou Naruto series is missing from this vault.');
  for (const sourceSet of update.sets) {
    const currentSet = sets.get(sourceSet.id);
    if (!currentSet) setsToAdd++;
    else {
      if (currentSet.seriesId !== SERIES_ID) conflicts.push('Set ' + sourceSet.code + ' belongs to a different series.');
      if (currentSet.expectedCardCount !== undefined && currentSet.expectedCardCount !== sourceSet.cardCount) {
        conflicts.push('Set ' + sourceSet.code + ' has a different expected card count in this vault.');
      }
    }

    const sourceCards = update.cards.filter((card) => card.setId === sourceSet.id);
    const sourceCardIds = new Set(sourceCards.map((card) => card.id));
    const localSetCards = vault.catalog.cards.filter((card) => card.setId === sourceSet.id);
    const unmatched = localSetCards.filter((card) => !sourceCardIds.has(card.id));
    if (unmatched.length) conflicts.push('Set ' + sourceSet.code + ' has ' + unmatched.length + ' local card record(s) absent from the verified catalog.');

    for (const entry of sourceCards) {
      const current = cards.get(entry.id);
      if (!current) {
        cardsToAdd++;
      } else {
        if (current.setId !== entry.setId) conflicts.push('Card ' + entry.id + ' belongs to a different set.');
        if (!current.name.trim()) namesToFill++;
        else if (current.name !== entry.name) customNamesToPreserve++;
        if (current.number === entry.provisionalNumber) numbersToUpdate++;
        else if (current.number !== entry.number) customNumbersToPreserve++;
        if (!current.rarity) raritiesToFill++;
        if (current.sourceNote?.startsWith(PROVISIONAL_NOTE)) sourceNotesToRefresh++;
      }
      if (entry.imageUrl) {
        const variant = variants.get(entry.id + ':narutodb');
        if (!variant) imagesToAdd++;
        else if (variant.cardId !== entry.id) conflicts.push('NarutoDB image record for ' + entry.number + ' belongs to a different card.');
        else if (!variant.imageUrls.some((image) => image.url === entry.imageUrl)) imagesToAdd++;
      }
    }
  }
  const setMetadataChanges = update.sets.some((sourceSet) => {
    const current = sets.get(sourceSet.id);
    return current && (current.expectedCardCount !== sourceSet.cardCount
      || !sameRecord(current.rarityScheme ?? [], sourceSet.rarityScheme)
      || current.name === sourceSet.code);
  });
  const hasChanges = setsToAdd + cardsToAdd + namesToFill + numbersToUpdate + raritiesToFill
    + imagesToAdd + sourceNotesToRefresh > 0 || setMetadataChanges;
  return {
    setsToAdd, cardsToAdd, namesToFill, numbersToUpdate, raritiesToFill, imagesToAdd,
    sourceNotesToRefresh, customNamesToPreserve, customNumbersToPreserve, conflicts, hasChanges,
  };
}

export function applyNarutoCatalogUpdate(vault: VaultData, update: NarutoCatalogUpdate): VaultData {
  const plan = planNarutoCatalogUpdate(vault, update);
  if (plan.conflicts.length) throw new Error('Naruto catalog update paused for review: ' + plan.conflicts.join(' '));
  const setRecords = new Map(vault.catalog.sets.map((set) => [set.id, set]));
  const cards = new Map(vault.catalog.cards.map((card) => [card.id, card]));
  const variants = new Map(vault.catalog.variants.map((variant) => [variant.id, variant]));

  for (const sourceSet of update.sets) {
    const existing = setRecords.get(sourceSet.id);
    const name = !existing || existing.name === sourceSet.code || existing.name === sourceSet.displayName
      ? sourceSet.displayName : existing.name;
    const set: CardSet = {
      ...(existing ?? {}),
      id: sourceSet.id,
      seriesId: SERIES_ID,
      name,
      expectedCardCount: sourceSet.cardCount,
      rarityScheme: [...sourceSet.rarityScheme],
      tracked: existing?.tracked ?? sourceSet.trackedByDefault,
    };
    setRecords.set(set.id, set);
  }

  for (const entry of update.cards) {
    const current = cards.get(entry.id);
    let next: CardDefinition;
    if (current) {
      next = { ...current };
      if (!next.name.trim()) next.name = entry.name;
      if (next.number === entry.provisionalNumber) next.number = entry.number;
      if (!next.rarity) next.rarity = entry.rarity;
      if (next.sourceNote?.startsWith(PROVISIONAL_NOTE)) {
        const remaining = next.sourceNote.slice(PROVISIONAL_NOTE.length).trim();
        next.sourceNote = ['Catalog code verified by NarutoDB: ' + entry.number + '.', remaining].filter(Boolean).join(' ');
      }
    } else {
      next = {
        id: entry.id, setId: entry.setId, number: entry.number, name: entry.name, rarity: entry.rarity,
        ...(entry.isPromo ? { category: 'Promo' } : {}),
      };
    }
    cards.set(entry.id, next);

    if (entry.imageUrl) {
      const variantId = entry.id + ':narutodb';
      const currentVariant = variants.get(variantId);
      const imageUrls = [...(currentVariant?.imageUrls ?? [])];
      if (!imageUrls.some((image) => image.url === entry.imageUrl)) {
        imageUrls.push({ url: entry.imageUrl, source: 'verified-remote', verifiedAt: update.cataloguedAt });
      }
      const variant: CardVariant = {
        id: variantId, cardId: entry.id,
        name: currentVariant?.name ?? 'NarutoDB thumbnail · ' + entry.number,
        imageUrls,
      };
      variants.set(variantId, variant);
    }
  }

  const result: VaultData = {
    ...vault,
    updatedAt: new Date().toISOString(),
    catalog: {
      ...vault.catalog,
      sets: [...setRecords.values()],
      cards: [...cards.values()],
      variants: [...variants.values()],
    },
  };
  const errors = validateCatalog(result.catalog);
  if (errors.length) throw new Error('Naruto catalog update failed validation: ' + errors.join(' '));
  return result;
}
