import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const browserUrl = 'https://www.unionarena-tcg.com/na/cardlist/?search=true';
const searchUrl = 'https://www.unionarena-tcg.com/na/cardlist/index.php?search=true';
const expectedProducts = [
  ['591001', 'BLEACH: Thousand-Year Blood War [UE01ST]'],
  ['591601', 'UNION ARENA STARTER DECK BLEACH: Thousand-Year Blood War [UE01ST PRE]'],
  ['591101', 'BLEACH: Thousand-Year Blood War [UE01BT]'],
  ['591201', 'BLEACH: Thousand-Year Blood War Vol.2 [UEX01BT]'],
  ['591701', 'NEW CARD SELECTION BLEACH: Thousand-Year Blood War'],
  ['591401', 'BLEACH: Thousand-Year Blood War [UE01DC]'],
  ['591208', 'BLEACH: Thousand-Year Blood War Vol.3 [UEX08BT]'],
  ['591002', 'HUNTER X HUNTER [UE02ST]'],
  ['591602', 'UNION ARENA STARTER DECK HUNTER X HUNTER [UE02ST PRE]'],
  ['591102', 'HUNTER X HUNTER [UE02BT]'],
  ['591204', 'HUNTER X HUNTER Vol.2 [UEX04BT]'],
  ['591003', 'JUJUTSU KAISEN [UE03ST]'],
  ['591103', 'JUJUTSU KAISEN [UE03BT]'],
  ['591202', 'JUJUTSU KAISEN Vol.2 [UEX02BT]'],
  ['591104', 'CODE GEASS Lelouch of the Rebellion [UE04BT]'],
  ['591203', 'CODE GEASS Lelouch of the Rebellion Vol.2 [UEX03BT]'],
  ['591005', 'Demon Slayer: Kimetsu no Yaiba [UE05ST]'],
  ['591105', 'Demon Slayer: Kimetsu no Yaiba [UE05BT]'],
  ['591205', 'Demon Slayer: Kimetsu no Yaiba Vol.2 [UEX05BT]'],
  ['591006', 'ONE PUNCH MAN [UE06ST]'],
  ['591106', 'ONE PUNCH MAN [UE06BT]'],
  ['591007', 'Sword Art Online [UE07ST]'],
  ['591107', 'Sword Art Online [UE07BT]'],
  ['591206', 'Sword Art Online Vol.2 [UEX06BT]'],
  ['591008', 'Black Clover [UE08ST]'],
  ['591108', 'Black Clover [UE08BT]'],
  ['591009', 'FULLMETAL ALCHEMIST [UE09ST]'],
  ['591109', 'FULLMETAL ALCHEMIST [UE09BT]'],
  ['591010', 'Attack on Titan [UE10ST]'],
  ['591110', 'Attack on Titan [UE10BT]'],
  ['591011', 'Rurouni Kenshin [UE11ST]'],
  ['591111', 'Rurouni Kenshin [UE11BT]'],
  ['591112', 'Kaiju No. 8 [UE12BT]'],
  ['591113', 'Yu Yu Hakusho: Ghost Files [UE13BT]'],
  ['591114', 'GODDESS OF VICTORY: NIKKE [UE14BT]'],
  ['591301', 'GODDESS OF VICTORY: NIKKE [UP01BT]'],
  ['591015', 'Evangelion: New Theatrical Edition [UE15ST]'],
  ['591115', 'Evangelion: New Theatrical Edition [UE15BT]'],
  ['591116', 'KAGURABACHI [UE16BT]'],
  ['591117', 'SOLO LEVELING [UE17BT]'],
  ['591018', 'Tokyo Ghoul [UE18ST]'],
  ['591118', 'Tokyo Ghoul series [UE18BT]'],
  ['591119', 'SAKAMOTO DAYS [UE19BT]'],
  ['591120', 'That Time I Got Reincarnated as a Slime [UE20BT]'],
  ['591121', 'The 100 Girlfriends Who Really, Really, Really, Really, REALLY Love You [UE21BT]'],
  ['591122', 'CHAINSAW MAN [UE22BT]'],
  ['591123', 'INUYASHA [UE23BT]'],
  ['591024', 'Re:ZERO -Starting Life in Another World- [UE24ST]'],
  ['591124', 'Re:ZERO -Starting Life in Another World- [UE24BT]'],
  ['591207', 'Attack on Titan Vol.2 [UEX07BT]'],
  ['591901', 'Promotion card'],
  ['591902', 'Release Event'],
];

function decodeEntities(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|#39|lt|gt);/gi, (match, entity) => {
    const key = entity.toLowerCase();
    if (key === 'amp') return '&';
    if (key === 'quot') return '"';
    if (key === 'apos' || key === '#39') return "'";
    if (key === 'lt') return '<';
    if (key === 'gt') return '>';
    const code = key.startsWith('#x') ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10);
    try { return String.fromCodePoint(code); } catch { return match; }
  });
}

function slugify(value) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function sourceImageUrl(path) {
  const url = new URL(decodeEntities(path), 'https://www.unionarena-tcg.com');
  if (url.protocol !== 'https:' || url.hostname !== 'www.unionarena-tcg.com'
    || !url.pathname.startsWith('/na/images/cardlist/card/') || !url.pathname.endsWith('.png')) {
    throw new Error(`Unexpected official card image URL: ${url.href}`);
  }
  return url.href;
}

function parseProducts(html) {
  const select = html.match(/<select name="series"[\s\S]*?<\/select>/)?.[0];
  if (!select) throw new Error('Could not read Bandai’s English product filter. No catalog was written.');
  return [...select.matchAll(/<option value="([^"]+)">([\s\S]*?)<\/option>/g)]
    .map((match) => ({ id: match[1], name: decodeEntities(match[2].replace(/<[^>]*>/g, '').trim()) }))
    .filter((product) => product.id);
}

function parseCards(html, product) {
  const blocks = [...html.matchAll(/<li class="cardImgCol">([\s\S]*?)<\/li>/g)].map((match) => match[1]);
  const cards = new Map();
  for (const block of blocks) {
    const numberMatch = block.match(/detail_iframe\.php\?card_no=([^"&]+)/);
    const imageMatch = block.match(/data-src="([^"]+)"[^>]*alt="([^"]*)"/);
    if (!numberMatch || !imageMatch) throw new Error(`${product.name} has a card row with missing number or image data.`);
    const listedNumber = decodeEntities(decodeURIComponent(numberMatch[1]));
    const parallelMatch = listedNumber.match(/_(p\d+)$/i);
    const number = parallelMatch ? listedNumber.slice(0, -parallelMatch[0].length) : listedNumber;
    const alt = decodeEntities(imageMatch[2]);
    if (!alt.startsWith(`${number} `)) throw new Error(`${product.name} has a card row whose English number does not match its link.`);
    const name = alt.slice(number.length).trim();
    const imageUrl = sourceImageUrl(imageMatch[1]);
    const record = cards.get(number) ?? { number, name, imageUrl: '', parallels: [] };
    if (record.name && name && record.name !== name) throw new Error(`${product.name} lists ${number} with conflicting English names.`);
    if (!record.name && name) record.name = name;
    if (parallelMatch) {
      const parallel = parallelMatch[1].toLowerCase();
      if (record.parallels.some((item) => item.id === parallel)) throw new Error(`${product.name} repeats ${number} parallel ${parallel}.`);
      record.parallels.push({ id: parallel, imageUrl });
    } else {
      if (record.imageUrl) throw new Error(`${product.name} repeats the base print for ${number}.`);
      record.imageUrl = imageUrl;
    }
    cards.set(number, record);
  }
  const basePrintCount = [...cards.values()].filter((card) => card.imageUrl).length;
  const parallelCount = [...cards.values()].reduce((sum, card) => sum + card.parallels.length, 0);
  if (blocks.length !== basePrintCount + parallelCount) {
    throw new Error(`${product.name} card rows could not be reconciled. No catalog was written.`);
  }
  for (const card of cards.values()) {
    if (!card.imageUrl) {
      card.parallelOnly = true;
      card.imageUrl = card.parallels[0]?.imageUrl;
      card.sourceNote = 'The official English product list provides parallel artwork only for this card number.';
    } else card.parallelOnly = false;
    if (!card.name) {
      card.name = card.number;
      card.sourceNote = 'The official English product list did not provide a card name.';
    }
    card.parallels.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  }
  return { cards: [...cards.values()].sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true })), basePrintCount, parallelCount, sourceRowCount: blocks.length };
}

async function mapWithConcurrency(items, limit, callback) {
  const output = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const index = next++;
      output[index] = await callback(items[index]);
    }
  }));
  return output;
}

const page = await fetch(browserUrl);
if (!page.ok) throw new Error(`Bandai’s English card browser returned HTTP ${page.status}.`);
const products = parseProducts(await page.text());
if (JSON.stringify(products.map(({ id, name }) => [id, name])) !== JSON.stringify(expectedProducts)) {
  throw new Error('Bandai’s English product filter changed. Review the new or removed products before importing. No file was written.');
}

const results = await mapWithConcurrency(expectedProducts, 3, async ([id, name]) => {
  const response = await fetch(searchUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams({ series: id }),
  });
  if (!response.ok) throw new Error(`Bandai’s card browser returned HTTP ${response.status} for ${name}.`);
  const result = parseCards(await response.text(), { id, name });
  const cards = result.cards;
  if (!cards.length) throw new Error(`${name} returned no cards. No catalog was written.`);
  const setId = `set:union-arena-na:${id}`;
  return {
    set: { id: setId, productId: id, seriesId: 'series:union-arena-tcg', name, cardCount: cards.length, basePrintCount: result.basePrintCount, parallelCount: result.parallelCount, sourceRowCount: result.sourceRowCount, trackedByDefault: false },
    cards: cards.map((card) => ({ setId, ...card })),
  };
});

const sets = results.map((result) => result.set);
const cards = results.flatMap((result) => result.cards);
const sourceCardCount = sets.reduce((sum, set) => sum + set.sourceRowCount, 0);
const normalized = JSON.stringify({ sets, cards });
const output = {
  schemaVersion: 1,
  source: 'Bandai UNION ARENA English (U.S./Canada) Card Browser',
  cataloguedAt: new Date().toISOString(),
  browserUrl,
  productCount: sets.length,
  sourceCardCount,
  sourceSignature: createHash('sha256').update(normalized).digest('hex'),
  sets,
  cards,
};
const outputPath = resolve('public/union-arena-catalog.json');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Wrote ${sets.length} English product sets, ${cards.length} required card definitions, and ${sourceCardCount - cards.length} alternate-art prints to ${outputPath}. Images remain linked from Bandai’s site; no image files were copied.`);
