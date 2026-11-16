import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const browserUrl = 'https://fftcg.square-enix-games.com/na/card-browser';
const productUrl = 'https://fftcg.square-enix-games.com/na/news/new-product-information-memories-of-life-booster-set';
const apiUrl = 'https://fftcg.square-enix-games.com/na/get-cards';
const expectedRarities = { C: 48, R: 30, H: 26, L: 14 };
const request = {
  language: 'en_US', text: '', type: [], element: [], cost: [], rarity: [], power: [],
  category_1: [], set: ['Memories of Life'], multicard: '', ex_burst: '', code: '',
  special: '', exactmatch: 0,
};

const response = await fetch(apiUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
  body: JSON.stringify(request),
});
if (!response.ok) throw new Error(`Square Enix card browser returned HTTP ${response.status}.`);
const result = await response.json();
if (!Array.isArray(result.cards)) throw new Error('Square Enix card browser returned an unexpected response.');

const cards = result.cards
  .filter((card) => Array.isArray(card.set)
    && card.set.includes('Memories of Life')
    && /^30-\d{3}[CRHL](?:\/\d{1,2}-\d{3}[CRHL])?$/.test(card.code)
    && Object.hasOwn(expectedRarities, card.rarity))
  .map((card) => ({
    number: card.code,
    name: typeof card.name_en === 'string' ? card.name_en.trim() : '',
    rarity: card.rarity,
    imageUrl: Array.isArray(card.images?.full) ? card.images.full[0] ?? null : null,
  }))
  .sort((left, right) => left.number.localeCompare(right.number, 'en'));

if (cards.length !== 118) throw new Error(`Expected 118 standard cards for Memories of Life; received ${cards.length}. No file was written.`);
const numbers = new Set();
const rarityCounts = { C: 0, R: 0, H: 0, L: 0 };
for (const card of cards) {
  if (numbers.has(card.number)) throw new Error(`Repeated card number ${card.number}. No file was written.`);
  if (!card.name) throw new Error(`Card ${card.number} has no verified English name. No file was written.`);
  if (card.number.split('/')[0].slice(-1) !== card.rarity) throw new Error(`Card ${card.number} has inconsistent rarity. No file was written.`);
  if (typeof card.imageUrl !== 'string') throw new Error(`Card ${card.number} has no official image URL. No file was written.`);
  const imageUrl = new URL(card.imageUrl);
  if (imageUrl.protocol !== 'https:' || imageUrl.hostname !== 'fftcg.cdn.sewest.net'
    || !imageUrl.pathname.startsWith('/images/cards/full/')
    || !imageUrl.pathname.toLowerCase().endsWith('.jpg')) {
    throw new Error(`Card ${card.number} has an unexpected official image URL. No file was written.`);
  }
  numbers.add(card.number);
  rarityCounts[card.rarity]++;
}
for (const [rarity, count] of Object.entries(expectedRarities)) {
  if (rarityCounts[rarity] !== count) throw new Error(`Expected ${count} ${rarity} cards; received ${rarityCounts[rarity]}. No file was written.`);
}

const output = {
  schemaVersion: 1,
  source: 'Square Enix official Card Browser',
  cataloguedAt: new Date().toISOString(),
  browserUrl,
  productUrl,
  release: {
    id: 'set:final-fantasy-tcg:memories-of-life',
    seriesId: 'series:final-fantasy-tcg',
    name: 'Memories of Life',
    releaseNumber: 'Opus 30',
    expectedCardCount: 118,
    rarityScheme: ['C', 'R', 'H', 'L'],
    rarityCounts,
  },
  cards,
};
const outputPath = resolve('public/fftcg-memories-of-life.json');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Wrote ${cards.length} verified Memories of Life standard-card records to ${outputPath}.`);
