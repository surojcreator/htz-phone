/**
 * Rate-limit recovery harness — a fake client that answers 429 on demand, so
 * the rebuild path is exercised without waiting on the real throttle.
 */
import { runHanukka, newHanukkaSession } from '../src/core/hanukka';

const itemHtml =
  '<script>self.__next_f.push([1,"{\\"priceOptions\\":[{\\"id\\":252787,\\"desc\\":\\"row 31-39\\",\\"price\\":58,\\"fullPrice\\":169,\\"maxPerOrder\\":4}]}"])</script>';

type Reply = { status: number; json: any };
const ok = (json: any): Reply => ({ status: 200, json });
const rl: Reply = { status: 429, json: { error: { code: 'too_many_requests', message: 'יותר מדי ניסיונות' } } };

function makeClient(plan: { draft429: number; pay429: number }) {
  const counts = { delete: 0, add: 0, draft: 0, pay: 0, get: 0 };
  let draftLeft = plan.draft429;
  let payLeft = plan.pay429;

  const client: any = {
    email: 'test@example.invalid',
    password: 'x',
    ensureWebSession: async () => {},
    webLogin: async () => {},
    webProfile: async () => ({ first_name: 'Test', last_name: 'User', email: 'test@example.invalid', phone: '0500000000' }),
    webGet: async () => itemHtml,
    webApi: async (method: string, path: string) => {
      if (method === 'DELETE' && path.startsWith('/api/cart')) {
        counts.delete++;
        return ok({ data: { lines: [] } });
      }
      if (method === 'POST' && path === '/api/cart/items') {
        counts.add++;
        return ok({ data: { lines: [{ variantId: 252787, qty: 4, price: 58 }] } });
      }
      if (method === 'GET' && path.startsWith('/api/cart')) {
        counts.get++;
        return ok({ data: { lines: [{ variantId: 252787, qty: 4, price: 58 }], total: 232, checkout: { units: 4 } } });
      }
      if (path === '/api/orders/draft') {
        counts.draft++;
        if (draftLeft > 0) {
          draftLeft--;
          return rl;
        }
        return { status: 201, json: { data: { id: 7000 + counts.draft, totals: { total: 232 }, payment: { card_required: true } } } };
      }
      if (path === '/api/orders/payment-session') {
        counts.pay++;
        if (payLeft > 0) {
          payLeft--;
          return rl;
        }
        return ok({ data: { order_id: 7000, payment_url: 'https://pps.creditguard.co.il?txId=test', amount: 232 } });
      }
      return { status: 404, json: {} };
    },
  };
  return { client, counts };
}

async function scenario(name: string, plan: { draft429: number; pay429: number }, expect: (c: any) => string | null) {
  const { client, counts } = makeClient(plan);
  const res = await runHanukka(client, {
    itemId: '166122',
    qty: 4,
    phone: '0555073599',
    session: newHanukkaSession(),
    freshLogin: false,
    retryOnRateLimit: 2,
    log: () => {},
  });
  const problem = expect(counts);
  console.log(`\n${name}`);
  console.log('  result:', res.ok ? 'ok' : 'FAILED', res.orderId ? `order ${res.orderId}` : '', res.error || '');
  console.log('  calls :', JSON.stringify(counts));
  if (problem) console.log('  ✗ ' + problem);
}

(async () => {
  await scenario('baseline (no 429)', { draft429: 0, pay429: 0 }, (c) =>
    c.draft === 1 && c.delete === 1 && c.add === 1 ? null : 'expected one draft / one seed',
  );

  await scenario('draft throttled once -> rebuild cart, retry draft', { draft429: 1, pay429: 0 }, (c) =>
    c.draft === 2 && c.delete === 2 && c.add === 2 ? null : 'expected the cart to be rebuilt before the retry',
  );

  await scenario('payment throttled once -> retried without rebuilding', { draft429: 0, pay429: 1 }, (c) =>
    c.pay === 2 && c.delete === 1 && c.add === 1 ? null : 'expected a plain payment retry, cart untouched',
  );

  await scenario('draft throttled twice -> two rebuilds', { draft429: 2, pay429: 0 }, (c) =>
    c.draft === 3 && c.delete === 3 && c.add === 3 ? null : 'expected two rebuilds',
  );

  await scenario('payment throttled twice -> rebuild cart and redraft', { draft429: 0, pay429: 2 }, (c) =>
    c.pay === 3 && c.draft === 2 && c.delete === 2 && c.add === 2
      ? null
      : 'expected one plain retry, then a rebuild + new draft',
  );
})();
