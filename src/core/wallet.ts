/**
 * Generic product → cart → wallet-payment driver.
 *
 * Two product families live behind the same cart API:
 *
 *   wallet attractions  /wallet_attraction_item/<id>   cart kind "quick"
 *   catalogue products  /item/<id>                     cart kind "regular"
 *
 * The catalogue side requires a `variant_id` — the store answers
 * `422 variant_required / "יש לבחור דגם לפני ההוספה לסל"` when it is missing,
 * which is exactly why adding a product (or a שובר) from the app used to fail
 * while the same product added fine on the website.
 *
 * Payment then goes through the wallet balance:
 *   draft → POST /api/orders/pay/obligo → (fully covered) settle
 *                                        → (shortfall) payment-session → card
 */
import { HtzClient } from './api';

export type ProductRef = {
  kind: 'quick' | 'regular';
  id: number;
  title: string;
  /** member / card price of the cheapest in-stock model */
  price?: number;
  fullPrice?: number;
  image?: string;
  description?: string;
  /** the PDP's own wording for the purchase cap, e.g. "עד-4 שוברים בחודש" */
  limitNote?: string;
  variants: { id: number; price: number; label: string; max?: number; stock?: number; inStock?: boolean }[];
  /** the PDP's own per-order cap, used when a variant row carries no max */
  maxPurchase?: number;
  addressRequired: boolean;
  /**
   * The product page's own availability flag. Items without models (a TV, a
   * voucher with one SKU) have no `priceOptions`, and the app API often marks
   * them `stock_empty` — the website still sells them, so this wins.
   */
  available?: boolean;
  ctaKind?: string;
};

export type CartLine = {
  /** opaque cart key the store uses to update/remove a line */
  key: string;
  itemId: number;
  variantId: number | null;
  qty: number;
  price: number;
  title: string;
  /** set when the store refuses the line (sold out / sale ended) */
  invalid?: string;
};

export type CartWarning = { message: string };

export type DeliveryOption = {
  supplierId: number;
  id: number;
  label: string;
  price: number;
  usesAddress: boolean;
  needsPoint: boolean;
  type: string;
};

export type CartSummary = {
  kind: string;
  /** bumped by the store on every mutation; send it back or get 409 */
  version: number;
  lines: CartLine[];
  warnings: string[];
  units: number;
  total: number;
  addressRequired: boolean;
  deliveries: DeliveryOption[];
};

export type WalletPayResult = {
  ok: boolean;
  orderId?: number;
  total?: number;
  paid?: boolean;
  covered?: number;
  toPay?: number;
  cardUrl?: string;
  relocation?: string;
  error?: string;
  detail?: any;
};

/** `https://www.htzone.co.il/item/49464/...` or a bare id. */
export function parseProductRef(input: string): { kind: 'quick' | 'regular'; id: number } | null {
  const s = (input || '').trim();
  const wallet = s.match(/wallet_attraction_item\/(\d+)/);
  if (wallet) return { kind: 'quick', id: Number(wallet[1]) };
  const item = s.match(/\/item\/(\d+)/);
  if (item) return { kind: 'regular', id: Number(item[1]) };
  if (/^\d{3,}$/.test(s)) return { kind: 'regular', id: Number(s) };
  try {
    const u = new URL(s.startsWith('http') ? s : 'https://' + s);
    const m = u.pathname.match(/\/(\d{3,})/);
    if (m) return { kind: u.pathname.includes('wallet_attraction_item') ? 'quick' : 'regular', id: Number(m[1]) };
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * The flight payload escapes some labels one level too many
 * (`"תו קניה \\\"…\\\""`), which makes the whole array unparseable. Collapsing the
 * doubled backslashes restores valid JSON without touching anything else.
 */
function repairEscapes(slice: string): string {
  return slice.replace(/\\\\"/g, '\\"');
}

/** Balanced array → rows, tolerating both strict JSON and the broken escaping. */
function parseOptions(slice: string): any[] | null {
  for (const candidate of [slice, repairEscapes(slice)]) {
    try {
      const arr = JSON.parse(candidate);
      if (Array.isArray(arr)) return arr;
    } catch {
      /* try the repaired form / loose parser */
    }
  }
  const loose = looseOptions(repairEscapes(slice));
  return loose && loose.length ? loose : null;
}

/** Repair rows whose labels are double-escaped, so JSON.parse rejects them. */
function looseOptions(slice: string): any[] | null {
  const inner = slice.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (!inner) return null;
  const chunks = inner.split(/\},\s*\{/);
  const out: any[] = [];
  for (const chunk of chunks) {
    const s = chunk.startsWith('{') ? chunk : '{' + chunk;
    const id = s.match(/"id"\s*:\s*(\d+)/);
    if (!id) continue;
    const str = (key: string) => {
      const m = s.match(new RegExp('"' + key + '"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"'));
      return m ? m[1].replace(/\\(["\\])/g, '$1') : undefined;
    };
    const num = (key: string) => {
      const m = s.match(new RegExp('"' + key + '"\\s*:\\s*(\\d+)'));
      return m ? Number(m[1]) : undefined;
    };
    const o: any = { id: Number(id[1]) };
    const label = str('label') ?? str('desc') ?? str('title') ?? str('text');
    if (label !== undefined) {
      o.label = label;
      o.desc = label;
    }
    for (const k of ['price', 'statusPrice', 'maxPerOrder', 'maxQty', 'available']) {
      const v = num(k);
      if (v !== undefined) o[k] = v;
    }
    if (/"inStock"\s*:\s*true/.test(s)) o.inStock = true;
    else if (/"inStock"\s*:\s*false/.test(s)) o.inStock = false;
    out.push(o);
  }
  return out.length ? out : null;
}

/** Pull the balanced JSON array that follows `key` out of the flight payload. */
function arrayAfter(flat: string, key: string): any[] | null {
  let at = flat.indexOf(key);
  while (at >= 0) {
    // The value must actually be an array. Pages repeat the key (often first as
    // `"$undefined"` and later as the real rows), so scan every occurrence.
    let start = at + key.length;
    while (start < flat.length && /\s/.test(flat[start])) start++;
    if (flat[start] === '[') {
      let depth = 0;
      for (let i = start; i < flat.length && i < start + 40000; i++) {
        const ch = flat[i];
        if (ch === '[') depth++;
        else if (ch === ']') {
          depth--;
          if (depth === 0) {
            const parsed = parseOptions(flat.slice(start, i + 1));
            if (parsed) return parsed;
            break;
          }
        }
      }
    }
    at = flat.indexOf(key, at + key.length);
  }
  return null;
}

export function parseProductPage(ref: { kind: 'quick' | 'regular'; id: number }, html: string): ProductRef {
  const flat = html.replace(/\\"/g, '"');
  const variants: ProductRef['variants'] = [];

  // `collectedOptions` are the concrete SKUs (e.g. colour/handset variants).
  // The website makes you pick one and sends its id as `variant_id`; a product
  // added without it is dropped from the cart as unavailable.
  for (const key of ['"priceOptions":', '"collectedOptions":', '"variants":']) {
    const arr = arrayAfter(flat, key);
    if (!arr) continue;
    for (const v of arr) {
      const id = Number(v.id ?? v.variantId ?? 0);
      if (!id || variants.some((x) => x.id === id)) continue;
      const label = String(v.label ?? v.desc ?? v.title ?? v.text ?? '');
      const price = Number(v.statusPrice ?? v.price ?? v.htzCard ?? 0);
      if (!label && !price) continue;
      variants.push({
        id,
        price,
        label,
        max: v.maxPerOrder != null ? Number(v.maxPerOrder) : v.max != null ? Number(v.max) : v.maxQty != null ? Number(v.maxQty) : v.available != null ? Number(v.available) : undefined,
        inStock: v.inStock === undefined ? undefined : v.inStock !== false,
      });
    }
    if (variants.length) break;
  }

  const title =
    (flat.match(/"seo":\{"title":"((?:\\.|[^"\\]){2,160})"/) || [])[1] ||
    (flat.match(/"title":"((?:\\.|[^"\\]){2,120})"/) || [])[1] ||
    (html.match(/<title[^>]*>([\s\S]{0,120}?)<\/title>/i) || [])[1]?.trim() ||
    String(ref.id);

  // `maxPurchase` is the PDP-level cap; it is the only max some products expose.
  const maxPurchase = Number((flat.match(/"maxPurchase"\s*:\s*(\d+)/) || [])[1] ?? 0) || undefined;
  for (const v of variants) {
    if (v.max == null && maxPurchase) v.max = maxPurchase;
  }

  const priced = variants.filter((v) => v.price > 0).map((v) => v.price);

  // Availability and a price for variant-less products live outside the option
  // arrays: `isAvailable` / `ctaKind` / `sf.price`.
  const availMatch = flat.match(/"isAvailable"\s*:\s*(true|false)/);
  const available = availMatch ? availMatch[1] === 'true' : undefined;
  const ctaKind = (flat.match(/"ctaKind"\s*:\s*"([a-z_]+)"/) || [])[1];
  const flatPrice =
    Number((flat.match(/"sf"\s*:\s*\{[^}]*?"price"\s*:\s*(\d+)/) || [])[1] ?? 0) ||
    Number((flat.match(/"item"\s*:\s*\{[^}]*?"price"\s*:\s*(\d+)/) || [])[1] ?? 0) ||
    0;
  const image =
    (flat.match(/"ogImage":"([^"]+)"/) || [])[1] ||
    (flat.match(/"main_media[^"]*":"(https?:[^"]+)"/) || [])[1] ||
    (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || [])[1] ||
    '';
  const description = ((flat.match(/"seo":\{[^}]*"description":"((?:\\.|[^"\\])*)"/) || [])[1] || '')
    .replace(/\\(["\\])/g, '$1')
    .replace(/^\u2026|\.\.\./, '')
    .trim();
  const limitNote = ((flat.match(/"purchaseLimitNote":"((?:\\.|[^"\\])*)"/) || [])[1] || '').replace(/\\(["\\])/g, '$1');

  return {
    kind: ref.kind,
    id: ref.id,
    title: title.replace(/\\(["\\])/g, '$1').trim(),
    price: priced.length ? Math.min(...priced) : flatPrice || undefined,
    fullPrice: Number((flat.match(/"fullPrice"\s*:\s*(\d+)/) || [])[1] ?? 0) || undefined,
    image,
    description,
    limitNote,
    variants,
    available,
    ctaKind,
    maxPurchase,
    addressRequired: /"addressRequired":true/.test(flat),
  };
}

export async function readProduct(client: HtzClient, input: string): Promise<ProductRef> {
  const ref = parseProductRef(input);
  if (!ref) throw new Error('could not read a product id from that URL');
  const path = ref.kind === 'quick' ? `/wallet_attraction_item/${ref.id}` : `/item/${ref.id}`;
  const html = await client.webGet(path);
  return parseProductPage(ref, html);
}

/**
 * Read the models from the PDP the app actually uses (`/webview/<id>`), with the
 * legacy item page as a fallback. This is what makes products with colour/SKU
 * options resolvable before adding (otherwise the store answers "choose a model").
 */
export async function readProductWebview(
  client: HtzClient,
  input: string | number,
  kind?: 'quick' | 'regular',
): Promise<ProductRef> {
  const s = String(input);
  const parsed = parseProductRef(s);
  const id = parsed?.id ?? Number(s);
  if (!id) throw new Error('could not read a product id');
  const k = kind ?? parsed?.kind ?? 'regular';

  // Cloudflare sometimes answers with a challenge page instead of the PDP; it
  // used to be read as "no product / sold out". Retry, then say so plainly.
  const challenged = (html: string) => /Just a moment|cf-chl|challenge-platform/i.test(html) && html.length < 20000;
  const fetchPage = async (path: string): Promise<string> => {
    let html = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      html = await client.webGet(path);
      if (!challenged(html)) return html;
      await new Promise((r) => setTimeout(r, 900 + attempt * 1200));
    }
    throw new Error('the store is challenging requests right now — try again in a minute');
  };

  const first = parseProductPage({ kind: k, id }, await fetchPage(`/webview/${id}`));
  if (first.variants.length || first.available) return first;
  const path = k === 'quick' ? `/wallet_attraction_item/${id}` : `/item/${id}/`;
  const alt = await fetchPage(path);
  return parseProductPage({ kind: k, id }, alt);
}

export type AddResult = {
  ok: boolean;
  error?: string;
  /** store error code (`purchase_limit_reached`, `variant_required`, …) */
  code?: string;
  /** per-order cap the store reported with the refusal */
  limit?: number;
  remaining?: number;
};

function addFailure(res: { status: number; json: any }): AddResult {
  const e = res?.json?.error;
  const d = e?.details || {};
  return {
    ok: false,
    code: e?.code,
    limit: d.limit != null ? Number(d.limit) : d.max_purchase != null ? Number(d.max_purchase) : undefined,
    remaining: d.remaining != null ? Number(d.remaining) : undefined,
    error: HtzClient.apiError(res),
  };
}

/** Hebrew wording for a refusal, so the UI never shows a raw API code. */
export function addErrorText(res: AddResult): string {
  if (res.code === 'purchase_limit_reached') {
    return res.limit
      ? `הגעת למכסת הרכישה של מוצר זה (${res.limit})`
      : 'הגעת למכסת הרכישה של מוצר זה';
  }
  // Hitting the per-order cap is the other half of the same wall: this one is
  // about quantity in this cart, the one above about lifetime purchases.
  if (res.code === 'over_purchase_limit') {
    return res.limit
      ? `הגעת לכמות המקסימלית לרכישה של מוצר זה (עד ${res.limit})`
      : 'הגעת לכמות המקסימלית לרכישה של מוצר זה';
  }
  if (res.code === 'variant_required') return 'יש לבחור דגם לפני ההוספה לסל';
  if (res.code === 'out_of_stock' || res.code === 'sold_out') return 'המוצר אזל מהמלאי';
  if (res.code === 'sale_ended') return 'המכירה הסתיימה';
  return res.error ?? 'ההוספה לסל נכשלה';
}

export async function addToCart(
  client: HtzClient,
  opts: { kind: 'quick' | 'regular'; id: number; qty: number; variantId?: number; itemType?: number },
): Promise<AddResult> {
  const webAdd = async (): Promise<AddResult> => {
    try {
      await client.ensureWebSession();
      const body = {
        kind: opts.kind,
        product_id: opts.id,
        quantity: opts.qty,
        ...(opts.variantId ? { variant_id: opts.variantId } : {}),
      };
      const res = await client.webApi('POST', '/api/cart/items', body);
      if (res.status < 400 && !res.json?.error) return { ok: true };

      // The store asks for a model before adding. Resolve it from the PDP and
      // retry once instead of surfacing "יש לבחור דגם".
      if (res.json?.error?.code === 'variant_required' && !opts.variantId) {
        try {
          const ref = await readProductWebview(client, opts.id, opts.kind);
          const pick = ref.variants.find((v) => v.inStock !== false)?.id;
          if (pick) {
            const retry = await client.webApi('POST', '/api/cart/items', { ...body, variant_id: pick });
            if (retry.status < 400 && !retry.json?.error) return { ok: true };
            return addFailure(retry);
          }
        } catch {
          /* report the original error */
        }
      }

      return addFailure(res);
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  };

  // The website cart is the reference: it carries an explicit quantity and it
  // enforces the store's per-order caps. The native add is only a fallback for
  // items the website refuses to place in the cart at all.
  const web = await webAdd();
  if (web.ok) return web;

  const storeSaidNo = ['over_purchase_limit', 'purchase_limit_reached', 'cart_empty', 'unauthenticated', 'variant_required'].includes(
    String(web.code ?? ''),
  );
  if (storeSaidNo) return web;

  try {
    const collected = opts.variantId ? [{ id: opts.variantId, quantity: opts.qty }] : undefined;
    const data = await client.appAddToCart({
      itemId: opts.id,
      itemType: opts.itemType ?? 1,
      isQuick: opts.kind === 'quick' ? 1 : 0,
      ...(collected ? { collectedIds: collected } : {}),
    });
    const popup = data?.popupObject;
    const extra = data?.required_additional_fields;
    if ((popup && typeof popup === 'object' && Object.keys(popup).length > 0) ||
        (extra && typeof extra === 'object' && Object.keys(extra).length > 0)) {
      return web;
    }
    return { ok: true };
  } catch (e: any) {
    // Native add rejects webview-only / lead-style items too — report the
    // website's error, it is the clearer one.
    return web;
  }
}

const num = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const pick = (o: any, ...keys: string[]): any => {
  for (const k of keys) if (o?.[k] !== undefined && o?.[k] !== null) return o[k];
  return undefined;
};

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();

const asList = (v: unknown): any[] =>
  Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v as Record<string, any>) : [];

export async function readCart(client: HtzClient, kind: 'quick' | 'regular'): Promise<CartSummary> {
  const res = await client.webApi('GET', `/api/cart?kind=${kind}`);
  const d = res.json?.data || {};
  const cartKind = String(d.kind || kind);
  const deliveries: DeliveryOption[] = [];
  for (const sup of (d.checkout?.suppliers || []) as any[]) {
    for (const o of (sup.deliveryOptions || sup.delivery?.options || []) as any[]) {
      deliveries.push({
        supplierId: num(pick(sup, 'supplierId', 'supplier_id')),
        id: num(o.id),
        label: String(o.label ?? ''),
        price: num(o.price),
        usesAddress: !!pick(o, 'usesAddress', 'uses_address'),
        needsPoint: !!pick(o, 'needsPoint', 'needs_point'),
        type: String(o.type ?? ''),
      });
    }
  }
  return {
    kind: cartKind,
    version: num(pick(d, 'version', 'cartVersion', 'cart_version')),
    lines: ((d.lines || []) as any[]).map((l) => ({
      key: String(pick(l, 'key', 'lineKey', 'line_key', 'itemKey', 'item_key', 'id') ?? ''),
      itemId: num(pick(l, 'itemId', 'item_id', 'product_id')),
      variantId: pick(l, 'variantId', 'variant_id') != null ? num(pick(l, 'variantId', 'variant_id')) : null,
      qty: num(pick(l, 'qty', 'quantity', 'totalItems', 'total_items')),
      price: num(pick(l, 'price', 'itemPrice', 'item_price')),
      title: String(pick(l, 'title', 'itemTitle', 'item_title') ?? ''),
      invalid:
        text(pick(l, 'invalid_message', 'invalidMessage', 'invalid_reason', 'removed_message', 'removedReason')) ||
        undefined,
    })),
    units: num(pick(d.checkout, 'units') ?? pick(d, 'count', 'count_items', 'total_items')),
    total: num(d.total || d.checkout?.totalSum || d.checkout?.total_sum),
    addressRequired: !!(d.checkout?.addressRequired ?? d.checkout?.address_required),
    warnings: [d.warnings, d.notices, d.messages, d.removed_items, d.removedItems]
      .flatMap(asList)
      .map((w) => (typeof w === 'string' ? w : text(w?.message ?? w?.text ?? w?.title ?? w?.reason)))
      .filter(Boolean),
    deliveries,
  };
}

/** The native cart, normalized to the shape the screens already use. */
export async function readNativeCart(client: HtzClient): Promise<CartSummary> {
  const data = await client.appGetCart();
  const lines: CartLine[] = asList(data?.itemsArr)
    .map((l) => ({
      key: text(pick(l, 'item_key', 'itemKey', 'id')),
      itemId: num(pick(l, 'item_id', 'itemId')),
      variantId:
        pick(l, 'item_collected_id', 'collected_id', 'itemCollectedId') != null
          ? num(pick(l, 'item_collected_id', 'collected_id', 'itemCollectedId'))
          : null,
      qty: num(pick(l, 'total_items', 'totalItems', 'quantity')),
      price: num(pick(l, 'item_price', 'itemPrice', 'price')),
      title: text(pick(l, 'item_title', 'itemTitle', 'title')),
      invalid: text(pick(l, 'invalid_message', 'invalidMessage')) || undefined,
    }))
    .filter((l) => l.itemId > 0);

  return {
    kind: 'regular',
    version: 0,
    lines,
    warnings: [],
    units: num(pick(data, 'total_items', 'totalItems')),
    total: num(pick(data, 'total')),
    addressRequired: false,
    deliveries: [],
  };
}

/** Merge lines that only exist in the Android cart into the web view. */
export function mergeCarts(
  web: CartSummary | null,
  native: CartSummary | null,
): CartSummary | null {
  if (!web) return native;
  if (!native) return web;
  const keyOf = (l: CartLine) => `${l.itemId}:${l.variantId ?? ''}`;
  const seen = new Set(web.lines.map(keyOf));
  const extra = native.lines.filter((l) => !seen.has(keyOf(l)));
  if (!extra.length) return web;
  return {
    ...web,
    lines: [...web.lines, ...extra],
    units: web.units + extra.reduce((s, l) => s + l.qty, 0),
    total: web.total + extra.reduce((s, l) => s + l.price * l.qty, 0),
  };
}

/**
 * Confirm the store kept the line after a native add.
 *
 * The Android cart is authoritative for API-added items; the web cart is a
 * second opinion. Either may carry the store's `invalid_message`.
 */
export async function verifyAddedItem(
  client: HtzClient,
  kind: 'quick' | 'regular',
  itemId: number,
  variantId?: number,
): Promise<{ ok: boolean; error?: string }> {
  const matches = (l: CartLine) =>
    l.itemId === itemId && (variantId == null ? true : l.variantId == null || l.variantId === variantId);

  let readable = false;
  let sawLines = false;

  try {
    const native = await readNativeCart(client);
    readable = true;
    sawLines = sawLines || native.lines.length > 0;
    const line = native.lines.find(matches);
    if (line) return line.invalid ? { ok: false, error: line.invalid } : { ok: true };
  } catch {
    /* fall through to the web cart */
  }

  try {
    const web = await readCart(client, kind);
    readable = true;
    sawLines = sawLines || web.lines.length > 0;
    const line = web.lines.find(matches);
    if (line) return line.invalid ? { ok: false, error: line.invalid } : { ok: true };
    if (web.warnings.length) return { ok: false, error: web.warnings[0] };
  } catch {
    /* unreadable cart */
  }

  // Nothing readable is not proof of failure: the add call itself succeeded.
  if (!readable || !sawLines) return { ok: true };

  return { ok: false, error: 'the store did not keep this item (sale ended or out of stock)' };
}

/**
 * Cart mutations carry the version from the last cart read; the store answers
 * 409 `cart_version_conflict` when another tab moved first. Retrying once with
 * the version it reports is what the website itself does.
 */
async function cartWrite(
  client: HtzClient,
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body: Record<string, any>,
  version?: number,
): Promise<{ status: number; json: any }> {
  const send = (v?: number) => client.webApi(method, path, { ...body, ...(v ? { version: v } : {}) });
  let res = await send(version);
  if (res.status === 409 && res.json?.error?.code === 'cart_version_conflict') {
    const current = num(pick(res.json?.error?.details, 'current_version', 'currentVersion'));
    res = await send(current || version);
  }
  return res;
}

function cartError(res: { status: number; json: any }): string {
  const code = res.json?.error?.code;
  const det = res.json?.error?.details || {};
  if (code === 'variant_required') return 'this product needs a model — pick a variant id and add again';
  if (code === 'purchase_limit_reached')
    return `purchase limit reached (limit ${det.limit ?? '?'}, remaining ${det.remaining ?? 0})`;
  if (code === 'cart_empty') return 'the cart is empty';
  if (code === 'cart_version_conflict') return 'the cart changed elsewhere — reload and try again';
  return HtzClient.apiError(res);
}

/** Change the quantity of an existing line (0 removes it). */
export async function setCartQty(
  client: HtzClient,
  kind: 'quick' | 'regular',
  line: { key: string; itemId: number; variantId: number | null; qty?: number; itemType?: number },
  qty: number,
  version?: number,
): Promise<{ ok: boolean; error?: string }> {
  const res = line.key
    ? await cartWrite(client, 'POST', '/api/cart/quantity', { kind, item_key: line.key, quantity: qty }, version)
    : await cartWrite(
        client,
        'PUT',
        '/api/cart/items',
        { kind, product_id: line.itemId, quantity: qty, ...(line.variantId ? { variant_id: line.variantId } : {}) },
        version,
      );
  if (res.status < 400 && !res.json?.error) return { ok: true };

  // The line may live only in the Android cart: remove it and add the new qty.
  if (line.key) {
    try {
      await client.appRemoveFromCart(line.key);
      const collected = line.variantId ? [{ id: line.variantId, quantity: qty }] : undefined;
      await client.appAddToCart({
        itemId: line.itemId,
        itemType: line.itemType ?? 1,
        isQuick: kind === 'quick' ? 1 : 0,
        ...(collected ? { collectedIds: collected } : {}),
      });
      return { ok: true };
    } catch (e: any) {
      // Try to put the previous quantity back rather than losing the line.
      try {
        const collected = line.variantId ? [{ id: line.variantId, quantity: line.qty ?? 1 }] : undefined;
        await client.appAddToCart({
          itemId: line.itemId,
          itemType: line.itemType ?? 1,
          isQuick: kind === 'quick' ? 1 : 0,
          ...(collected ? { collectedIds: collected } : {}),
        });
      } catch {
        /* nothing else to try */
      }
      return { ok: false, error: e?.message ?? String(e) };
    }
  }

  return { ok: false, error: cartError(res) };
}

/** Drop a line entirely. */
export async function removeCartLine(
  client: HtzClient,
  kind: 'quick' | 'regular',
  line: { key: string; itemId: number; variantId: number | null },
  version?: number,
): Promise<{ ok: boolean; error?: string }> {
  if (!line.key) {
    return { ok: false, error: 'this line has no cart key — reload the cart and try again' };
  }
  // Native first: lines added through the Android API live there.
  try {
    await client.appRemoveFromCart(line.key);
    return { ok: true };
  } catch {
    /* not a native line — fall back to the web cart */
  }
  const res = await cartWrite(
    client,
    'DELETE',
    `/api/cart/items?key=${encodeURIComponent(line.key)}`,
    { kind },
    version,
  );
  if (res.status >= 400 || res.json?.error) return { ok: false, error: cartError(res) };
  return { ok: true };
}

/** Wallet balance straight from the Android API (`getUserWallet`). */
export async function readWallet(
  client: HtzClient,
): Promise<{ ok: boolean; total: number; obligo: any[]; error?: string }> {
  try {
    const data = await client.appWallet();
    return { ok: true, total: data.total, obligo: data.obligo };
  } catch (e: any) {
    return { ok: false, total: 0, obligo: [], error: e?.message ?? String(e) };
  }
}

export type NativeCheckoutResult = {
  ok: boolean;
  orderId?: number;
  /** wallet amount sent as `obligo_sum` */
  walletUsed?: number;
  code?: 'no_credit' | 'limit' | 'other';
  error?: string;
};

/**
 * "בצע הזמנה" — checkout the native cart (the app's own submit).
 *
 * The APK sends `data.obligo_sum` = how much of הארנק שלי to spend, so the
 * balance is applied before any card. With no card and no credit the store
 * answers `152 אופס.. פרמטר חסר` with `extra: "no credit"` — that is the
 * card-required signal, not a malformed request.
 */
export async function checkoutNativeCart(
  client: HtzClient,
  opts: { phone: string; obligoSum?: number; isQuick?: 0 | 1; numberOfPayments?: number },
): Promise<NativeCheckoutResult> {
  const wallet = await client.appWallet().catch(() => null);
  const obligoSum = opts.obligoSum ?? wallet?.total ?? 0;
  const res = await client.appSubmitOrder({
    obligoSum,
    isQuick: opts.isQuick ?? 0,
    phone: opts.phone,
    numberOfPayments: opts.numberOfPayments ?? 1,
  });
  if (res.ok) return { ok: true, orderId: res.orderId, walletUsed: obligoSum };

  // Report the store's own wording verbatim — the app shows exactly this, and
  // replacing it hides which condition the store actually hit.
  return {
    ok: false,
    code: String(res.extra ?? '') === 'no credit' ? 'no_credit' : /limit|מכס|מלאי|אזל/i.test(String(res.error)) ? 'limit' : 'other',
    walletUsed: 0,
    error: res.error ?? 'אופס.. פרמטר חסר',
  };
}

/** The store needs a delivery choice per supplier before it will draft. */
export async function setDelivery(
  client: HtzClient,
  kind: 'quick' | 'regular',
  selections: { supplier_id: number; delivery_link_id: number }[],
  version?: number,
): Promise<{ ok: boolean; error?: string }> {
  const res = await cartWrite(client, 'POST', '/api/cart/delivery', { kind, selections }, version);
  if (res.status >= 400 || res.json?.error) return { ok: false, error: cartError(res) };
  return { ok: true };
}

export async function clearCart(client: HtzClient, kind: 'quick' | 'regular', version?: number): Promise<void> {
  await cartWrite(client, 'DELETE', `/api/cart?kind=${kind}`, {}, version);
  // Also clear lines that only exist in the Android cart.
  try {
    const native = await readNativeCart(client);
    for (const line of native.lines) await client.appRemoveFromCart(line.key).catch(() => {});
  } catch {
    /* nothing native to clear */
  }
}

/**
 * Pay an existing draft from the wallet balance.
 *
 * `pay/obligo` tells us how much of the total the balance covers. When it
 * covers everything, `settle` completes the order without a card. Otherwise the
 * remainder has to be paid by card, and we hand back the PPS link.
 */
export async function payFromWallet(
  client: HtzClient,
  opts: {
    kind: 'quick' | 'regular';
    name: string;
    phone: string;
    email: string;
    address?: { address: string; city: string };
    delivery?: { supplier_id: number; delivery_link_id: number }[];
    version?: number;
  },
): Promise<WalletPayResult> {
  if (opts.delivery && opts.delivery.length) {
    const set = await setDelivery(client, opts.kind, opts.delivery, opts.version);
    if (!set.ok) return { ok: false, error: 'delivery: ' + (set.error || 'rejected') };
  }

  const draft = await client.webApi('POST', '/api/orders/draft', {
    cart: opts.kind,
    shipping: {
      name: opts.name,
      phone: opts.phone,
      email: opts.email,
      ...(opts.address ?? {}),
    },
    new_card: true,
  });

  if (draft.status === 409 && draft.json?.error?.code === 'cart_checkout_in_progress') {
    const existing = Number(draft.json?.error?.details?.order_id || 0);
    if (!existing) return { ok: false, error: 'a checkout is already open but its order id was not returned', detail: draft.json };
    return finishExisting(client, existing);
  }
  if (draft.status >= 400 || draft.json?.error) {
    return { ok: false, error: HtzClient.apiError(draft), detail: draft.json };
  }

  const orderId = Number(draft.json?.data?.id || 0);
  const total = Number(draft.json?.data?.totals?.total ?? 0);
  if (!orderId) return { ok: false, error: 'draft returned no order id', detail: draft.json };

  return finishExisting(client, orderId, total);
}

async function finishExisting(client: HtzClient, orderId: number, totalHint?: number): Promise<WalletPayResult> {
  const obligo = await client.webApi('POST', '/api/orders/pay/obligo', { order_id: orderId });
  const od = obligo.json?.data || {};
  const covered = Number(od.total_obligo ?? 0);
  const toPay = Number(od.to_pay ?? totalHint ?? 0);
  const total = totalHint ?? covered + toPay;

  if (od.fully_covered === true) {
    // The store applies the wallet balance through this same call with `use`,
    // then `settle` closes the order. Reading it without the flag only prices it.
    const applied = await client.webApi('POST', '/api/orders/pay/obligo', { order_id: orderId, use: true });
    if (applied.status >= 400 || applied.json?.error) {
      return {
        ok: false,
        orderId,
        total,
        covered,
        toPay,
        error: 'wallet: ' + HtzClient.apiError(applied),
        detail: applied.json,
      };
    }
    const settle = await client.webApi('POST', '/api/orders/settle', { order_id: orderId });
    const sd = settle.json?.data || {};
    if (settle.status < 400 && !settle.json?.error) {
      return {
        ok: true,
        orderId,
        total,
        covered,
        toPay: 0,
        paid: true,
        relocation: sd.relocation ? String(sd.relocation) : undefined,
        detail: settle.json,
      };
    }
    return { ok: false, orderId, total, covered, toPay, error: HtzClient.apiError(settle), detail: settle.json };
  }

  const ps = await client.webApi('POST', '/api/orders/payment-session', { order_id: orderId });
  const pd = ps.json?.data || {};
  if (ps.status >= 400 || ps.json?.error) {
    return { ok: false, orderId, total, covered, toPay, error: HtzClient.apiError(ps), detail: ps.json };
  }
  return {
    ok: true,
    orderId,
    total,
    covered,
    toPay,
    paid: false,
    cardUrl: pd.payment_url ? String(pd.payment_url) : undefined,
    detail: ps.json,
  };
}
