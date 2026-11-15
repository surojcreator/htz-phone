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

export const HANUKKA_GROUP = '156';
export const HANUKKA_DEFAULT_ITEM = '166122';
export const HANUKKA_ITEMS = [
  { id: '166122', label: 'חנוכה 2026 · 166122' },
  { id: '166119', label: 'חנוכה 2026 · 166119' },
];

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
  /** Ignore the cache and reload the item page once. */
  forceReload?: boolean;
  shouldStop?: () => boolean;
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
};

export function newHanukkaSession(): HanukkaSession {
  return { loggedIn: false };
}

export type HanukkaResult = {
  ok: boolean;
  steps: Step[];
  variants: Variant[];
  payload?: string;
  relocation?: string;
  cardUrl?: string;
  orderId?: number;
  total?: number;
  units?: number;
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
    const at = flat.indexOf(key);
    if (at < 0) return null;
    const start = flat.indexOf('[', at + key.length);
    if (start < 0) return null;
    let depth = 0;
    for (let i = start; i < flat.length && i < start + 20000; i++) {
      const ch = flat[i];
      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) {
          try {
            const arr = JSON.parse(flat.slice(start, i + 1));
            return Array.isArray(arr) ? arr : null;
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  };

  // The product's own rows: id / desc / price / statusPrice / maxPerOrder.
  // This is authoritative — `variants` elsewhere on the page can belong to a
  // recommended item, which is how a ₪169 ticket got shown as ₪58.
  const options = arrayAfter('"priceOptions":');
  if (options) {
    for (const v of options) {
      const id = Number(v.id ?? v.variantId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        price: Number(v.statusPrice ?? v.price ?? 0),
        desc: String(v.desc ?? v.title ?? ''),
        fullPrice: v.fullPrice != null ? Number(v.fullPrice) : undefined,
        max: v.maxPerOrder != null ? Number(v.maxPerOrder) : v.available != null ? Number(v.available) : undefined,
      });
    }
    if (out.length) return out;
  }

  const variants = arrayAfter('"variants":');
  if (variants) {
    for (const v of variants) {
      const id = Number(v.variantId ?? v.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        price: Number(v.statusPrice ?? v.price ?? 0),
        desc: String(v.title ?? v.text ?? ''),
        fullPrice: v.fullPrice != null ? Number(v.fullPrice) : undefined,
        max: v.max != null ? Number(v.max) : undefined,
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
    if (sessionReady) {
      add('web login', true, `reused session (${client.email})`);
    } else {
      await client.ensureWebSession();
      if (sess) sess.loggedIn = true;
      add('web login', true, client.email);
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
      const html = await client.webGet(`/wallet_attraction_item/${item}?proj_id=${proj}`);
      if (/אין לך זכאות/.test(html)) {
        add('eligibility', false, 'PRO² gate closed — this account has no shop eligibility');
        return { ok: false, steps, variants: [], error: 'no PRO² eligibility on this account' };
      }
      variants = parseVariants(html);
      title = text((html.match(/"title":"([^"]{0,120})"/) || [])[1] || '');
      if (!variants.length) {
        add('item page', false, `no variants found (${html.length} B)`);
        return { ok: false, steps, variants: [], error: 'item page did not expose any variants' };
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
    const cleared = await client.webApi('DELETE', '/api/cart?kind=quick');
    if (cleared.status >= 400) {
      add('cart clear', false, HtzClient.apiError(cleared));
      return { ok: false, steps, variants, error: HtzClient.apiError(cleared) };
    }

    let units = 0;
    for (const l of wanted) {
      const res = await client.webApi('POST', '/api/cart/items', {
        kind: 'quick',
        product_id: Number(item),
        quantity: l.qty,
        variant_id: l.id,
      });
      if (res.status >= 400 || res.json?.error) {
        const detail = HtzClient.apiError(res);
        add('cart add', false, `${l.id}×${l.qty}: ${detail}`);
        return { ok: false, steps, variants, error: detail };
      }
      units += l.qty;
    }

    const cart = await client.webApi('GET', '/api/cart?kind=quick');
    const cdata = cart.json?.data || {};
    const cartLines = (cdata.lines || []) as any[];
    const total = Number(cdata.total || cdata.checkout?.totalSum || 0);
    const cartUnits = Number(cdata.checkout?.units ?? cdata.count ?? units);
    if (!cartLines.length) {
      add('cart add', false, 'cart is empty after adding (stock / per-member limit)');
      return { ok: false, steps, variants, error: 'cart stayed empty — per-member limit reached' };
    }
    add('cart add', true, `${cartUnits} unit(s) · ₪${total}`);

    const draftBody = {
      cart: 'quick',
      shipping: { name: buyerName, phone: opts.phone, email: buyerEmail },
      new_card: true,
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

    // ---- draft ---------------------------------------------------------
    const draft = await client.webApi('POST', '/api/orders/draft', draftBody);
    if (draft.status >= 400 || draft.json?.error) {
      const detail = HtzClient.apiError(draft);
      add('order draft', false, detail);
      return { ok: false, steps, variants, payload: preview, error: detail, raw: draft.json };
    }
    const orderId = Number(draft.json?.data?.id || 0);
    const draftTotal = Number(draft.json?.data?.totals?.total ?? total);
    add('order draft', true, `order ${orderId} · ₪${draftTotal}${draft.json?.data?.payment?.card_required ? ' · card required' : ''}`);
    if (stopped()) return abort('payment session');

    // ---- payment session (card entry) ----------------------------------
    const pay = await client.webApi('POST', '/api/orders/payment-session', { order_id: orderId });
    const verdict = interpretPayResponse(pay.json);
    if (!verdict.ok) {
      const detail = verdict.error || HtzClient.apiError(pay);
      add('payment', false, detail.slice(0, 160));
      return { ok: false, steps, variants, payload: preview, orderId, total: draftTotal, error: detail, raw: pay.json };
    }
    if (verdict.relocation) {
      add('payment', true, `next → ${verdict.relocation}`);
      return { ok: true, steps, variants, payload: preview, orderId, total: draftTotal, relocation: verdict.relocation, raw: pay.json };
    }
    add('payment', true, 'order staged — card entry required');
    if (verdict.cardUrl) log(`CARD PAYMENT REQUIRED -> ${verdict.cardUrl}`);
    return {
      ok: true,
      steps,
      variants,
      payload: preview,
      orderId,
      total: draftTotal,
      units: cartUnits,
      cardUrl: verdict.cardUrl,
      raw: pay.json,
    };
  } catch (e: any) {
    add('error', false, e?.message ?? String(e));
    return { ok: false, steps, variants: [], error: e?.message ?? String(e) };
  }
}
