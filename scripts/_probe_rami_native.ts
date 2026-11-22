import { HtzClient } from '../src/core/api';

(async () => {
  const c = new HtzClient('', '');
  for (const type of [1, 4, 3]) {
    try {
      const d: any = await c.appItem({ itemId: 102507, itemType: type });
      console.log('\n=== itemType', type, '=== keys', d && Object.keys(d).slice(0, 40));
      for (const k of ['title', 'priceArr', 'items_collected', 'collectedIds', 'extra_features', 'extra_item_features', 'do_not_show_cart_button', 'show_lead', 'product_type', 'type_id', 'stock_empty', 'max_purchase']) {
        console.log(k, '=>', JSON.stringify(d?.[k])?.slice(0, 1200));
      }
    } catch (e: any) {
      console.log('itemType', type, 'ERR', e?.message ?? e);
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
