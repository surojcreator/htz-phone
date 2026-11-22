/**
 * Live check of the native catalogue layer.
 *
 *   npm run catalog:check
 */
import { HtzClient } from '../src/core/api';
import { normalizeItem, readDetail, readFeed, readMoreProducts, searchCatalog } from '../src/core/catalog';

const client = new HtzClient('', '');

let fail = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' :: ' + JSON.stringify(detail)}`);
  if (!cond) fail++;
};

(async () => {
  console.log('— feed —');
  const sections = await readFeed(client, 0);
  check('sections > 0', sections.length > 0, sections.length);
  const items = sections.flatMap((s) => s.items);
  check('items > 0', items.length > 0, items.length);
  const withTitle = items.filter((i) => i.title && i.id > 0);
  check('every item has id + title', withTitle.length === items.length, items.length - withTitle.length);
  const withImage = items.filter((i) => i.image.startsWith('http'));
  check('every item has an image', withImage.length === items.length, items.length - withImage.length);
  console.log('  sample:', JSON.stringify(items[0]).slice(0, 220));

  console.log('— search —');
  const found = await searchCatalog(client, 'פיניש');
  check('search results > 0', found.length > 0, found.length);
  check('search item has price', found[0]?.price > 0, found[0]?.price);

  const full = await searchCatalog(client, 'iphone');
  check('full search returns the whole page (> 8)', full.length > 8, full.length);

  console.log('— product —');
  const d = await readDetail(client, found[0]);
  check('detail id', d.id === found[0].id, d.id);
  check('detail title', !!d.title, d.title);
  check('detail price > 0', d.price > 0, d.price);
  check('detail description', d.description.length > 0, d.description.length);
  check('detail images', d.images.length > 0, d.images.length);
  console.log(
    '  detail:',
    JSON.stringify({ title: d.title, price: d.price, full: d.fullPrice, images: d.images.length, desc: d.description.length, stock: d.stock }),
  );

  console.log('— native models —');
  const phone = normalizeItem({ id: 165860, title: 'iPhone', type_id: 1 });
  const pd = await readDetail(client, phone);
  check('model count', pd.variants.length === 4, pd.variants.length);
  check('model label', !!pd.variants[0]?.label, pd.variants[0]?.label);
  check('model id', pd.variants[0]?.id > 0, pd.variants[0]?.id);
  console.log('  models:', JSON.stringify(pd.variants.slice(0, 2)));

  console.log('— similar —');
  const more = await readMoreProducts(client, d);
  check('similar > 0', more.length > 0, more.length);

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
