// Обновление сайта ACTUAL: товары, фото и остатки из Paloma365 → index.html 
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const clean = v => String(v || '').trim().replace(/^Bearer\s+/i, '').replace(/^["']|["']$/g, '');
const RAW_KEY = clean(process.env.PALOMA_API_KEY), RAW_MCP = clean(process.env.PALOMA_MCP_TOKEN);
const kind = v => !v ? 'пусто' : ((/^pp[a-z]{2}_/.test(v) ? v.slice(0, 5) : 'другой формат') + ', ' + v.length + ' символов');
console.log('PALOMA_API_KEY:', kind(RAW_KEY), '| PALOMA_MCP_TOKEN:', kind(RAW_MCP));
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Пробуем оба ключа для каталога товаров
const CANDIDATES = [...new Set([RAW_KEY, RAW_MCP].filter(Boolean))];
let KEY = '';
const AUTHS = [k => ({ Authorization: 'Bearer ' + k })];
let authIx = -1;

async function getItemsPage(cursor) {
  const u = new URL('https://connect.paloma365.com/platform/v1/items');
  u.searchParams.set('limit', '200');
  if (cursor) u.searchParams.set('cursor', cursor);
  const tries = KEY ? [KEY] : CANDIDATES;
  let last = '';
  for (const k of tries) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(u, { headers: { Accept: 'application/json', Authorization: 'Bearer ' + k } });
      if (r.ok) { if (!KEY) console.log('Каталог открылся ключом', kind(k)); KEY = k; return r.json(); }
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
  // для остатков подходит тот ключ, который не открыл каталог
  const order = [...new Set([...CANDIDATES.filter(k => k !== KEY), KEY].filter(Boolean))];
  let MCP = '', last = '';
  for (const k of order) {
    const r = await fetch('https://mcp.paloma365.com/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + k, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    if (r.ok) { MCP = k; console.log('Остатки открылись ключом', kind(k)); break; }
    last = r.status + ' ' + (await r.text()).slice(0, 150);
  }
  if (!MCP) throw new Error('Ни один ключ не подошёл для остатков: ' + last);
  const call = async (name, args) => {
    const r = await fetch('https://mcp.paloma365.com/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + MCP, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }) });
    const t = await r.text();
    if (!r.ok) throw new Error('Paloma ' + name + ': ' + r.status + ' ' + t.slice(0, 200));
    let j;
    try { j = JSON.parse(t); } catch (e) { const line = t.split('\n').find(l => l.startsWith('data:')); j = JSON.parse(line.slice(5)); }
    const sc = j?.result?.structuredContent;
    if (!sc) throw new Error('Paloma ' + name + ': неожиданный ответ ' + t.slice(0, 200));
    return sc;
  };
  const stockOn = async (date) => {
    const q = {};
    let n = 0;
    for (let offset = 0; offset < 20000; offset += 500) {
      const sc = await call('report_stock_remainder', { warehouse_id: 1, limit: 500, offset, only_nonzero: true, on_date: date });
      if (!Array.isArray(sc.rows)) throw new Error('Paloma остатки: нет строк');
      for (const x of sc.rows) { q[String(x.item_id)] = (q[String(x.item_id)] || 0) + Number(x.quantity ?? 0); n++; }
      if (sc.has_more === false) break;
      await sleep(500);
    }
    if (n < 20) throw new Error('Слишком мало остатков — похоже на ошибку');
    return q;
  };
  // Палома списывает проданное со склада только при закрытии смены.
  // Поэтому вычитаем сегодняшние закрытые чеки, которые ещё не списались со склада.
  const ymd = d => new Date(d.getTime() + 5 * 3600e3).toISOString().slice(0, 10);
  const today = ymd(new Date()), tomorrow = ymd(new Date(Date.now() + 864e5));
  const cur = await stockOn(tomorrow);
  let start = cur, sold = {};
  try {
    start = await stockOn(today);
    const sc = await call('report_sales', { date_from: today, date_to: today, top: 200 });
    if (sc.success === false) throw new Error(sc.message || 'нет продаж');
    for (const x of (sc.rows || [])) sold[String(x.group_id)] = Number(x.quantity || 0);
  } catch (e) { console.error('Сегодняшние продажи не учтены:', e.message); sold = {}; }
  let adj = 0;
  const ids = new Set([...Object.keys(cur), ...Object.keys(sold)]);
  const rows = [];
  for (const id of ids) {
    const c = cur[id] || 0, s = sold[id] || 0;
    const postedOut = Math.max(0, (start[id] || 0) - c);
    const unposted = Math.max(0, s - postedOut);
    const q = Math.max(0, c - unposted);
    if (q !== c) adj++;
    if (q > 0 || c > 0) rows.push({ json: { item_id: id, quantity: q } });
  }
  console.log('Строк остатков:', rows.length, '| продано сегодня позиций:', Object.keys(sold).length, '| поправлено с учётом чеков:', adj);
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
      const m = f.match(/^(.*)-([0-9a-z]{6,})-(\d+)\.(jpe?g|png|webp|mp4)$/i);
      if (!m) continue;
      const color = m[1] === 'all' ? '' : m[1];
      const t = String(parseInt(m[2], 36)).padStart(16, '0') + String(m[3]).padStart(3, '0');
      out.push({ json: { code, color, url: 'https://actual-almaty.github.io/img/' + encodeURIComponent(code) + '/' + encodeURIComponent(f), created_at: t, video: /\.mp4$/i.test(f) } });
    }
  }
  return out;
}


// Остатки для кабинета сотрудников: шифруются публичным ключом, открыть могут только сотрудники
function writeTeamStock(pages, stock) {
  const pubPath = 'team/d/stock-pub.txt';
  if (!stock || !fs.existsSync(pubPath)) return;
  const qty = {};
  for (const s of stock) qty[s.json.item_id] = (qty[s.json.item_id] || 0) + Number(s.json.quantity || 0);
  const rows = []; const seen = new Set();
  for (const p of pages) for (const r of (p.json.data || [])) {
    if (!r || r.deleted === true || !r.name) continue;
    const id = String(r.id); if (seen.has(id)) continue; seen.add(id);
    rows.push([id, String(r.name).replace(/\\+/g, '/').replace(/\s+/g, ' ').trim(), qty[id] || 0, Math.round(Number(r.price) || 0), (Array.isArray(r.barcodes) ? r.barcodes : []).join(' ')]);
  }
  const json = JSON.stringify(rows);
  const hash = crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
  let old = {}; try { old = JSON.parse(fs.readFileSync('team/d/stock-meta.json', 'utf8')); } catch (e) {}
  if (old.hash === hash) { console.log('Остатки сотрудников без изменений'); return; }
  const version = new Date().toISOString();
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const key = crypto.createHash('sha256').update(ecdh.computeSecret(Buffer.from(fs.readFileSync(pubPath, 'utf8').trim(), 'base64'))).digest();
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(json, 'utf8'), c.final(), c.getAuthTag()]);
  fs.writeFileSync('team/d/stock.json', JSON.stringify({ version, synced: version, epk: ecdh.getPublicKey().toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') }));
  fs.writeFileSync('team/d/stock-meta.json', JSON.stringify({ version, hash, count: rows.length }));
  console.log('Остатки сотрудников обновлены:', rows.length);
}

const pages = await loadItems();
let stock = null;
try { stock = await loadStock(); } catch (e) { console.error('Остатки не загрузились:', e.message); }
const photos = loadSitePhotos();
try { writeTeamStock(pages, stock); } catch (e) { console.error('Остатки сотрудников не записались:', e.message); }

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

// Предпросмотр нового дизайна: /new/ (тот же каталог, другой шаблон)
if (fs.existsSync('scripts/template-new.html')) {
  fs.mkdirSync('new', { recursive: true });
  const nh = fs.readFileSync('scripts/template-new.html', 'utf8').replace('__DATA__', () => data);
  if (!fs.existsSync('new/index.html') || fs.readFileSync('new/index.html', 'utf8') !== nh) fs.writeFileSync('new/index.html', nh);
}
if (old === html) { console.log('Изменений нет'); } else { fs.writeFileSync('index.html', html); console.log('Сайт обновлён, моделей:', rows.length); }
// 2026-11-06T12:00:31Z
