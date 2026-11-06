const k = String(process.env.PALOMA_MCP_TOKEN || '').trim();
const base = 'https://connect.paloma365.com/platform/v1/';
for (const p of ['', 'stock', 'stocks', 'stock-balances', 'stock_balances', 'balances', 'inventory', 'remains', 'leftovers', 'warehouses', 'stores', 'items/stock', 'reports/stock', 'stock/levels', 'stock-levels']) {
  try {
    const r = await fetch(base + p + (p ? '?limit=2' : ''), { headers: { Authorization: 'Bearer ' + k, Accept: 'application/json' } });
    const t = (await r.text()).replace(/\s+/g, ' ');
    console.log(r.status, '/' + p, t.slice(0, 300));
  } catch (e) { console.log('ERR', p, e.message); }
}
