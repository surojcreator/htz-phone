/**
 * חנוכה adaptive-switch self-test.
 *
 *   npx tsx scripts/hanukka_selftest.ts
 *
 * Fake store: 3 items at ₪500 / ₪300 / ₪100. The ₪500 item hits a purchase
 * limit, so the loop must mark it exhausted and buy the ₪300 one with a new
 * card. A second run must skip the exhausted item entirely.
 */
import { HtzClient } from '../src/core/api';
import { newHanukkaSession, looksLikeProductPage, parseVariants, runHanukkaAdaptive } from '../src/core/hanukka';

type Reply = { status: number; json: any };

class FakeStore {
  email = 'test@example.com';
  profileEmail = 'test@example.com';
  money = 1000;
  cover: boolean;
  calls: { method: string; path: string; body: any }[] = [];
  session = newHanukkaSession();

  constructor(cover = false) {
    this.cover = cover;
  }

  async webLogin() {}
  async ensureWebSession() {}
  resetSession() {}
  resetAppSession() {}
  async appLogin() {
    return { email: this.email };
  }
  async appWallet() {
    return { total: this.money, obligo: [], info: [] };
  }
  async webProfile() {
    return { first_name: 'Test', last_name: 'User', email: this.profileEmail };
  }

  async webGet(path: string): Promise<string> {
    if (path.startsWith('/wallet_attractions_sale/')) {
      return '<a href="/wallet_attraction_item/111">a</a><a href="/wallet_attraction_item/222">b</a>';
    }
    // Both PDP routes the client tries (`/webview/<id>` first) are served.
    const web = path.match(/^(?:\/webview|\/item)\/(\d+)/);
    const legacy = path.match(/wallet_attraction_item\/(\d+)\?proj_id=(\d+)/);
    const id = web?.[1] ?? legacy?.[1];
    if (!id) return '';
    if (id === '111') {
      return '"title":"Expensive","priceOptions":[{"id":101,"desc":"A","price":500,"maxPerOrder":4}]';
    }
    if (id === '222') {
      return '"title":"Cheap","priceOptions":[{"id":202,"desc":"C","price":100,"maxPerOrder":4}]';
    }
    if (id === '160569') {
      return '"title":"Pro shop","priceOptions":[{"id":303,"desc":"P","price":300,"maxPerOrder":4}]';
    }
    return '';
  }

  async webApi(method: string, path: string, body?: any): Promise<Reply> {
    this.calls.push({ method, path, body });
    if (method === 'DELETE' && path.startsWith('/api/cart')) return { status: 200, json: {} };
    if (method === 'POST' && path === '/api/cart/items') {
      if (Number(body?.variant_id) === 101) {
        return { status: 422, json: { error: { code: 'purchase_limit_reached' } } };
      }
      return { status: 200, json: { data: { total: 300 } } };
    }
    if (method === 'GET' && path.startsWith('/api/cart')) {
      return { status: 200, json: { data: { lines: [{ itemId: 1, qty: 4, price: 300 }], checkout: { units: 4 }, total: 1200 } } };
    }
    if (method === 'POST' && path === '/api/orders/draft') {
      return { status: 200, json: { data: { id: 555, totals: { total: 1200 } } } };
    }
    if (method === 'POST' && path === '/api/orders/pay/obligo') {
      if (this.cover) {
        if (body?.use) return { status: 200, json: { data: {} } };
        return { status: 200, json: { data: { total_obligo: 1200, to_pay: 0, fully_covered: true } } };
      }
      return { status: 200, json: { data: { total_obligo: 0, to_pay: 1200, fully_covered: false } } };
    }
    if (method === 'POST' && path === '/api/orders/settle') {
      return { status: 200, json: { data: { relocation: 'https://x/settled' } } };
    }
    if (method === 'POST' && path === '/api/orders/pay/details') {
      return { status: 200, json: { data: { order_id: 555, payment_num: 1 } } };
    }
    if (method === 'POST' && path === '/api/orders/payment-session') {
      this.money += 50;
      return { status: 200, json: { data: { payment_url: 'https://pay.example/555' } } };
    }
    return { status: 404, json: { error: { code: 'not_found' } } };
  }
}

let pass = 0;
let fail = 0;
const eq = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` :: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`}`);
  if (ok) pass++;
  else fail++;
};

(async () => {
  const store = new FakeStore();
  const client = store as unknown as HtzClient;
  const logs: string[] = [];

  const res = await runHanukkaAdaptive(client, {
    itemId: '166122',
    qty: 4,
    phone: '0500000000',
    session: store.session,
    log: (l) => logs.push(l),
  });

  eq('run ok', res.ok, true);
  eq('switched to the ₪300 pro-shop item', res.itemId, '160569');
  eq('chosen variant', res.variantId, 303);
  eq('chosen price', res.price, 300);
  eq('card url', res.cardUrl, 'https://pay.example/555');
  eq('money before', res.moneyBefore, 1000);
  eq('money after', res.moneyAfter, 1050);
  eq('money delta', res.moneyDelta, 50);

  const limit = res.steps.find((s) => s.step === 'limit' && !s.ok);
  eq('limit recorded', !!limit, true);

  const order = store.calls.filter((c) => c.path === '/api/cart/items').map((c) => c.body?.variant_id);
  eq('tried expensive first, skipped the limit', order, [101, 303]);
  eq('never tried the ₪100 item after success', order.includes(202), false);

  const draft = store.calls.find((c) => c.path === '/api/orders/draft');
  eq('draft uses a new card', draft?.body?.new_card, true);
  eq('no saved card id', draft?.body?.card_id, undefined);

  eq('expensive item marked exhausted', store.session.exhausted?.has('111:101'), true);

  // Second run: the exhausted item must not be attempted again.
  store.calls = [];
  const res2 = await runHanukkaAdaptive(client, {
    itemId: '166122',
    qty: 4,
    phone: '0500000000',
    session: store.session,
    log: () => {},
  });
  eq('second run ok', res2.ok, true);
  const order2 = store.calls.filter((c) => c.path === '/api/cart/items').map((c) => c.body?.variant_id);
  eq('second run skips the exhausted item', order2.includes(101), false);
  eq('second run starts with ₪300', order2[0], 303);

  // Wrong-account guard: no cart write may happen on a mismatched session.
  const wrong = new FakeStore();
  wrong.profileEmail = 'someone-else@example.com';
  const res3 = await runHanukkaAdaptive(wrong as unknown as HtzClient, {
    itemId: '166122',
    qty: 4,
    phone: '0500000000',
    session: wrong.session,
    log: () => {},
  });
  eq('wrong account blocked', res3.ok, false);
  eq('wrong account named', /wrong account/i.test(res3.error || ''), true);
  eq('no cart writes on wrong account', wrong.calls.filter((c) => c.path === '/api/cart/items').length, 0);

  // --- page parsing regressions ---------------------------------------
  // A label escaped one level too many used to make JSON.parse reject the whole
  // array, so the item looked like it had no models at all.
  const escaped =
    '"priceOptions":[{"id":218606,"desc":"תו קניה \\\\"התו המלא\\\\" בשווי 500 ₪","price":490,"statusPrice":490,"maxPerOrder":4}]';
  const ev = parseVariants(escaped);
  eq('double-escaped label parsed', ev.length, 1);
  eq('label unescaped', ev[0]?.desc, 'תו קניה "התו המלא" בשווי 500 ₪');

  // `statusPrice: null` used to win over a real `price` and yield ₪0.
  const nulled = '"priceOptions":[{"id":7,"desc":"X","price":120,"statusPrice":null,"maxPerOrder":2}]';
  eq('null statusPrice falls back to price', parseVariants(nulled)[0]?.price, 120);

  eq('group page is not a product page', looksLikeProductPage('<html><body>shell</body></html>'), false);
  eq('product page is recognised', looksLikeProductPage(escaped), true);

  // --- wallet balance settles the order ---------------------------------
  // When הארנק covers the order the loop must close it there instead of
  // opening a card session.
  const covered = new FakeStore(true);
  const resC = await runHanukkaAdaptive(covered as unknown as HtzClient, {
    itemId: '166122',
    qty: 4,
    phone: '0500000000',
    session: covered.session,
    log: () => {},
  });
  eq('covered run ok', resC.ok, true);
  eq('wallet priced the order', covered.calls.some((c) => c.path === '/api/orders/pay/obligo'), true);
  eq('wallet balance applied', covered.calls.some((c) => c.path === '/api/orders/pay/obligo' && c.body?.use === true), true);
  eq('order settled', covered.calls.some((c) => c.path === '/api/orders/settle'), true);
  eq('no card session when covered', covered.calls.some((c) => c.path === '/api/orders/payment-session'), false);

  // An empty wallet must still go the new-card route.
  eq('card session used when not covered', store.calls.some((c) => c.path === '/api/orders/payment-session'), true);

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
