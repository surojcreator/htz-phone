/**
 * Cart + wallet self-test.
 *
 * Runs the real `src/core/wallet.ts` code against a scripted `webApi`, so the
 * parsing, version-conflict retry, quantity/remove paths and both payment
 * branches are exercised without touching the live store or spending money.
 *
 *   npx tsx scripts/cart_selftest.ts
 */
import { HtzClient } from '../src/core/api';
import { parseWalletGrants, walletGrantsText } from '../src/core/grants';
import { runWalletGrantLoop } from '../src/core/walletProject';
import {
  addToCart,
  parseProductPage,
  payFromWallet,
  readCart,
  removeCartLine,
  setCartQty,
} from '../src/core/wallet';

type Call = { method: string; path: string; body: any };
type Reply = { status: number; json: any };

class FakeClient {
  calls: Call[] = [];
  replies: Reply[] = [];

  constructor(private email = 'test@example.com', private password = 'x') {}

  push(status: number, json: any) {
    this.replies.push({ status, json });
  }

  async webApi(method: string, path: string, body?: unknown) {
    this.calls.push({ method, path, body });
    const reply = this.replies.shift();
    if (!reply) throw new Error(`unexpected call ${method} ${path}`);
    return reply;
  }

  static apiError = HtzClient.apiError;
}

const fake = (c: FakeClient) => c as unknown as HtzClient;

let pass = 0;
let fail = 0;
const ok = (name: string) => {
  pass++;
  console.log('  PASS', name);
};
const bad = (name: string, detail: unknown) => {
  fail++;
  console.log('  FAIL', name, '\n       ', detail);
};
const eq = (name: string, actual: unknown, expected: unknown) =>
  JSON.stringify(actual) === JSON.stringify(expected)
    ? ok(name)
    : bad(name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

async function testReadCart() {
  console.log('— readCart —');
  const c = new FakeClient();
  c.push(200, {
    data: {
      kind: 'regular',
      version: 7,
      lines: [
        { key: 'K1', itemId: 123, variantId: 456, qty: 2, price: 10, title: 'Widget' },
        { item_key: 'K2', item_id: 124, variant_id: null, quantity: 1, item_price: 5.5, item_title: 'Gadget' },
      ],
      total: 25.5,
      checkout: {
        units: 3,
        addressRequired: true,
        suppliers: [
          {
            supplierId: 9,
            deliveryOptions: [
              { id: 3, label: 'Fast', price: 5, usesAddress: true, needsPoint: false, type: 'courier' },
            ],
          },
        ],
      },
    },
  });

  const sum = await readCart(fake(c), 'regular');
  eq('kind', sum.kind, 'regular');
  eq('version', sum.version, 7);
  eq('line 1 key', sum.lines[0].key, 'K1');
  eq('line 1 variant', sum.lines[0].variantId, 456);
  eq('line 2 snake_case', sum.lines[1], {
    key: 'K2',
    itemId: 124,
    variantId: null,
    qty: 1,
    price: 5.5,
    title: 'Gadget',
  });
  eq('units', sum.units, 3);
  eq('total', sum.total, 25.5);
  eq('addressRequired', sum.addressRequired, true);
  eq('delivery', sum.deliveries[0], {
    supplierId: 9,
    id: 3,
    label: 'Fast',
    price: 5,
    usesAddress: true,
    needsPoint: false,
    type: 'courier',
  });
}

class FakeAddClient {
  calls: any[] = [];
  async appAddToCart(params: any) {
    this.calls.push(params);
  }
}

class FakeFallbackClient {
  addCalls: any[] = [];
  webCalls: any[] = [];
  async appAddToCart(params: any) {
    this.addCalls.push(params);
    throw new Error('לא ניתן לרכוש מוצר זה');
  }
  async ensureWebSession() {}
  async webApi(method: string, path: string, body: any) {
    this.webCalls.push({ method, path, body });
    return { status: 200, json: { data: {} } };
  }
}

async function testNativeAdd() {
  console.log('— addToCart (Android API) —');
  const c = new FakeAddClient();
  const res = await addToCart(c as unknown as HtzClient, {
    kind: 'regular',
    id: 165860,
    qty: 2,
    variantId: 252360,
    itemType: 1,
  });
  eq('ok', res.ok, true);
  eq('endpoint payload', c.calls[0], {
    itemId: 165860,
    itemType: 1,
    isQuick: 0,
    collectedIds: [{ id: 252360, quantity: 2 }],
  });

  const quick = new FakeAddClient();
  await addToCart(quick as unknown as HtzClient, { kind: 'quick', id: 5, qty: 1 });
  eq('quick flag', quick.calls[0].isQuick, 1);
  eq('no collected ids', quick.calls[0].collectedIds, undefined);

  // Items the native API refuses fall back to the website cart.
  const fb = new FakeFallbackClient();
  const wired = await addToCart(fb as unknown as HtzClient, {
    kind: 'regular',
    id: 166122,
    qty: 1,
    variantId: 252788,
  });
  eq('fallback ok', wired.ok, true);
  eq('fallback went to the web cart', fb.webCalls[0]?.path, '/api/cart/items');
  eq('fallback product id', fb.webCalls[0]?.body?.product_id, 166122);

  // The request class rewrites the array into an index-keyed object.
  const real = new HtzClient('', '');
  let sent: any = null;
  (real as any).appAuthedRequest = async (_m: string, payload: any) => {
    sent = payload;
    return {};
  };
  await real.appAddToCart({ itemId: 165860, collectedIds: [{ id: 252360, quantity: 2 }] });
  eq('native collectedIds shape', sent.collectedIds, { '0': { collectedId: 252360, quantity: 2 } });
  eq('native item id', sent.itemId, 165860);
}

async function testVariantParsing() {
  console.log('— product page models —');
  const collected = parseProductPage(
    { kind: 'regular', id: 1 },
    `{"collectedOptions\":[{"id":252360,"label":"צבע שחור","inStock":true,"maxQty":2},{"id":252361,"label":"צבע כסוף","inStock":false}],"priceOptions\":\"$undefined\"}`,
  );
  eq('collected option count', collected.variants.length, 2);
  eq('collected id', collected.variants[0].id, 252360);
  eq('collected label', collected.variants[0].label, 'צבע שחור');
  eq('collected max', collected.variants[0].max, 2);
  eq('collected inStock', collected.variants[1].inStock, false);

  // A missing value must not latch onto an unrelated array further down.
  const noModels = parseProductPage(
    { kind: 'regular', id: 2 },
    `"priceOptions":"$undefined","seo":{"tags":[{"id":9,"title":"not a model"}]}`,
  );
  eq('no phantom models', noModels.variants.length, 0);

  // A PDP-level cap applies to rows that do not carry their own `max`.
  const capped = parseProductPage(
    { kind: 'regular', id: 3 },
    `"maxPurchase":2,"priceOptions":[{"id":77,"desc":"x","price":10,"maxPerOrder":4}]`,
  );
  eq('maxPerOrder wins over maxPurchase', capped.variants[0].max, 4);
}

async function testWalletShape() {
  console.log('— wallet response —');
  const client: any = new HtzClient('', '');

  // Empty wallet, exactly as `getUserWallet` answers it: the rollup is an
  // object, so it must not be counted as a row.
  client.appRequest = async () => ({ total: 0, more: { ObligoList: { ALL: 0 }, ObligoListInfo: [] } });
  const empty = await client.appWallet();
  eq('empty wallet total', empty.total, 0);
  eq('empty wallet rows', empty.obligo.length, 0);
  eq('rollup kept', empty.byKey.ALL, 0);

  client.appRequest = async () => ({
    total: 120,
    more: {
      ObligoList: { ALL: 120 },
      ObligoListInfo: [{ key: '1', title: 'refund', sum: 120 }],
    },
  });
  const funded = await client.appWallet();
  eq('funded total', funded.total, 120);
  eq('funded rows', funded.obligo.length, 1);
  eq('funded row title', funded.obligo[0].title, 'refund');
  eq('funded rollup', funded.byKey.ALL, 120);
}

async function testWalletGrants() {
  console.log('— wallet grants (הטבות) —');

  // The page carries the header summary first and the rows later; only the
  // second object has the lists.
  const page = [
    '"benefits":{"obligo":{"display":"none","total":0}},',
    '"obligo":{"total":0,"active":[],"not_active":[',
    '{"obligo_id":4883,"title":"ארנק דיגיטלי","sum":400,"used":0,"left":400,"expires_at":"20/11/2026"},',
    '{"obligo_id":4884,"title":"PRO","sum":444,"used":444,"left":0,"expires_at":"19/11/2026"}]}',
  ].join('');

  const g = parseWalletGrants(page);
  eq('grants total', g.total, 0);
  eq('grant rows', g.inactive.length, 2);
  eq('grant left', g.inactiveLeft, 400);
  eq('grant expiry (latest)', g.inactiveUntil, '20/11/2026');
  eq('grant sum', g.inactive[0].sum, 400);
  eq(
    'grant text',
    walletGrantsText(g),
    '0 active · 2 expired · ₪400 left · 20/11/2026',
  );

  const withActive = parseWalletGrants(
    '"obligo":{"total":250,"active":[{"obligo_id":1,"title":"x","sum":250,"used":0,"left":250,"expires_at":"01/01/2027"}],"not_active":[]}',
  );
  eq('active total', withActive.total, 250);
  eq('active rows', withActive.active.length, 1);
  eq('active text', walletGrantsText(withActive), '1 active · 0 expired');

  eq('no grants on junk', parseWalletGrants('<html>nothing</html>').inactive.length, 0);
}

async function testGrantLoop() {
  console.log('— wallet grant loop —');
  const client: any = new HtzClient('', '');
  client.ensureWebSession = async () => {};
  let wallet = 1000;
  const carts: string[] = [];

  client.webApi = async (_m: string, path: string, body?: any) => {
    if (path === '/api/wallet/login') return { status: 200, json: { data: { href: '/wallet_attractions_sale/156' } } };
    if (path === '/api/wallet/cart') {
      carts.push(`${body.project_id}:${body.item_id}`);
      if (body.item_id === 111) return { status: 429, json: { error: { code: 'too_many_requests' } } };
      wallet += 400;
      return { status: 200, json: { data: { href: '/checkout2_wallet' } } };
    }
    return { status: 404, json: { error: { code: 'not_found' } } };
  };
  client.appWallet = async () => ({ total: wallet, obligo: [], info: [], byKey: {} });

  const res = await runWalletGrantLoop(client, {
    count: 2,
    tz: '312190481',
    email: 'test@example.com',
    projectId: 156,
    gapMs: 0,
    targets: [
      { itemId: 111, variantId: 1, label: 'a' },
      { itemId: 222, variantId: 2, label: 'b' },
      { itemId: 333, variantId: 3, label: 'c', projectId: 44 },
    ],
  });

  eq('grant loop ok', res.error, undefined);
  eq('grant loop granted', res.granted, 2);
  eq('first try hit the throttled product', carts[0], '156:111');
  eq('switched to another product of the same shop', carts[1], '156:222');
  eq('wallet grew by 400 each', res.walletAfter - res.walletBefore, 800);
}

async function testInvalidLine() {
  console.log('— store-side removals —');
  const c = new FakeClient();
  c.push(200, {
    data: {
      kind: 'regular',
      version: 3,
      lines: [
        { key: 'A', itemId: 1, variantId: 2, qty: 1, price: 10, title: 'Kept' },
        {
          key: 'B',
          itemId: 3,
          variantId: null,
          qty: 1,
          price: 5,
          title: 'Gone',
          invalid_message: 'מוצר זה הוסר מעגלתך בגלל סיום מכירה או חוסר במלאי',
        },
      ],
      warnings: [{ message: 'cart notice' }],
      total: 15,
      checkout: { units: 2 },
    },
  });
  const sum = await readCart(fake(c), 'regular');
  eq('invalid mapped', sum.lines[1].invalid?.includes('הוסר מעגלתך'), true);
  eq('warnings mapped', sum.warnings, ['cart notice']);
}

async function testQtyAndRemove() {
  console.log('— quantity / remove —');
  const c = new FakeClient();
  c.push(200, { data: { kind: 'regular', version: 10, lines: [], total: 0 } });
  const line = { key: 'K 1/2', itemId: 5, variantId: null };

  const q = await setCartQty(fake(c), 'regular', line, 3, 9);
  eq('qty ok', q.ok, true);
  eq('qty path', c.calls[0].path, '/api/cart/quantity');
  eq('qty body', c.calls[0].body, { kind: 'regular', item_key: 'K 1/2', quantity: 3, version: 9 });

  c.push(200, { data: { kind: 'regular', version: 11, lines: [], total: 0 } });
  const r = await removeCartLine(fake(c), 'regular', line, 10);
  eq('remove ok', r.ok, true);
  eq('remove method', c.calls[1].method, 'DELETE');
  eq('remove path', c.calls[1].path, '/api/cart/items?key=K%201%2F2');
}

async function testPayCovered() {
  console.log('— payFromWallet (fully covered) —');
  const c = new FakeClient();
  c.push(200, { data: {} }); // delivery
  c.push(200, { data: { id: 555, totals: { total: 100 } } }); // draft
  c.push(200, { data: { total_obligo: 100, to_pay: 0, fully_covered: true } }); // obligo read
  c.push(200, { data: { total_obligo: 100, to_pay: 0, fully_covered: true } }); // obligo use
  c.push(200, { data: { relocation: 'https://x/order/555' } }); // settle

  const res = await payFromWallet(fake(c), {
    kind: 'regular',
    name: 'Test',
    phone: '0500000000',
    email: 'test@example.com',
    delivery: [{ supplier_id: 1, delivery_link_id: 2 }],
    address: { address: 'A 1', city: 'T' },
    version: 12,
  });

  eq('ok', res.ok, true);
  eq('paid', res.paid, true);
  eq('order', res.orderId, 555);
  eq('toPay', res.toPay, 0);
  eq('delivery version', c.calls[0].body.version, 12);
  eq('obligo use flag', c.calls[3].body.use, true);
  eq('settle path', c.calls[4].path, '/api/orders/settle');
}

async function testPayShortfall() {
  console.log('— payFromWallet (card remainder) —');
  const c = new FakeClient();
  c.push(200, { data: { id: 777, totals: { total: 100 } } });
  c.push(200, { data: { total_obligo: 70, to_pay: 30, fully_covered: false } });
  c.push(200, { data: { payment_url: 'https://pay.example/777' } });

  const res = await payFromWallet(fake(c), {
    kind: 'quick',
    name: 'Test',
    phone: '0500000000',
    email: 'test@example.com',
  });

  eq('ok', res.ok, true);
  eq('paid', res.paid, false);
  eq('covered', res.covered, 70);
  eq('toPay', res.toPay, 30);
  eq('cardUrl', res.cardUrl, 'https://pay.example/777');
}

(async () => {
  await testReadCart();
  await testVariantParsing();
  await testWalletShape();
  await testWalletGrants();
  await testGrantLoop();
  await testInvalidLine();
  await testNativeAdd();
  await testQtyAndRemove();
  await testPayCovered();
  await testPayShortfall();
  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
