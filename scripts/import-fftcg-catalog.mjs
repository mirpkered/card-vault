import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const browserUrl = 'https://fftcg.square-enix-games.com/na/card-browser';
const apiUrl = 'https://fftcg.square-enix-games.com/na/get-cards';
const expectedSetNames = [
  'Opus I', 'Opus II', 'Opus III', 'Opus IV', 'Opus V', 'Opus VI', 'Opus VII',
  'Opus VIII', 'Opus IX', 'Opus X', 'Opus XI', 'Opus XII', 'Opus XIII', 'Opus XIV',
  'Crystal Dominion', 'Emissaries of Light', "Rebellion's Call", 'Resurgence of Power',
  'From Nightmares', 'Dawn of Heroes', 'Beyond Destiny', 'Hidden Hope', 'Hidden Trials',
  'Hidden Legends', 'Tears of the Planet', 'Gunslinger in the Abyss', 'Journey of Discovery',
  'Dreamlike Oceans', 'Blissful Eternity', 'Memories of Life', 'Boss Deck Chaos',
  'Boss Deck FFVII', 'Dissidia Collection Set', 'Legacy Collection',
];

function slugify(value) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function imageFileName(url) {
  return new URL(url).pathname.split('/').pop() ?? '';
}

function deriveVariants(setName, cardNumber, imageUrls) {
  const normalImages = imageUrls.filter((url) => {
    const file = imageFileName(url);
    return !/(?:_FL|_premium|_SP|_SS2|_ho)(?:_|\.|$)/i.test(file);
  });
  const primaryCode = cardNumber.split('/')[0];
  const normalUrl = normalImages.find((url) => imageFileName(url).toLowerCase() === `${primaryCode.toLowerCase()}_eg.jpg`)
    ?? normalImages[0] ?? imageUrls[0];
  const premiumImages = imageUrls.filter((url) => /_premium(?:_eg)?\.jpg$/i.test(imageFileName(url)) || /_eg_premium\.jpg$/i.test(imageFileName(url)) || /_ho\.jpg$/i.test(imageFileName(url)));
  const fullArtImages = imageUrls.filter((url) => /_FL(?:_eg)?(?:_[0-9]+)?\.jpg$/i.test(imageFileName(url)) || /_eg_FL(?:_[0-9]+)?\.jpg$/i.test(imageFileName(url)));
  const isNoirTreatment = setName === 'Memories of Life' && cardNumber === '7-034L';
  const specialImages = imageUrls.filter((url) => /_(?:SP|SS2)(?:_|\.|$)/i.test(imageFileName(url)));
  return [
    { treatment: 'normal', name: 'Normal', imageUrls: [normalUrl] },
    {
      treatment: 'foil',
      name: 'Foil',
      imageUrls: premiumImages.length ? premiumImages : [normalUrl],
      ...(!premiumImages.length ? { imageNote: 'The foil finish is not visible in Square Enix’s available catalog image.' } : {}),
    },
    ...(fullArtImages.length && !isNoirTreatment ? [{ treatment: 'full-art', name: 'Full Art', imageUrls: fullArtImages }] : []),
    ...(isNoirTreatment ? [{ treatment: 'special', name: 'Noir', imageUrls: fullArtImages }] : []),
    ...(specialImages.length ? [{ treatment: 'special', name: 'Special', imageUrls: specialImages }] : []),
  ];
}

const page = await fetch(browserUrl);
if (!page.ok) throw new Error(`Square Enix Card Browser returned HTTP ${page.status}.`);
const html = await page.text();
const filterStart = html.indexOf('class="filter set multi"');
const filterEnd = html.indexOf('class="filter category multi"', filterStart);
if (filterStart < 0 || filterEnd < 0) throw new Error('Could not locate the official Card Browser set filters. No file was written.');
const setFilter = html.slice(filterStart, filterEnd);
const setNames = [...setFilter.matchAll(/data-value="([^"]+)"/g)].map((match) => match[1].trim());
if (JSON.stringify(setNames) !== JSON.stringify(expectedSetNames)) {
  throw new Error('The official Card Browser set list changed. Review the new release names before importing. No file was written.');
}

const query = {
  language: 'en_US', text: '', type: [], element: [], cost: [], rarity: [], power: [],
  category_1: [], set: setNames, multicard: '', ex_burst: '', code: '', special: '', exactmatch: 0,
};
const response = await fetch(apiUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
  body: JSON.stringify(query),
});
if (!response.ok) throw new Error(`Square Enix Card Browser returned HTTP ${response.status}.`);
const result = await response.json();
if (!Array.isArray(result.cards) || result.count !== result.cards.length) {
  throw new Error('Square Enix returned a partial or unexpected card list. No file was written.');
}

const setCards = new Map(setNames.map((name) => [name, new Map()]));
const knownSets = new Set(setNames);
for (const sourceCard of result.cards) {
  if (typeof sourceCard.code !== 'string' || !sourceCard.code.trim() || !Array.isArray(sourceCard.set)) {
    throw new Error('Square Enix returned a card without a usable code or set. No file was written.');
  }
  const memberships = sourceCard.set.filter((name) => knownSets.has(name));
  if (!memberships.length) throw new Error(`Card ${sourceCard.code} is not assigned to a listed set. No file was written.`);
  const name = typeof sourceCard.name_en === 'string' ? sourceCard.name_en.trim() : '';
  const rarity = typeof sourceCard.rarity === 'string' ? sourceCard.rarity.trim() : '';
  const imageUrls = [...new Set(Array.isArray(sourceCard.images?.full) ? sourceCard.images.full.filter((url) => typeof url === 'string' && url.trim()) : [])];
  for (const image of imageUrls) {
    const url = new URL(image);
    if (url.protocol !== 'https:' || url.hostname !== 'fftcg.cdn.sewest.net' || !url.pathname.startsWith('/images/cards/full/') || !url.pathname.toLowerCase().endsWith('.jpg')) {
      throw new Error(`Card ${sourceCard.code} has an unexpected image host or path. No file was written.`);
    }
  }
  for (const setName of memberships) {
    const cards = setCards.get(setName);
    if (cards.has(sourceCard.code)) throw new Error(`Set ${setName} repeats card code ${sourceCard.code}. No file was written.`);
    cards.set(sourceCard.code, {
      number: sourceCard.code.trim(),
      name,
      ...(rarity ? { rarity } : {}),
      imageUrls,
      variants: deriveVariants(setName, sourceCard.code.trim(), imageUrls),
      ...(!name || !rarity ? { sourceNote: `The Square Enix Card Browser did not provide an English name${!rarity ? ' or rarity' : ''} for this entry.` } : {}),
    });
  }
}

const sets = setNames.map((name) => {
  const cards = [...setCards.get(name).values()].sort((left, right) => left.number.localeCompare(right.number, 'en'));
  if (!cards.length) throw new Error(`Set ${name} returned no card definitions. No file was written.`);
  const rarityCounts = {};
  for (const card of cards) if (card.rarity) rarityCounts[card.rarity] = (rarityCounts[card.rarity] ?? 0) + 1;
  return {
    id: `set:final-fantasy-tcg:${slugify(name)}`,
    seriesId: 'series:final-fantasy-tcg',
    name,
    cardCount: cards.length,
    rarityScheme: Object.keys(rarityCounts),
    rarityCounts,
    trackedByDefault: name === 'Memories of Life',
  };
});

const cards = setNames.flatMap((name) => {
  const setId = `set:final-fantasy-tcg:${slugify(name)}`;
  return [...setCards.get(name).values()].sort((left, right) => left.number.localeCompare(right.number, 'en'))
    .map((card) => ({ setId, ...card }));
});
const unnamed = cards.filter((card) => !card.name).length;
const output = {
  schemaVersion: 3,
  source: 'Square Enix official Card Browser',
  cataloguedAt: new Date().toISOString(),
  browserUrl,
  sourceCardCount: result.count,
  sets,
  cards,
};
const outputPath = resolve('public/fftcg-catalog.json');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Wrote ${sets.length} sets, ${cards.length} set-specific card definitions from ${result.count} browser records, and ${unnamed} entries without official English names to ${outputPath}.`);
