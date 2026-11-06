const SIZES = new Set(['XS','S','M','L','XL','XXL','2XL','3XL','XXXL','4XL','5XL']);
const lat = s => s.replace(/М/g,'M').replace(/Т/g,'T').replace(/С/g,'C').replace(/Х/g,'X').replace(/Е/g,'E').replace(/А/g,'A').replace(/К/g,'K').replace(/Р/g,'P').replace(/О/g,'O').replace(/Н/g,'H').replace(/В/g,'B');
const stock = {};
for (const s of $('Остатки из таблицы').all()) { if (s.json.item_id) stock[String(s.json.item_id)] = Number(s.json.quantity || 0); }
const extra = {};
for (const p of $('Фото сайта').all()) { const j = p.json || {}; if (!j.code || !j.url) continue; const k = String(j.code).toUpperCase().trim(); (extra[k] = extra[k] || []).push({ color: String(j.color || '').toLowerCase().trim(), url: String(j.url), t: String(j.created_at || '') }); }
for (const k in extra) extra[k].sort((a, b) => a.t.localeCompare(b.t));
const TYPE_MAP = { 'Кардиганы': 'Кардиган', 'Классическая': 'Костюм', 'Классический': 'Костюм', 'Костюмы': 'Костюм', 'Куртки': 'Куртка', 'Джинсы': 'Джинсы', 'Полу': 'Полузамок', 'Полу-замок': 'Полузамок', 'Полузамок': 'Полузамок' };
const COLOR_RU = { 'dark-blue': 'Тёмно-синий', 'dark-blue navy': 'Тёмно-синий', 'navy': 'Тёмно-синий', 'темно-синий': 'Тёмно-синий', 'тёмно-синий': 'Тёмно-синий', 'black': 'Чёрный', 'черный': 'Чёрный', 'чёрный': 'Чёрный', 'grey': 'Серый', 'gray': 'Серый', 'серый': 'Серый', 'dark grey': 'Тёмно-серый', 'dark gray': 'Тёмно-серый', 'темно-серый': 'Тёмно-серый', 'coffee': 'Кофейный', 'кофе': 'Кофейный', 'red coffee': 'Красно-коричневый', 'brown': 'Коричневый', 'коричневый': 'Коричневый', 'khaki': 'Хаки', 'burgundy': 'Бордовый', 'maroon': 'Бордовый', 'бордовый': 'Бордовый', 'flower grey': 'Серый меланж', 'flower khaki gray': 'Хаки меланж', 'grey-blue': 'Серо-голубой', 'dark purple': 'Тёмно-фиолетовый', 'white': 'Белый', 'белый': 'Белый', 'beige': 'Бежевый', 'бежевый': 'Бежевый', 'orange': 'Оранжевый', 'оранжевый': 'Оранжевый' };
const TITLE_FIX = new Set(['Кардиганы', 'Полу', 'Полу-замок', 'Куртки', 'Костюмы']);
const PANTS = new Set(['Джинсы', 'Трико', 'Слаксы', 'Брюки', 'Штаны']);
const models = {};
for (const page of $('Загрузить товары Paloma365').all()) {
  const rows = Array.isArray(page.json.data) ? page.json.data : [];
  for (const r of rows) {
    if (r.deleted === true || !r.name) continue;
    const name = String(r.name).replace(/\\+/g, '/').replace(/\s+/g, ' ').trim();
    let tok = name.split(' ');
    if (/^[а-яё]/.test(tok[0])) tok[0] = tok[0][0].toUpperCase() + tok[0].slice(1);
    let size = '';
    { const last = tok[tok.length - 1].toUpperCase();
      if (tok.length > 2 && SIZES.has(last)) { size = last; tok = tok.slice(0, -1); }
      else if (tok.length > 2 && /^\d{2}$/.test(last) && +last >= 26 && +last <= 50 && !tok.slice(2, -1).some(t => SIZES.has(t.toUpperCase()))) { size = last; tok = tok.slice(0, -1); } }
    let ci = tok.findIndex(t => /^[A-Za-zА-Яа-я]{1,6}\d{0,4}-\d{2,}[A-Za-z0-9-]*$/.test(t));
    if (ci < 0) ci = tok.findIndex((t, i) => i > 0 && /^[A-Za-z]{1,6}\d{2,6}-\d[A-Za-z0-9-]*$/.test(t));
    if (ci < 0) ci = tok.findIndex((t, i) => i > 0 && /^[A-Za-z]{1,4}\d{3,6}$/.test(t));
    let numCode = false;
    if (ci < 0) { ci = tok.findIndex((t, i) => i > 0 && /^\d{4,6}$/.test(t)); numCode = ci >= 0; }
    let code = '', title = tok.join(' '), rest = [];
    if (ci >= 0) { code = lat(tok[ci].toUpperCase()); title = tok.slice(0, ci).join(' ') + ' ' + code; rest = tok.slice(ci + 1); }
    if (!size) rest = rest.filter(t => { const u = t.toUpperCase(); if (!size && SIZES.has(u)) { size = u; return false; } return true; });
    if (!size) { const nums = rest.filter(t => /^\d{2}$/.test(t) && +t >= 26 && +t <= 50); if (nums.length) { size = nums[nums.length - 1]; const ix = rest.lastIndexOf(size); rest = rest.filter((t, i) => i !== ix); } }
    const waist = (rest.find(t => /^\d{2}(-\d{2})?$/.test(t)) || '');
    const rawColor = rest.filter(t => t !== '/' && t !== '-' && !/^\d{1,3}(-\d{1,3})?$/.test(t)).join(' ').replace(/\s*\/\s*/g, ' / ').replace(/^[-\s/]+|[-\s/]+$/g, '').trim();
    const ck = rawColor.replace(/-\d+$/, '').replace(/\s*\/\s*/g, ' ').toLowerCase().trim();
    const color = COLOR_RU[ck] || rawColor.replace(/-\d+$/, '');
    const key = (numCode ? title : (code || title)).toLowerCase().replace(/[^a-z0-9а-я]+/gi, '-').replace(/^-|-$/g, '');
    const ttl = (TYPE_MAP[tok[0]] && TITLE_FIX.has(tok[0])) ? (TYPE_MAP[tok[0]] + ' ' + title.split(' ').slice(tok[0] === 'Полу' && tok[1] === 'замок' ? 2 : 1).join(' ')) : title;
    const m = models[key] || (models[key] = { key, title: ttl.trim(), code, type: TYPE_MAP[tok[0]] || tok[0], desc: '', colors: {}, hasImg: false, prices: [], waist: {} });
    if (m.title === m.code && ttl.trim() !== code && ci > 0) { m.title = ttl.trim(); m.type = TYPE_MAP[tok[0]] || tok[0]; }
    if (waist && size) m.waist[size] = waist;
    if (r.description && !m.desc) m.desc = String(r.description).slice(0, 800);
    const c = m.colors[color] || (m.colors[color] = { name: color, images: [], sizes: [], alias: [] });
    if (rawColor && !c.alias.includes(rawColor.toLowerCase())) c.alias.push(rawColor.toLowerCase());
    const pics = (Array.isArray(r.image_urls) && r.image_urls.length ? r.image_urls : [r.image_url]).filter(Boolean);
    if (pics.length) { m.hasImg = true; for (const u of pics) if (!c.images.includes(u)) c.images.push(u); }
    const price = Number(r.price || 0);
    if (price > 0) m.prices.push(price);
    c.sizes.push({ s: size || 'ONE', id: String(r.id), qty: stock[String(r.id)] || 0, price });
  }
}
const ORDER = ['XS','S','M','L','XL','XXL','2XL','3XL','XXXL','4XL','5XL','ONE'];
const rank = z => { const i = ORDER.indexOf(z); return i >= 0 ? i : (/^\d+$/.test(z) ? 100 + Number(z) : 500); };
const now = new Date().toISOString();
const out = [];
for (const m of Object.values(models)) {
  const ex = extra[String(m.code || '').toUpperCase()] || [];
  if ((!m.hasImg && !ex.length) || !m.prices.length) continue;
  let colors = Object.values(m.colors);
  const fallback = colors.flatMap(c => c.images);
  const isLetter = z => z !== 'ONE' && ORDER.includes(z);
  const keep = colors.some(c => c.sizes.some(s => isLetter(s.s))) ? (z => isLetter(z)) : colors.some(c => c.sizes.some(s => s.s !== 'ONE')) ? (z => z !== 'ONE') : (() => true);
  colors = colors.map(c => ({ ...c, sizes: c.sizes.filter(s => keep(s.s)) })).filter(c => c.sizes.length);
  if (!colors.length) continue;
  if (colors.length > 1) colors = colors.filter(c => c.name) .length ? colors.filter(c => c.name) : colors;
  if (ex.length) for (const c of colors) { const names = [c.name.toLowerCase(), ...(c.alias || [])].filter(Boolean); const mine = ex.filter(e => !e.color || names.some(n => n.includes(e.color) || e.color.includes(n)) || (COLOR_RU[e.color] && COLOR_RU[e.color] === c.name)).map(e => e.url); if (mine.length) c.images = [...new Set([...mine, ...c.images])]; }
  for (const c of colors) {
    if (!c.images.length) c.images = fallback.slice(0, 1);
    const seen = new Set();
    c.sizes = c.sizes.slice().sort((a, b) => b.qty - a.qty).filter(s => !seen.has(s.s) && seen.add(s.s)).sort((a, b) => rank(a.s) - rank(b.s));
  }
  colors.sort((a, b) => b.sizes.reduce((n, s) => n + s.qty, 0) - a.sizes.reduce((n, s) => n + s.qty, 0));
  const wl = ORDER.filter(z => m.waist[z]).map(z => `${z} — ${m.waist[z]}`);
  if (PANTS.has(m.type) && wl.length > 1 && new Set(Object.values(m.waist)).size > 1 && !m.desc) m.desc = 'Размеры по талии: ' + wl.join(', ');
  out.push({ json: {
    model_key: m.key, title: m.title, category_id: m.type, price: Math.min(...m.prices),
    image_url: colors[0].images[0] || '', synced_at: now,
    variants: JSON.stringify({ code: m.code, desc: m.desc, colors: colors.map(({ alias, ...c }) => c) })
  }});
}
if (!out.length) throw new Error('Не нашлось ни одного товара с фото — каталог не трогаем');
return out;
