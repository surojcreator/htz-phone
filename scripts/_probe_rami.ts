import { HtzClient } from '../src/core/api';
import { readProductWebview } from '../src/core/wallet';

(async () => {
  const c = new HtzClient('', '');
  const res: any = await (c as any).appRequest('searchQuery', { q: 'רמי לוי', isPage: 1 });
  const items = res?.res || [];
  console.log('results', items.length);
  for (const x of items.slice(0, 15)) {
    console.log(x.id, x.title, 'type', x.type_id, 'product_type', x.product_type);
  }

  const target = items.find((x: any) => /התו|מלא|רמי/.test(String(x.title))) || items[0];
  if (!target) return;
  console.log('\nTARGET', target.id, target.title);
  const html = await c.webGet(`/webview/${target.id}`);
  console.log('bytes', html.length);
  for (const key of ['"priceOptions":', '"collectedOptions":', '"choiceGroups":', '"addonGroups":', '"colors":', '"voucherChooser":', '"product_type"', '"do_not_show_cart_button"', '"show_lead"']) {
    const i = html.indexOf(key);
    console.log('\n', key, i);
    if (i >= 0) console.log(html.slice(Math.max(0, i - 150), i + 700).replace(/\s+/g, ' ').slice(0, 850));
  }
  const ref = await readProductWebview(c, String(target.id));
  console.log('\nparsed variants', ref.variants);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
