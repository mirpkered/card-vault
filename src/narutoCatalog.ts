import { validateCatalog, type CardDefinition, type CardVariant, type VaultData } from './domain';

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
  name: string;
  cardCount: number;
  sourceUrl: string;
};

export type NarutoCatalogUpdate = {
  schemaVersion: 1;
  source: 'NarutoDB';
  cataloguedAt: string;
  sourcePages: Record<string, string>;
  sets: NarutoCatalogSet[];
  cards: NarutoCatalogCard[];
};

export type NarutoCatalogUpdatePlan = {
  cardsToAdd: number;
  namesToFill: number;
  numbersToUpdate: number;
  raritiesToFill: number;
  imagesToAdd: number;
  sourceNotesToRefresh: number;
  customNamesToPreserve: number;
  customNumbersToPreserve: number;
  hasChanges: boolean;
};

const EXPECTED_SETS = new Map([
  ['set:kayou-naruto-nrea02', { name: 'NREA02', cardCount: 133 }],
  ['set:kayou-naruto-nrea03', { name: 'NREA03', cardCount: 123 }],
]);
const EXPECTED_RARITIES = new Map([
  ['set:kayou-naruto-nrea02', { CR: 4, '◇UR': 4, AR: 10, MR: 4, UR: 15, SSR: 25, SR: 20, R: 50, PR: 1 }],
  ['set:kayou-naruto-nrea03', { CR: 4, SP: 4, MR: 4, UR: 15, SSR: 25, SR: 20, R: 50, PR: 1 }],
]);
const PROVISIONAL_NOTE = 'Provisional rarity index; exact card name and printed number are unverified.';

export function parseNarutoCatalogUpdate(value: unknown): NarutoCatalogUpdate {
  if (!value || typeof value !== 'object') throw new Error('Naruto catalog update must be a JSON object.');
  const update = value as Partial<NarutoCatalogUpdate>;
  if (update.schemaVersion !== 1 || update.source !== 'NarutoDB' || !Array.isArray(update.sets) || !Array.isArray(update.cards)) {
    throw new Error('Naruto catalog update has an unsupported format.');
  }
  if (update.sets.length !== EXPECTED_SETS.size || update.cards.length !== 256) {
    throw new Error('Naruto catalog update is incomplete; expected both full set lists.');
  }
  const setIds = new Set<string>();
  for (const set of update.sets) {
    const expected = EXPECTED_SETS.get(set.id);
    if (!expected || set.name !== expected.name || set.cardCount !== expected.cardCount || setIds.has(set.id)) {
      throw new Error('Naruto catalog update has an unexpected or repeated set: ' + set.name + '.');
    }
    if (typeof set.sourceUrl !== 'string' || !set.sourceUrl.startsWith('https://narutodb.com/kayou/sets/' + set.name)) {
      throw new Error('Naruto catalog update has an invalid ' + set.name + ' source URL.');
    }
    setIds.add(set.id);
  }
  const cardIds = new Set<string>();
  const sourceNumbers = new Set<string>();
  const perSet = new Map<string, number>();
  const raritiesBySet = new Map<string, Map<string, number>>();
  for (const card of update.cards) {
    const setCode = card.setId.endsWith('nrea02') ? 'NREA02' : 'NREA03';
    if (!EXPECTED_SETS.has(card.setId) || !card.id.startsWith('kayou-naruto:' + setCode + ':')) {
      throw new Error('Naruto catalog update contains a card with an unexpected set identity.');
    }
    if (!card.id.endsWith(':' + card.provisionalNumber) || !card.provisionalNumber || !card.number || !card.name.trim() || !card.rarity) {
      throw new Error('Naruto catalog update has incomplete details for ' + card.id + '.');
    }
    if (!Object.prototype.hasOwnProperty.call(EXPECTED_RARITIES.get(card.setId) ?? {}, card.rarity)) {
      throw new Error('Naruto catalog update has an unexpected rarity for ' + card.id + '.');
    }
    if (card.isPromo !== (card.rarity === 'PR')) throw new Error('Naruto catalog update has an inconsistent Promo marker for ' + card.id + '.');
    if (card.imageUrl !== null) {
      let imageUrl: URL;
      try { imageUrl = new URL(card.imageUrl); } catch { throw new Error('Naruto catalog update has an invalid image URL for ' + card.id + '.'); }
      if (imageUrl.protocol !== 'https:' || imageUrl.hostname !== 'cdn.narutodb.com') {
        throw new Error('Naruto catalog update has an unapproved image host for ' + card.id + '.');
      }
    }
    if (cardIds.has(card.id) || sourceNumbers.has(card.setId + ':' + card.number)) {
      throw new Error('Naruto catalog update repeats a card identity for ' + card.id + '.');
    }
    cardIds.add(card.id);
    sourceNumbers.add(card.setId + ':' + card.number);
    perSet.set(card.setId, (perSet.get(card.setId) ?? 0) + 1);
    const rarityCounts = raritiesBySet.get(card.setId) ?? new Map<string, number>();
    rarityCounts.set(card.rarity, (rarityCounts.get(card.rarity) ?? 0) + 1);
    raritiesBySet.set(card.setId, rarityCounts);
  }
  for (const [setId, expected] of EXPECTED_SETS) {
    if (perSet.get(setId) !== expected.cardCount) throw new Error(expected.name + ' is missing catalog entries.');
    const rarityCounts = raritiesBySet.get(setId) ?? new Map<string, number>();
    for (const [rarity, count] of Object.entries(EXPECTED_RARITIES.get(setId) ?? {})) {
      if (rarityCounts.get(rarity) !== count) throw new Error(expected.name + ' has an incomplete ' + rarity + ' rarity list.');
    }
  }
  return update as NarutoCatalogUpdate;
}

export function planNarutoCatalogUpdate(vault: VaultData, update: NarutoCatalogUpdate): NarutoCatalogUpdatePlan {
  const existingCards = new Map(vault.catalog.cards.map((card) => [card.id, card]));
  const variants = new Map(vault.catalog.variants.map((variant) => [variant.id, variant]));
  const plan: NarutoCatalogUpdatePlan = {
    cardsToAdd: 0, namesToFill: 0, numbersToUpdate: 0, raritiesToFill: 0,
    imagesToAdd: 0, sourceNotesToRefresh: 0, customNamesToPreserve: 0,
    customNumbersToPreserve: 0, hasChanges: false,
  };
  for (const entry of update.cards) {
    const current = existingCards.get(entry.id);
    if (!current) {
      plan.cardsToAdd++;
      plan.namesToFill++;
      if (entry.imageUrl) plan.imagesToAdd++;
      continue;
    }
    if (!current.name.trim()) plan.namesToFill++;
    else if (current.name !== entry.name) plan.customNamesToPreserve++;
    if (current.number === entry.provisionalNumber) plan.numbersToUpdate++;
    else if (current.number !== entry.number) plan.customNumbersToPreserve++;
    if (!current.rarity) plan.raritiesToFill++;
    if (current.sourceNote?.startsWith(PROVISIONAL_NOTE)) plan.sourceNotesToRefresh++;
    const variantId = entry.id + ':narutodb';
    if (entry.imageUrl && !variants.has(variantId)) plan.imagesToAdd++;
  }
  plan.hasChanges = plan.cardsToAdd + plan.namesToFill + plan.numbersToUpdate
    + plan.raritiesToFill + plan.imagesToAdd + plan.sourceNotesToRefresh > 0;
  return plan;
}

export function applyNarutoCatalogUpdate(vault: VaultData, update: NarutoCatalogUpdate): VaultData {
  const cards = new Map(vault.catalog.cards.map((card) => [card.id, card]));
  const variants = new Map(vault.catalog.variants.map((variant) => [variant.id, variant]));

  for (const entry of update.cards) {
    const current = cards.get(entry.id);
    if (current && current.setId !== entry.setId) throw new Error('Card ' + entry.id + ' belongs to a different set in the local vault.');
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
      const existingVariant = variants.get(variantId);
      if (existingVariant && (existingVariant.cardId !== entry.id || existingVariant.imageUrls[0]?.url !== entry.imageUrl)) {
        throw new Error('The saved NarutoDB image record for ' + entry.id + ' differs; review it before updating.');
      }
      if (!existingVariant) {
        const variant: CardVariant = {
          id: variantId,
          cardId: entry.id,
          name: 'NarutoDB thumbnail · ' + entry.number,
          imageUrls: [{ url: entry.imageUrl, source: 'verified-remote', verifiedAt: update.cataloguedAt }],
        };
        variants.set(variantId, variant);
      }
    }
  }

  const result: VaultData = {
    ...vault,
    updatedAt: new Date().toISOString(),
    catalog: {
      ...vault.catalog,
      cards: [...cards.values()],
      variants: [...variants.values()],
    },
  };
  const errors = validateCatalog(result.catalog);
  if (errors.length) throw new Error('Naruto catalog update failed validation: ' + errors.join(' '));
  return result;
}
