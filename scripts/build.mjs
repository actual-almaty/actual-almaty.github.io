// Обновление сайта ACTUAL: товары и фото из Paloma365 → index.html
import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.PALOMA_API_KEY || '';
const MCP = process.env.PALOMA_MCP_TOKEN || '';
if (!KEY) { console.error('Нет секрета PALOMA_API_KEY'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const AUTHS = [k => ({ Authorization: 'Bearer ' + k }), k => ({ 'X-API-Key': k }), k => ({ Authorization: k })];
let authIx = -1;

async function getItemsPage(cursor) {
  const u = new URL('https://connect.paloma365.com/platform/v1/items');
  u.searchParams.set('limit', '200');
  if (cursor) u.searchParams.set('cursor', cursor);
  const tries = authIx >= 0 ? [authIx] : AUTHS.map((_, i) => i);
  let last = '';
  for (const i of tries) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(u, { headers: { Accept: 'application/json', ...AUTHS[i](KEY) } });
      if (r.ok) { authIx = i; return r.json(); }
      last = r.status + ' ' + (await r.text()).slice(0, 200);
      if (r.status === 401 || r.status === 403) break;
      await sleep(2000 * (attempt + 1));
    }
  }
  throw new Error('Paloma items: ' + last);
}

async function loadItems() {
  const pages = [];
  let cursor = '';
  for (let n = 0; n < 200; n++) {
    const p = await getItemsPage(cursor);
    pages.push({ json: p });
    cursor = p.next_cursor;
    if (!cursor) break;
    await sleep(200);
  }
  const count = pages.reduce((s, p) => s + (p.json.data || []).length, 0);
  console.log('Товаров из Paloma:', count, 'страниц:', pages.length);
  if (count < 100) throw new Error('Слишком мало товаров из Paloma — сайт не трогаем');
  return pages;
}

async function loadStock() {
  if (!MCP) { console.log('Нет PALOMA_MCP_TOKEN — остатки не загружаем'); return null; }
  const rows = [];
  for (let offset = 0; offset < 20000; offset += 500) {
    const body = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'report_stock_remainder', arguments: { warehouse_id: 1, limit: 500, offset, only_nonzero: true } } };
    const r = await fetch('https://mcp.paloma365.com/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + MCP, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const t = await r.text();
    if (!r.ok) throw new Error('Paloma остатки: ' + r.status + ' ' + t.slice(0, 200));
    let j;
    try { j = JSON.parse(t); } catch (e) { const line = t.split('\n').find(l => l.startsWith('data:')); j = JSON.parse(line.slice(5)); }
    const sc = j?.result?.structuredContent;
    if (!sc || !Array.isArray(sc.rows)) throw new Error('Paloma остатки: неожиданный ответ ' + t.slice(0, 200));
    for (const x of sc.rows) rows.push({ json: { item_id: String(x.item_id), quantity: Number(x.quantity ?? 0) } });
    if (sc.has_more === false) break;
    await sleep(500);
  }
  console.log('Строк остатков:', rows.length);
  if (rows.length < 20) throw new Error('Слишком мало остатков — похоже на ошибку');
  return rows;
}

// Фото, загруженные через форму сайта: img/<артикул>/<цвет>-<время>-<n>.jpg
function loadSitePhotos() {
  const out = [];
  if (!fs.existsSync('img')) return out;
  for (const code of fs.readdirSync('img')) {
    const dir = path.join('img', code);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/^(.*)-([0-9a-z]{6,})-(\d+)\.(jpe?g|png|webp)$/i);
      if (!m) continue;
      const color = m[1] === 'all' ? '' : m[1];
      const t = String(parseInt(m[2], 36)).padStart(16, '0') + String(m[3]).padStart(3, '0');
      out.push({ json: { code, color, url: 'https://actual-almaty.github.io/img/' + encodeURIComponent(code) + '/' + encodeURIComponent(f), created_at: t } });
    }
  }
  return out;
}

const pages = await loadItems();
let stock = null;
try { stock = await loadStock(); } catch (e) { console.error('Остатки не загрузились:', e.message); }
const photos = loadSitePhotos();

const nodes = { 'Загрузить товары Paloma365': pages, 'Остатки из таблицы': stock || [], 'Фото сайта': photos };
const $ = n => ({ all: () => nodes[n], first: () => nodes[n][0] });
const catalog = new Function('$', fs.readFileSync('scripts/catalog.js', 'utf8'));
let rows = catalog($).map(o => o.json);

// Если остатки не загрузились — берём их из прошлой версии сайта, чтобы не показать всё как «нет в наличии»
if (!stock) {
  const prevQty = {};
  try {
    const prev = fs.readFileSync('index.html', 'utf8').match(/const DATA = (\[.*?\]);\nconst SHOP_WA/s);
    for (const r of JSON.parse(prev[1])) for (const c of JSON.parse(r.variants).colors) for (const s of c.sizes) prevQty[s.id] = s.qty;
  } catch (e) {}
  rows = rows.map(r => { const v = JSON.parse(r.variants); for (const c of v.colors) for (const s of c.sizes) s.qty = prevQty[s.id] ?? 1; return { ...r, variants: JSON.stringify(v) }; });
}

rows.sort((a, b) => String(a.title).localeCompare(String(b.title), 'ru'));
const data = JSON.stringify(rows.map(r => ({ model_key: r.model_key, title: r.title, category_id: r.category_id, price: r.price, image_url: r.image_url, variants: r.variants }))).replace(/</g, '\\u003c');
const html = fs.readFileSync('scripts/template.html', 'utf8').replace('__DATA__', () => data);
const old = fs.existsSync('index.html') ? fs.readFileSync('index.html', 'utf8') : '';
if (old === html) { console.log('Изменений нет'); } else { fs.writeFileSync('index.html', html); console.log('Сайт обновлён, моделей:', rows.length); }
