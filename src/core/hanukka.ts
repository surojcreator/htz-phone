/**
 * חנוכה order loop — PRO² show tickets (group 156: attractions 166122, 166119).
 *
 * Rewritten for the Next.js store. The legacy XMLHttpRequest layer
 * (`/_ajax/ajax.index.php`: wallet sign-in, cart_service, checkout2_service) is
 * gone — it answers 404 now. The new sequence, captured from the site's own
 * client bundle:
 *
 *   POST   /api/auth/login              (HtzClient.webLogin)
 *   GET    /wallet_attraction_item/<id>?proj_id=<proj>   -> variants JSON
 *   DELETE /api/cart?kind=quick                          -> empty the cart
 *   POST   /api/cart/items  {kind, product_id, quantity, variant_id}
 *   GET    /api/cart?kind=quick                          -> totals
 *   POST   /api/orders/draft {cart, shipping, new_card}
 *   POST   /api/orders/payment-session {order_id}        -> card entry URL
 *
 * `new_card` is always forced: the order is staged at the card step and never
 * charged with a stored card.
 */
import { HtzClient, WEB } from './api';
import { readWalletGrants, walletGrantsText } from './grants';
import { checkoutNativeCart } from './wallet';

export const HANUKKA_GROUP = '156';
export const HANUKKA_DEFAULT_ITEM = '166122';
export const HANUKKA_ITEMS = [
  { id: '166122', label: 'חנוכה 2026 · 166122' },
  { id: '166119', label: 'חנוכה 2026 · 166119' },
  { id: '160569', label: 'PRO shop · 160569' },
];

/** The general PRO² shop group/item (the non-חנוכה pool). */
export const PRO_SHOP_GROUP = '44';
/** Ids verified to resolve to a real PDP (167284 is a group page, not a product). */
export const PRO_SHOP_ITEMS = ['160569', '155546'];

export type Variant = {
  id: number;
  price: number;
  desc: string;
  fullPrice?: number;
  max?: number;
};
export type Step = { step: string; ok: boolean; detail?: string };

export type HanukkaOptions = {
  itemId: string;
  qty: number;
  phone: string;
  collected?: string;      // "252788" or "252787:2,252788:2"
  proj?: string;           // default 156
  payment?: string;        // kept for compatibility; the new API has no option
  payOption?: string;      // forced 'new_card'
  dryRun?: boolean;
  /** Carry the logged-in session and item page between orders. */
  session?: HanukkaSession;
  /** Force a fresh login before the first order of the batch (default true). */
  freshLogin?: boolean;
  /** Force a login even if reuse is enabled — used for the every-N-orders refresh. */
  forceSessionRefresh?: boolean;
  /** How many times a 429 may be absorbed by rebuilding the cart (default 2). */
  retryOnRateLimit?: number;
  /** Ignore the cache and reload the item page once. */
  forceReload?: boolean;
  /** Restrict candidates to one item id (used to test a specific חנוכה item). */
  onlyItem?: string;
  shouldStop?: () => boolean;
  /** use the app's native בצע הזמנה before the web card flow */
  nativeCheckout?: boolean;
  log?: (line: string) => void;
};

/**
 * State that survives between orders: identity, variants and the shipping
 * block do not change per order, so nothing is refetched on a repeat.
 */
export type HanukkaSession = {
  loggedIn: boolean;
  proj?: string;
  item?: string;
  variants?: Variant[];
  title?: string;
  allowance?: number;
  /** item+variant keys that hit a purchase/stock limit in this batch */
  exhausted?: Set<string>;
  /** discovered חנוכה / PRO shop items, kept between orders */
  items?: HanukkaItemCache[];
  /** last observed Htzone-money balance (native wallet) */
  moneyLast?: number;
  /** one-line summary of the site's wallet grants (active / expired) */
  grantsNote?: string;
};

export type HanukkaItemCache = {
  id: string;
  proj: string;
  title: string;
  variants: Variant[];
  isProShop?: boolean;
};

export type HanukkaCandidate = {
  itemId: string;
  proj: string;
  title: string;
  variantId: number;
  price: number;
  label: string;
  max?: number;
  isProShop?: boolean;
};

export function newHanukkaSession(): HanukkaSession {
  return { loggedIn: false, exhausted: new Set<string>(), items: [] };
}

export type HanukkaResult = {
  ok: boolean;
  steps: Step[];
  variants: Variant[];
  payload?: string;
  relocation?: string;
  cardUrl?: string;
  orderUrl?: string;
  orderId?: number;
  total?: number;
  units?: number;
  itemId?: string;
  variantId?: number;
  price?: number;
  /** Htzone money read through the Android app API */
  moneyBefore?: number;
  moneyAfter?: number;
  moneyDelta?: number;
  error?: string;
  raw?: unknown;
};

/** Scraped iframe sources carry HTML entities and may be relative. */
function absoluteUrl(raw: string): string {
  let s = String(raw).trim().replace(/&amp;/gi, '&').replace(/&#0*38;/g, '&').replace(/&quot;/gi, '"');
  if (s.startsWith('//')) s = 'https:' + s;
  else if (s.startsWith('/')) s = WEB + s;
  return s;
}

/**
 * Classify the payment response.
 *
 * New API:  { data: { payment_url } } | { data: { relocation } }
 * Errors:   { error: { code, message } }
 * The card URL is a SUCCESS: the order exists and waits for a card.
 */
export function interpretPayResponse(pay: any): { ok: boolean; relocation?: string; cardUrl?: string; error?: string } {
  if (!pay || typeof pay !== 'object') return { ok: false, error: 'empty response' };
  const err = pay.error;
  if (err) return { ok: false, error: [err.code, err.message].filter(Boolean).join(' — ') || 'refused' };

  const d = pay.data ?? pay;
  if (d.relocation) return { ok: true, relocation: absoluteUrl(String(d.relocation)) };
  const url = d.payment_url || d.url || d.iframe_url;
  if (url) return { ok: true, cardUrl: absoluteUrl(String(url)) };
  const html = typeof d.html === 'string' ? d.html : typeof pay.html === 'string' ? pay.html : '';
  const iframe = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (iframe) return { ok: true, cardUrl: absoluteUrl(iframe[1]) };
  if (d.id && d.status) return { ok: true };
  return { ok: false, error: 'unrecognised response' };
}

function text(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/** First finite number among the candidates; ignores the page's `null`s. */
function numOf(...vals: any[]): number {
  for (const v of vals) {
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/** Undo the page's doubled backslashes around quotes. */
function unescape(s: string): string {
  return s.replace(/\\(["\\])/g, '$1');
}

/** A product page always ships one of these keys; a group/shell page ships none. */
const PRODUCT_KEYS = ['"priceOptions":', '"collectedOptions":', '"variants":'];

export function looksLikeProductPage(html: string): boolean {
  return PRODUCT_KEYS.some((k) => html.includes(k));
}

/**
 * Rows the item page exposes. The page embeds the product as JSON inside the
 * Next.js flight payload (`"variants":[{"variantId":…,"price":…}]`), escaped
 * once. The legacy `data-collected_id` markup is kept as a fallback.
 */
export function parseVariants(html: string): Variant[] {
  const out: Variant[] = [];
  const seen = new Set<number>();
  const flat = html.replace(/\\"/g, '"');

  /** Pull the balanced JSON array that starts after `key`. */
  const arrayAfter = (key: string): any[] | null => {
    let at = flat.indexOf(key);
    while (at >= 0) {
      let start = at + key.length;
      while (start < flat.length && /\s/.test(flat[start])) start++;
      if (flat[start] === '[') {
        let depth = 0;
        for (let i = start; i < flat.length && i < start + 20000; i++) {
          const ch = flat[i];
          if (ch === '[') depth++;
          else if (ch === ']') {
            depth--;
            if (depth === 0) {
              const slice = flat.slice(start, i + 1);
              // Some labels are escaped one level too many (`\\"…\\"`), which
              // makes the whole array unparseable — collapse them and retry.
              for (const candidate of [slice, slice.replace(/\\\\"/g, '\\"')]) {
                try {
                  const arr = JSON.parse(candidate);
                  if (Array.isArray(arr)) return arr;
                } catch {
                  /* next candidate / next occurrence */
                }
              }
              break;
            }
          }
        }
      }
      at = flat.indexOf(key, at + key.length);
    }
    return null;
  };

  // Concrete SKUs and price rows. `priceOptions` carries the store's per-order
  // maximum (`maxPerOrder`); `collectedOptions` is the fallback for pages that
  // only expose SKUs.
  const options = arrayAfter('"priceOptions":');
  if (options) {
    for (const v of options) {
      const id = Number(v.id ?? v.variantId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        price: numOf(v.statusPrice, v.price, v.htzCard, v.poalim),
        desc: unescape(String(v.desc ?? v.label ?? v.title ?? '')),
        fullPrice: v.fullPrice != null ? Number(v.fullPrice) : undefined,
        max: numOf(v.maxPerOrder, v.available, v.maxQty) || undefined,
      });
    }
    if (out.length) return out;
  }

  const collected = arrayAfter('"collectedOptions":');
  if (collected) {
    for (const v of collected) {
      const id = Number(v.id ?? v.variantId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        price: numOf(v.statusPrice, v.price, v.htzCard, v.poalim),
        desc: unescape(String(v.label ?? v.desc ?? v.title ?? '')),
        fullPrice: v.fullPrice != null ? Number(v.fullPrice) : undefined,
        max: numOf(v.maxPerOrder, v.maxQty, v.available) || undefined,
      });
    }
    if (out.length) return out;
  }

  // The product's own rows: id / desc / price / statusPrice / maxPerOrder.
  const variants = arrayAfter('"variants":');
  if (variants) {
    for (const v of variants) {
      const id = Number(v.variantId ?? v.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        price: numOf(v.statusPrice, v.price, v.htzCard, v.poalim),
        desc: unescape(String(v.title ?? v.text ?? v.desc ?? '')),
        fullPrice: v.fullPrice != null ? Number(v.fullPrice) : undefined,
        max: numOf(v.max, v.maxPerOrder, v.available) || undefined,
      });
    }
    if (out.length) return out;
  }

  for (const chunk of html.split(/(?=data-collected_id=["'])/).slice(1)) {
    const m = chunk.match(/^data-collected_id=["'](\d+)["']/);
    if (!m) continue;
    const id = Number(m[1]);
    if (seen.has(id)) continue;
    seen.add(id);
    const gt = chunk.indexOf('>');
    const tag = chunk.slice(0, gt >= 0 ? gt : 400);
    const price = Number((tag.match(/data-price=["'](\d+)["']/) || [])[1] || 0);
    const d = chunk.match(/class=["']cell desc["'][^>]*>([\s\S]*?)<\/div>/);
    out.push({ id, price, desc: d ? text(d[1]) : '' });
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Read a PDP through the route the app itself opens (`/webview/<id>`), with the
 * older paths as backups.
 *
 * Two things used to make this look like "the item has no models": the legacy
 * `/wallet_attraction_item/<id>` URL is dead on the current site (it answers
 * with the ~1.7 MB app shell), and a short body is the store throttling, not an
 * empty product. So: try the real route first, treat shell pages as a miss, and
 * retry short answers with a backoff before giving up.
 */
export async function readItemPage(
  client: HtzClient,
  id: string,
  proj: string,
  log?: (line: string) => void,
): Promise<{ html: string; variants: Variant[]; title: string; gate: boolean }> {
  // The PDPs are behind the website session; an app-only session renders the
  // anonymous shell with no product data in it.
  await client.ensureWebSession();
  const paths = [
    `/webview/${id}?proj_id=${proj}`,
    `/webview/${id}`,
    `/item/${id}/`,
    `/wallet_attraction_item/${id}?proj_id=${proj}`,
  ];
  let best = { html: '', variants: [] as Variant[], title: '', gate: false };
  for (const path of paths) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let html = '';
      try {
        html = await client.webGet(path);
      } catch (e: any) {
        log?.(`· ${path} failed: ${e?.message ?? e}`);
      }
      const gate = /אין לך זכאות/.test(html);
      const variants = parseVariants(html);
      const flat = html.replace(/\\"/g, '"');
      const title =
        unescape((flat.match(/"seo":\{"title":"((?:\\.|[^"\\]){0,140})"/) || [])[1] || '') ||
        text((html.match(/<title[^>]*>([^<]{0,120})/) || [])[1] || '');
      if (variants.length) return { html, variants, title, gate };
      if (gate) return { html, variants: [], title, gate: true };
      if (html.length > best.html.length) best = { html, variants, title, gate };
      // Nothing came back: this route does not exist — try the next one now.
      if (!html) continue;
      // The 1.7 MB SPA shell means this id is a group, not a product — every
      // other route answers the same shell, so stop here.
      if (html.length > 500_000 && !looksLikeProductPage(html)) return best;
      // A body without the product keys is usually the store throttling;
      // back off once, then move on to the next route.
      await sleep(600 + attempt * 800);
    }
  }
  return best;
}

function buildLines(variants: Variant[], collected: string | undefined, qty: number) {
  if (!variants.length) return [] as { id: number; qty: number }[];
  if (collected && collected.includes(':')) {
    const want = new Map<number, number>(variants.map((v) => [v.id, 0]));
    for (const part of collected.split(',')) {
      const [rawId, rawQty] = part.split(':');
      const id = Number(rawId);
      if (!want.has(id)) throw new Error(`variant ${rawId} is not on the page (${variants.map((v) => v.id).join(', ')})`);
      want.set(id, Math.max(0, parseInt(rawQty || '0', 10) || 0));
    }
    return variants.map((v) => ({ id: v.id, qty: want.get(v.id) || 0 }));
  }
  const pick = collected ? Number(collected) : variants[0].id;
  if (!variants.some((v) => v.id === pick)) {
    throw new Error(`variant ${pick} is not on the page (${variants.map((v) => v.id).join(', ')})`);
  }
  return variants.map((v) => ({ id: v.id, qty: v.id === pick ? qty : 0 }));
}

/**
 * Keep-and-print representation of what the order will be, so a dry run still
 * shows something concrete.
 */
export function buildPayBody(o: {
  phone: string;
  item: string;
  name: string;
  email: string;
  lines: { id: number; qty: number }[];
}): string {
  const body = {
    cart: 'quick',
    shipping: { name: o.name, phone: o.phone, email: o.email },
    new_card: true,
    items: o.lines.filter((l) => l.qty > 0).map((l) => ({ product_id: Number(o.item), variant_id: l.id, quantity: l.qty })),
  };
  return JSON.stringify(body, null, 2);
}

export async function runHanukka(client: HtzClient, opts: HanukkaOptions): Promise<HanukkaResult> {
  const log = opts.log || (() => {});
  const steps: Step[] = [];
  const add = (step: string, ok: boolean, detail?: string) => {
    steps.push({ step, ok, detail });
    log(`${ok ? '✓' : '✗'} ${step}${detail ? ' — ' + detail : ''}`);
  };

  let proj = opts.proj || HANUKKA_GROUP;
  const item = opts.itemId || HANUKKA_DEFAULT_ITEM;
  let variants: Variant[] = [];
  const stopped = () => (opts.shouldStop ? opts.shouldStop() : false);
  const abort = (where: string): HanukkaResult => {
    add('stopped', false, `cancelled before ${where}`);
    return { ok: false, steps, variants, error: `stopped before ${where}` };
  };

  const sess = opts.session;
  const force = !!opts.forceReload;
  const sessionReady = !!sess && sess.loggedIn && !force;

  try {
    // ---- session -------------------------------------------------------
    // The first order of a batch logs in from scratch; repeats reuse it. A
    // fresh login is what guarantees the account is really authenticated
    // before an order is drafted, even if the app has been idle for hours.
    if (sessionReady) {
      add('web login', true, `reused session (${client.email})`);
    } else if (opts.forceSessionRefresh) {
      await client.webLogin();
      if (sess) sess.loggedIn = true;
      add('web login', true, `refreshed session (${client.email})`);
    } else if (opts.freshLogin === false) {
      await client.ensureWebSession();
      if (sess) sess.loggedIn = true;
      add('web login', true, client.email);
    } else {
      await client.webLogin();
      if (sess) sess.loggedIn = true;
      add('web login', true, `fresh login (${client.email})`);
    }
    const profile = await client.webProfile();
    const buyerName = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim() || '—';
    const buyerEmail = String(profile.email || client.email);
    if (stopped()) return abort('item page');

    // ---- item page -----------------------------------------------------
    const cacheHit = sessionReady && sess!.proj === proj && sess!.item === item && !!sess!.variants?.length;
    let title = '';

    if (cacheHit) {
      variants = sess!.variants!;
      title = sess!.title || '';
      add('item', true, `${title || item} · ${variants.length} variant(s) · cached`);
    } else {
      log(`· reading item ${item} (proj ${proj})`);
      const page = await readItemPage(client, item, proj, log);
      if (page.gate) {
        add('eligibility', false, 'PRO² gate closed — this account has no shop eligibility');
        return { ok: false, steps, variants: [], error: 'no PRO² eligibility on this account' };
      }
      variants = page.variants;
      title = page.title;
      if (!variants.length) {
        const kind = looksLikeProductPage(page.html) ? 'no variants found' : 'not a product page';
        add('item page', false, `${kind} (${page.html.length} B)`);
        return { ok: false, steps, variants: [], error: `item page did not expose any variants (${kind})` };
      }
      const allowance = variants.reduce((m, v) => Math.max(m, v.max || 0), 0);
      add('item', true, `${title || item} · ${variants.length} variant(s)${allowance ? ` · allowance ${allowance}` : ''}`);
      if (sess) {
        sess.proj = proj;
        sess.item = item;
        sess.variants = variants;
        sess.title = title;
        sess.allowance = allowance;
      }
    }

    const lines = buildLines(variants, opts.collected, opts.qty);
    const wanted = lines.filter((l) => l.qty > 0);
    if (!wanted.length) {
      add('cart selection', false, 'nothing selected');
      return { ok: false, steps, variants, error: 'nothing selected' };
    }
    add('cart selection', true, wanted.map((l) => `${l.id}×${l.qty}`).join(', '));
    if (stopped()) return abort('cart add');

    // ---- cart ----------------------------------------------------------
    // Rebuilt on demand: the store rate-limits aggressively, and a 429 in the
    // middle of seeding leaves a half-filled cart, so recovery is always
    // "clear, add everything again, retry the step".
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const rateLimited = (res: { status: number; json: any }) =>
      res.status === 429 || res.json?.error?.code === 'too_many_requests';
    const retryAfterMs = (res: { json: any }, attempt: number) => {
      const hinted = Number(res?.json?.error?.retry_after ?? 0);
      return hinted > 0 ? hinted * 1000 : Math.min(30000, 4000 * (attempt + 1));
    };

    const seedCart = async (): Promise<{ ok: boolean; units: number; total: number; lines: number; error?: string; limited?: boolean }> => {
      log('· clearing the quick cart');
      const cleared = await client.webApi('DELETE', '/api/cart?kind=quick');
      if (rateLimited(cleared)) return { ok: false, units: 0, total: 0, lines: 0, error: HtzClient.apiError(cleared), limited: true };
      if (cleared.status >= 400) return { ok: false, units: 0, total: 0, lines: 0, error: HtzClient.apiError(cleared) };

      let added = 0;
      for (const l of wanted) {
        log(`· adding ${l.id}×${l.qty}`);
        const res = await client.webApi('POST', '/api/cart/items', {
          kind: 'quick',
          product_id: Number(item),
          quantity: l.qty,
          variant_id: l.id,
        });
        if (rateLimited(res)) {
          return { ok: false, units: 0, total: 0, lines: 0, error: `${l.id}×${l.qty}: ${HtzClient.apiError(res)}`, limited: true };
        }
        if (res.status >= 400 || res.json?.error) {
          return { ok: false, units: 0, total: 0, lines: 0, error: `${l.id}×${l.qty}: ${HtzClient.apiError(res)}` };
        }
        added += l.qty;
      }

      const cart = await client.webApi('GET', '/api/cart?kind=quick');
      if (rateLimited(cart)) return { ok: false, units: 0, total: 0, lines: 0, error: HtzClient.apiError(cart), limited: true };
      const cdata = cart.json?.data || {};
      const cartLines = (cdata.lines || []) as any[];
      if (!cartLines.length) {
        return { ok: false, units: 0, total: 0, lines: 0, error: 'cart is empty after adding (stock / per-member limit)' };
      }
      return {
        ok: true,
        units: Number(cdata.checkout?.units ?? cdata.count ?? added),
        total: Number(cdata.total || cdata.checkout?.totalSum || 0),
        lines: cartLines.length,
      };
    };

    const maxRateLimitRetries = Math.max(0, Math.min(5, opts.retryOnRateLimit ?? 2));
    let seeded = await seedCart();
    for (let attempt = 0; !seeded.ok && seeded.limited && attempt < maxRateLimitRetries; attempt++) {
      const waitMs = retryAfterMs(seeded as any, attempt);
      add('rate limit', false, `cart seed throttled — rebuilding in ${Math.round(waitMs / 1000)}s (${attempt + 1}/${maxRateLimitRetries})`);
      await sleep(waitMs);
      if (stopped()) return abort('cart retry');
      seeded = await seedCart();
    }
    if (!seeded.ok) {
      add('cart add', false, seeded.error || 'cart could not be filled');
      return { ok: false, steps, variants, error: seeded.error || 'cart could not be filled' };
    }

    const units = seeded.units;
    const total = seeded.total;
    const cartUnits = seeded.units;
    add('cart add', true, `${cartUnits} unit(s) · ₪${total}`);

    const draftBody = {
      cart: 'quick',
      shipping: { name: buyerName, phone: opts.phone, email: buyerEmail },
      new_card: true,
      phone_man_pay: opts.phone,
      payment_num: 1,
    };
    const preview = buildPayBody({
      phone: opts.phone,
      item,
      name: buyerName,
      email: buyerEmail,
      lines: wanted,
    });

    if (opts.dryRun) {
      log('— dry run: cart filled, order not drafted —');
      return { ok: true, steps, variants, payload: preview, total, units: cartUnits };
    }
    if (stopped()) return abort('order draft');

    // ---- the app's own checkout ----------------------------------------
    // "בצע הזמנה" in the phone app is the native `submitOrder`, and it carries
    // the wallet as `obligo_sum`. It goes first because it closes an order with
    // no card at all when there is credit; without credit the store answers
    // `אופס.. פרמטר חסר` (`extra: "no credit"`) and the card flow below takes
    // over. Opt-in, so the self-test can keep its own fake store.
    if (opts.nativeCheckout === true) {
      log('· בצע הזמנה (app API)');
      const line = lines.find((l) => l.qty > 0);
      try {
        await client.appAddToCart({
          itemId: Number(item),
          itemType: 1,
          isQuick: 0,
          collectedIds: line ? [{ id: line.id, quantity: line.qty }] : [],
        });
      } catch {
        /* the web cart already holds the items */
      }
      const native = await checkoutNativeCart(client, { phone: opts.phone, isQuick: 0 });
      if (native.ok) {
        add('checkout', true, `order ${native.orderId ?? '?'} · ₪${native.walletUsed ?? 0} from the wallet`);
        return {
          ok: true,
          steps,
          variants,
          payload: preview,
          orderId: native.orderId,
          total,
          units: cartUnits,
        };
      }
      add('checkout', false, native.error ?? 'checkout failed');
      if (stopped()) return abort('web draft');
    }

    // ---- draft + payment, with rate-limit recovery ---------------------
    // 429 is answered by rebuilding the cart (clear + add again) and retrying
    // the step, because a throttled request often leaves the cart in a state
    // the next call refuses.
    let orderId = 0;
    let draftTotal = total;
    let payRaw: any = null;
    let adopted = false;
    let verdict: { ok: boolean; relocation?: string; cardUrl?: string; error?: string } = { ok: false };
    let gaveUp = false;

    for (let attempt = 0; attempt <= maxRateLimitRetries && !verdict.ok && !gaveUp; attempt++) {
      log('· drafting the order — new blank card');
      const draft = await client.webApi('POST', '/api/orders/draft', draftBody);

      if (rateLimited(draft)) {
        const waitMs = retryAfterMs(draft, attempt);
        add(
          'rate limit',
          false,
          `order draft throttled — rebuilding the cart in ${Math.round(waitMs / 1000)}s (${attempt + 1}/${maxRateLimitRetries})`,
        );
        await sleep(waitMs);
        if (stopped()) return abort('draft retry');
        const rebuilt = await seedCart();
        if (!rebuilt.ok) {
          add('cart add', false, rebuilt.error || 'could not rebuild the cart');
          return { ok: false, steps, variants, payload: preview, error: rebuilt.error || 'cart rebuild failed' };
        }
        add('cart add', true, `${rebuilt.units} unit(s) · ₪${rebuilt.total} (rebuilt)`);
        continue;
      }

      if (draft.status >= 400 || draft.json?.error) {
        const code = draft.json?.error?.code;
        const existing = Number(draft.json?.error?.details?.order_id || 0);

        // A previous run left a checkout open on this cart. Nothing is wrong
        // with the request — the store just refuses a second draft. Adopt the
        // order that already exists and take it to payment instead of dying
        // with "cart_checkout_in_progress".
        if (code === 'cart_checkout_in_progress' && existing) {
          orderId = existing;
          adopted = true;
          add('order draft', true, `resuming unfinished checkout ${orderId}`);
        } else {
          const detail = HtzClient.apiError(draft);
          add('order draft', false, detail);
          return { ok: false, steps, variants, payload: preview, error: detail, raw: draft.json };
        }
      } else {
        orderId = Number(draft.json?.data?.id || 0);
        draftTotal = Number(draft.json?.data?.totals?.total ?? total);
        add('order draft', true, `order ${orderId} · ₪${draftTotal}${draft.json?.data?.payment?.card_required ? ' · card required' : ''}`);
      }
      if (stopped()) return abort('payment session');

      // ---- wallet / obligo balance -------------------------------------
      // Whatever money sits in הארנק שלי is applied to the order first: the
      // store prices it with `pay/obligo`, applies it with `use`, and a fully
      // covered order is closed with `settle` — no card, no PPS. Only the
      // remainder needs the new-card session below.
      if (orderId && !verdict.ok && !gaveUp) {
        log('· applying the wallet balance');
        let priced = await client.webApi('POST', '/api/orders/pay/obligo', { order_id: orderId });
        if (rateLimited(priced)) {
          await sleep(retryAfterMs(priced, attempt));
          priced = await client.webApi('POST', '/api/orders/pay/obligo', { order_id: orderId });
        }
        const od = priced.json?.data || {};
        const covered = Number(od.total_obligo ?? 0);
        const toPay = Number(od.to_pay ?? draftTotal);
        if (covered > 0) {
          add('wallet', true, `₪${covered} of ₪${draftTotal} from the wallet balance${toPay > 0 ? ` · ₪${toPay} left for the card` : ''}`);
          const applied = await client.webApi('POST', '/api/orders/pay/obligo', { order_id: orderId, use: true });
          if (applied.status >= 400 || applied.json?.error) {
            add('wallet', false, 'the store refused to apply the balance: ' + HtzClient.apiError(applied));
          } else if (od.fully_covered === true && toPay <= 0) {
            const settle = await client.webApi('POST', '/api/orders/settle', { order_id: orderId });
            if (settle.status < 400 && !settle.json?.error) {
              verdict = {
                ok: true,
                relocation: settle.json?.data?.relocation ? String(settle.json.data.relocation) : undefined,
              };
              add('payment', true, `settled from the wallet balance — ₪${covered}`);
            } else {
              add('payment', false, 'settle failed: ' + HtzClient.apiError(settle));
            }
          }
        } else {
          // Nothing usable right now. The site still lists the expired grants,
          // so say so instead of a bare "₪0" — that is what"הטבות לא פעילות"
          // shows and it is the difference between "no money" and "expired".
          let note = '';
          try {
            if (sess && sess.grantsNote === undefined) {
              sess.grantsNote = walletGrantsText(await readWalletGrants(client));
            }
            note = sess?.grantsNote ? ` · ${sess.grantsNote}` : '';
          } catch {
            /* the wallet tab is optional context */
          }
          add('wallet', true, `₪0 available — the order needs a card${note}`);
        }
      }

      if (!verdict.ok && !gaveUp) {
        log('· saving card payment details');
        let details = await client.webApi('POST', '/api/orders/pay/details', {
          order_id: orderId,
          phone_man_pay: opts.phone,
          payment_num: 1,
        });
        if (rateLimited(details)) {
          const waitMs = retryAfterMs(details, attempt);
          add('rate limit', false, `payment details throttled — retrying in ${Math.round(waitMs / 1000)}s`);
          await sleep(waitMs);
          details = await client.webApi('POST', '/api/orders/pay/details', {
            order_id: orderId,
            phone_man_pay: opts.phone,
            payment_num: 1,
          });
        }
        if (details.status >= 400 || details.json?.error) {
          const detail = HtzClient.apiError(details);
          add('payment details', false, detail);
          gaveUp = true;
          verdict = { ok: false, error: 'payment details: ' + detail };
        } else {
          add('payment details', true, `phone_man_pay ${opts.phone} · payment_num 1`);
        }
      }

      if (!verdict.ok && !gaveUp) {
        log('· opening the card session (new card)');
        let pay = await client.webApi('POST', '/api/orders/payment-session', { order_id: orderId, new_card: true });

        if (rateLimited(pay)) {
          const waitMs = retryAfterMs(pay, attempt);
          add('rate limit', false, `payment throttled — retrying in ${Math.round(waitMs / 1000)}s`);
          await sleep(waitMs);
          pay = await client.webApi('POST', '/api/orders/payment-session', { order_id: orderId, new_card: true });
        }

        if (rateLimited(pay)) {
          add('rate limit', false, 'still throttled — rebuilding the cart and drafting again');
          const rebuilt = await seedCart();
          if (!rebuilt.ok) {
            add('cart add', false, rebuilt.error || 'could not rebuild the cart');
            return {
              ok: false,
              steps,
              variants,
              payload: preview,
              orderId,
              total: draftTotal,
              error: rebuilt.error || 'cart rebuild failed',
            };
          }
          add('cart add', true, `${rebuilt.units} unit(s) · ₪${rebuilt.total} (rebuilt)`);
          continue;
        }

        payRaw = pay.json;
        verdict = interpretPayResponse(pay.json);
        if (!verdict.ok) gaveUp = true;
      }
    }

    if (!verdict.ok) {
      const detail = verdict.error || HtzClient.apiError({ status: 0, json: payRaw }) || 'payment failed';
      add('payment', false, detail.slice(0, 160));
      return {
        ok: false,
        steps,
        variants,
        payload: preview,
        orderId,
        total: draftTotal,
        error: detail,
        raw: payRaw,
      };
    }

    // The app's "אישור הזמנה" step: open the confirmation page (the PPS return
    // otherwise lands here without the 3DS token and reports a missing parameter).
    const orderUrl = orderId ? `${WEB}/checkout3_new/${orderId}` : undefined;
    if (orderUrl) {
      try {
        log('· opening אישור הזמנה page');
        const page = await client.webGet(`/checkout3_new/${orderId}`);
        const title = (page.match(/<title[^>]*>([^<]{0,90})/i) || [])[1] || '';
        add('אישור הזמנה', page.includes('אישור הזמנה'), title || `${page.length} B`);
      } catch (e: any) {
        add('אישור הזמנה', false, e?.message ?? String(e));
      }
    }

    if (verdict.relocation) {
      add('payment', true, `next → ${verdict.relocation}`);
      return {
        ok: true,
        steps,
        variants,
        payload: preview,
        orderId,
        orderUrl: orderId ? `${WEB}/checkout3_new/${orderId}` : undefined,
        total: draftTotal,
        units: cartUnits,
        relocation: verdict.relocation,
        raw: payRaw,
      };
    }
    add('payment', true, 'order staged — card entry required');
    if (verdict.cardUrl) log(`CARD PAYMENT REQUIRED -> ${verdict.cardUrl}`);
    return {
      ok: true,
      steps,
      variants,
      payload: preview,
      orderId,
      orderUrl: orderId ? `${WEB}/checkout3_new/${orderId}` : undefined,
      total: draftTotal,
      units: cartUnits,
      cardUrl: verdict.cardUrl,
      raw: payRaw,
    };
  } catch (e: any) {
    add('error', false, e?.message ?? String(e));
    return { ok: false, steps, variants: [], error: e?.message ?? String(e) };
  }
}

/**
 * Discover every orderable attraction in the חנוכה group and the general PRO²
 * shop, with each item's variants and prices. Results are cached on the batch
 * session so repeated orders do not refetch every item page.
 */
async function discoverItems(
  client: HtzClient,
  opts: HanukkaOptions,
  add: (step: string, ok: boolean, detail?: string) => void,
): Promise<HanukkaItemCache[]> {
  const sess = opts.session;
  if (!opts.forceReload && sess?.items?.length) {
    add('items', true, `${sess.items.length} item(s) · cached`);
    return sess.items;
  }

  const wanted = new Map<string, { proj: string; proShop: boolean }>();
  const push = (id: string, proj: string, proShop: boolean) => {
    if (id && !wanted.has(id)) wanted.set(id, { proj, proShop });
  };

  for (const it of HANUKKA_ITEMS) push(it.id, opts.proj || HANUKKA_GROUP, false);
  for (const id of PRO_SHOP_ITEMS) push(id, PRO_SHOP_GROUP, true);
  for (const id of String(opts.itemId || '').split(/[,\s]+/).filter(Boolean)) {
    push(id, opts.proj || HANUKKA_GROUP, false);
  }

  // The sale pages list the current items; they are auth-gated, so this runs
  // after login. If the page is client-rendered the known ids still cover it.
  for (const [group, proShop] of [
    [opts.proj || HANUKKA_GROUP, false],
    [PRO_SHOP_GROUP, true],
  ] as [string, boolean][]) {
    try {
      add('sale group', true, `${group}${proShop ? ' · PRO shop' : ''}`);
      const html = await client.webGet(`/wallet_attractions_sale/${group}`);
      for (const m of html.matchAll(/wallet_attraction_item\/(\d+)/g)) push(m[1], group, proShop);
    } catch {
      /* group page unavailable */
    }
  }

  const items: HanukkaItemCache[] = [];
  // The caller gives discovery 45 s; finish inside that with what we have
  // instead of being cut off with nothing.
  const deadline = Date.now() + 30_000;
  let misses = 0;
  for (const [id, meta] of wanted) {
    if (opts.shouldStop?.()) break;
    if (Date.now() > deadline || items.length >= 40) break;
    // A run of unreadable ids means the store is throttling — stop poking it.
    if (misses >= 8 && !items.length) break;
    const projs = [...new Set([meta.proj, meta.proj === HANUKKA_GROUP ? PRO_SHOP_GROUP : HANUKKA_GROUP])];
    let hit = false;
    for (const proj of projs) {
      try {
        const page = await readItemPage(client, id, proj);
        if (page.gate || !page.variants.length) continue;
        add('item page', true, `${id} · ${page.variants.length} model(s)${page.title ? ` · ${page.title}` : ''}`);
        items.push({
          id,
          proj,
          title: page.title || `#${id}`,
          variants: page.variants,
          isProShop: meta.proShop || proj === PRO_SHOP_GROUP,
        });
        hit = true;
      } catch {
        /* try the other project */
      }
      if (hit) break;
    }
    misses = hit ? 0 : misses + 1;
    // Small gap: the store throttles bursts of page reads.
    await sleep(200);
  }

  const seen = new Set<string>();
  const unique = items.filter((i) => {
    const key = `${i.id}:${i.proj}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (sess) sess.items = unique;
  add('items', unique.length > 0, `${unique.length} item(s) discovered`);
  return unique;
}

/** Purchase/stock refusal — the signal to move to the next (cheaper) item. */
function isLimitFailure(res: HanukkaResult): boolean {
  const txt = [res.error || '', ...res.steps.filter((s) => !s.ok).map((s) => s.detail || '')].join(' ');
  if (/rate limit|too_many_requests|throttl|\b429\b/i.test(txt)) return false;
  if (/not on the page|no variants found|variant .* is not/i.test(txt)) return true;
  return /purchase_limit|limit_reached|limit|מלאי|אזל|נגמר|הגבל|stock|cart_empty|out_of_stock/i.test(txt);
}

/**
 * Adaptive חנוכה / PRO² shop loop.
 *
 * Builds every candidate (item + variant) across both pools, sorts by price
 * **descending**, and tries them one by one. A purchase/stock limit marks that
 * candidate exhausted and moves to the next — most expensive to cheapest.
 * Every order is drafted with `new_card: true` and no stored card id.
 */
export async function runHanukkaAdaptive(client: HtzClient, opts: HanukkaOptions): Promise<HanukkaResult> {
  const log = opts.log || (() => {});
  const steps: Step[] = [];
  const add = (step: string, ok: boolean, detail?: string) => {
    steps.push({ step, ok, detail });
    log(`${ok ? '✓' : '✗'} ${step}${detail ? ' — ' + detail : ''}`);
  };
  const stopped = () => (opts.shouldStop ? opts.shouldStop() : false);
  const sess = opts.session;

  try {
    // Discovery pages need a real session, so establish it once here.
    // A fresh Hanukka run drops the cookie jar first: the store otherwise can
    // answer the login with the account that is still signed in, which is how
    // an order ends up on the wrong account.
    const reuse = !!sess?.loggedIn && !opts.forceReload && !opts.forceSessionRefresh;
    if (!reuse) {
      if (opts.freshLogin !== false) {
        client.resetSession();
        log('· cleared the previous store session');
      }
      log('· logging in…');
      await client.webLogin();
      if (sess) sess.loggedIn = true;
      add('web login', true, `logged in as ${client.email}`);
    } else {
      add('web login', true, `reused session (${client.email})`);
    }

    // Never order on a session that belongs to a different account.
    const profile = await client.webProfile();
    const loggedEmail = String(profile?.email ?? '').trim();
    if (loggedEmail && client.email && loggedEmail.toLowerCase() !== client.email.toLowerCase()) {
      add('account', false, `store is signed in as ${loggedEmail}, expected ${client.email}`);
      return {
        ok: false,
        steps,
        variants: [],
        error: `wrong account: ${loggedEmail} (expected ${client.email})`,
      };
    }
    add('account', true, loggedEmail || client.email);
    add('payment method', true, 'new blank card — new_card=true, no stored card id');

    // The wallet lives on the Android API session, so verify that account too.
    let moneyBefore: number | undefined = sess?.moneyLast;
    try {
      log('· verifying the app account and Htzone money…');
      client.resetAppSession();
      const appUser: any = await client.appLogin();
      const appEmail = String(appUser?.email ?? appUser?.mail ?? appUser?.user_email ?? '').trim();
      if (appEmail && client.email && appEmail.toLowerCase() !== client.email.toLowerCase()) {
        add('app account', false, `app API is signed in as ${appEmail}, expected ${client.email}`);
        return {
          ok: false,
          steps,
          variants: [],
          error: `wrong app account: ${appEmail} (expected ${client.email})`,
        };
      }
      add('app account', true, appEmail || '(email not returned)');
      const w = await client.appWallet();
      if (moneyBefore == null) moneyBefore = w.total;
      if (sess && sess.moneyLast == null) sess.moneyLast = w.total;
      add(
        'htzone money',
        true,
        `before ₪${w.total}${w.obligo.length ? ` · ${w.obligo.length} wallet row(s)` : ''}`,
      );
    } catch (e: any) {
      add('htzone money', false, e?.message ?? String(e));
    }

    log('· discovering חנוכה / PRO shop items…');
    const discovered = await Promise.race([
      discoverItems(client, opts, add),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 45000)),
    ]);
    const items = discovered ?? [];
    if (!discovered) {
      add('items', false, 'discovery timed out — using the configured item');
    }
    if (!items.length) {
      add('items', false, 'nothing discovered — falling back to the configured item');
      const res = await runHanukka(client, { ...opts, freshLogin: false, log });
      steps.push(...res.steps);
      return res;
    }

    const exhausted = sess?.exhausted ?? new Set<string>();
    if (sess && !sess.exhausted) sess.exhausted = exhausted;

    const candidates: HanukkaCandidate[] = [];
    for (const it of items) {
      if (opts.onlyItem && it.id !== opts.onlyItem) continue;
      for (const v of it.variants) {
        if (v.max === 0) continue;
        if (exhausted.has(`${it.id}:${v.id}`)) continue;
        candidates.push({
          itemId: it.id,
          proj: it.proj,
          title: it.title,
          variantId: v.id,
          price: v.price,
          label: `${it.title}${v.desc ? ` · ${v.desc}` : ''}`,
          max: v.max,
          isProShop: it.isProShop,
        });
      }
    }
    candidates.sort((a, b) => b.price - a.price || a.itemId.localeCompare(b.itemId));

    if (!candidates.length) {
      add('candidates', false, 'all discovered items are exhausted');
      return { ok: false, steps, variants: [], error: 'every candidate hit its purchase/stock limit' };
    }
    add(
      'candidates',
      true,
      `${candidates.length} option(s) · ₪${candidates[0].price} → ₪${candidates[candidates.length - 1].price} (expensive → cheap)`,
    );

    for (const cand of candidates) {
      if (stopped()) {
        add('stopped', false, `cancelled before ${cand.itemId}`);
        return { ok: false, steps, variants: [], error: 'cancelled' };
      }
      log(`— try ${cand.isProShop ? 'PRO shop' : 'חנוכה'} ${cand.itemId} · ${cand.label} · ₪${cand.price} —`);

      // Prime the session cache so runHanukka does not refetch the item page.
      if (sess) {
        sess.proj = cand.proj;
        sess.item = cand.itemId;
        sess.title = cand.title;
        sess.variants = items.find((i) => i.id === cand.itemId && i.proj === cand.proj)?.variants;
        sess.allowance = cand.max;
      }

      const qty = Math.max(1, opts.qty);
      const res = await runHanukka(client, {
        ...opts,
        itemId: cand.itemId,
        proj: cand.proj,
        collected: String(cand.variantId),
        qty,
        session: sess,
        freshLogin: false,
        forceSessionRefresh: false,
        forceReload: false,
        log,
      });
      steps.push(...res.steps);

      if (res.ok) {
        add('switch', true, `ordered ${cand.itemId} · ${cand.label} · ₪${cand.price}`);
        let moneyAfter: number | undefined;
        let moneyDelta: number | undefined;
        try {
          const w = await client.appWallet();
          moneyAfter = w.total;
          const base = moneyBefore ?? sess?.moneyLast;
          if (base != null) {
            moneyDelta = w.total - base;
            add(
              'htzone money',
              moneyDelta !== 0,
              `₪${base} → ₪${w.total}${
                moneyDelta ? ` (${moneyDelta > 0 ? '+' : ''}${moneyDelta})` : ' — unchanged (an order only moves the wallet once it is paid)'
              }`,
            );
          } else {
            add('htzone money', true, `after ₪${w.total}`);
          }
          if (sess) sess.moneyLast = w.total;
        } catch (e: any) {
          add('htzone money', false, e?.message ?? String(e));
        }

        // Credits can post late; keep checking the Android app-API wallet in the
        // background without blocking the loop.
        const base = moneyAfter ?? moneyBefore;
        if (base != null) {
          let checks = 0;
          const tick = async () => {
            checks++;
            try {
              const w = await client.appWallet();
              if (w.total !== base) {
                log(`· htzone money (app API) ₪${base} → ₪${w.total}`);
              }
              if (sess) sess.moneyLast = w.total;
            } catch {
              /* ignore transient wallet errors */
            }
            if (checks < 12) setTimeout(tick, 15000);
          };
          setTimeout(tick, 5000);
        }
        return {
          ...res,
          steps,
          itemId: cand.itemId,
          variantId: cand.variantId,
          price: cand.price,
          moneyBefore,
          moneyAfter,
          moneyDelta,
        };
      }

      if (isLimitFailure(res)) {
        exhausted.add(`${cand.itemId}:${cand.variantId}`);
        add('limit', false, `${cand.itemId} · ${cand.label} — switching to the next item`);
        continue;
      }

      add('stop', false, res.error || 'non-limit failure');
      return { ...res, steps, itemId: cand.itemId, variantId: cand.variantId, price: cand.price };
    }

    add('limit', false, 'every candidate hit its purchase/stock limit');
    return { ok: false, steps, variants: [], error: 'every candidate hit its purchase/stock limit' };
  } catch (e: any) {
    add('error', false, e?.message ?? String(e));
    return { ok: false, steps, variants: [], error: e?.message ?? String(e) };
  }
}

/**
 * Headless preview: log in, discover the חנוכה + PRO shop items/variants, and
 * return them sorted most-expensive → cheapest. No cart, no order, no charge.
 */
export async function previewHanukkaCandidates(
  client: HtzClient,
  opts: HanukkaOptions,
): Promise<HanukkaCandidate[]> {
  const sess = opts.session;
  if (!sess?.loggedIn) {
    client.resetSession();
    await client.webLogin();
    if (sess) sess.loggedIn = true;
  }

  const items = await discoverItems(client, opts, () => {});
  const out: HanukkaCandidate[] = [];
  for (const it of items) {
    if (opts.onlyItem && it.id !== opts.onlyItem) continue;
    for (const v of it.variants) {
      if (v.max === 0) continue;
      out.push({
        itemId: it.id,
        proj: it.proj,
        title: it.title,
        variantId: v.id,
        price: v.price,
        label: `${it.title}${v.desc ? ` · ${v.desc}` : ''}`,
        max: v.max,
        isProShop: it.isProShop,
      });
    }
  }
  out.sort((a, b) => b.price - a.price || a.itemId.localeCompare(b.itemId));
  return out;
}
