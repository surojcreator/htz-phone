const base = 'https://www.htzone.co.il';
const UA = { 'user-agent': 'Mozilla/5.0 Chrome/131' };
const get = async (p) => {
  const r = await fetch(base + p, { headers: UA });
  const t = await r.text();
  const links = [...new Set([...t.matchAll(/wallet_attraction_item\/(\d+)/g)].map((m) => m[1]))];
  const prices = [...t.matchAll(/"price":"?(\d+)/g)].slice(0, 10).map((m) => m[1]);
  console.log('\n###', p, r.status, t.length, 'links', links.slice(0, 30), 'prices', prices);
  console.log('title', (t.match(/<title[^>]*>([^<]{0,80})/) || [])[1]);
  return t;
};
(async () => {
  await get('/wallet_attractions_sale/156');
  await get('/wallet_attractions_sale/44');
  await get('/wallet_attraction_item/166122?proj_id=156');
  await get('/wallet_attraction_item/167284?proj_id=44');
  await get('/wallet_attraction_item/167284');
})();
