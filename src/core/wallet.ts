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
  variants: { id: number; price: number; label: string; max?: number }[];
  addressRequired: boolean;
};

export type CartLine = {
  itemId: number;
  variantId: number | null;
  qty: number;
  price: number;
  title: string;
};

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
  lines: CartLine[];
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

/** Pull the balanced JSON array that follows `key` out of the flight payload. */
function arrayAfter(flat: string, key: string): any[] | null {
  const at = flat.indexOf(key);
  if (at < 0) return null;
  const start = flat.indexOf('[', at + key.length);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < flat.length && i < start + 40000; i++) {
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
}

export function parseProductPage(ref: { kind: 'quick' | 'regular'; id: number }, html: string): ProductRef {
  const flat = html.replace(/\\"/g, '"');
  const variants: ProductRef['variants'] = [];

  for (const key of ['"priceOptions":', '"variants":']) {
    const arr = arrayAfter(flat, key);
    if (!arr) continue;
    for (const v of arr) {
      const id = Number(v.id ?? v.variantId ?? 0);
      if (!id || variants.some((x) => x.id === id)) continue;
      variants.push({
        id,
        price: Number(v.statusPrice ?? v.price ?? 0),
        label: String(v.desc ?? v.title ?? v.text ?? ''),
        max: v.maxPerOrder != null ? Number(v.maxPerOrder) : v.max != null ? Number(v.max) : undefined,
      });
    }
    if (variants.length) break;
  }

  const title =
    (html.match(/"title":"([^"]{2,120})"/) || [])[1] ||
    (html.match(/<title[^>]*>([\s\S]{0,120}?)<\/title>/i) || [])[1]?.trim() ||
    String(ref.id);

  return {
    kind: ref.kind,
    id: ref.id,
    title,
    variants,
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

export async function addToCart(
  client: HtzClient,
  opts: { kind: 'quick' | 'regular'; id: number; qty: number; variantId?: number },
): Promise<{ ok: boolean; error?: string }> {
  const body: Record<string, any> = {
    kind: opts.kind,
    product_id: opts.id,
    quantity: opts.qty,
    ...(opts.variantId ? { variant_id: opts.variantId } : {}),
  };
  const res = await client.webApi('POST', '/api/cart/items', body);
  if (res.status === 422) {
    const code = res.json?.error?.code;
    const det = res.json?.error?.details || {};
    if (code === 'variant_required') {
      return { ok: false, error: 'this product needs a model — pick a variant id and add again' };
    }
    if (code === 'purchase_limit_reached') {
      return {
        ok: false,
        error: `purchase limit reached for this product (limit ${det.limit ?? '?'}, remaining ${det.remaining ?? 0})`,
      };
    }
    if (code === 'cart_empty') return { ok: false, error: 'the cart is empty' };
  }
  if (res.status >= 400 || res.json?.error) return { ok: false, error: HtzClient.apiError(res) };
  return { ok: true };
}

export async function readCart(client: HtzClient, kind: 'quick' | 'regular'): Promise<CartSummary> {
  const res = await client.webApi('GET', `/api/cart?kind=${kind}`);
  const d = res.json?.data || {};
  const cartKind = String(d.kind || kind);
  const deliveries: DeliveryOption[] = [];
  for (const sup of (d.checkout?.suppliers || []) as any[]) {
    for (const o of (sup.deliveryOptions || sup.delivery?.options || []) as any[]) {
      deliveries.push({
        supplierId: Number(sup.supplierId),
        id: Number(o.id),
        label: String(o.label ?? ''),
        price: Number(o.price ?? 0),
        usesAddress: !!o.usesAddress,
        needsPoint: !!o.needsPoint,
        type: String(o.type ?? ''),
      });
    }
  }
  return {
    kind: cartKind,
    lines: (d.lines || []).map((l: any) => ({
      itemId: Number(l.itemId),
      variantId: l.variantId != null ? Number(l.variantId) : null,
      qty: Number(l.qty ?? 0),
      price: Number(l.price ?? 0),
      title: String(l.title ?? ''),
    })),
    units: Number(d.checkout?.units ?? d.count ?? 0),
    total: Number(d.total || d.checkout?.totalSum || 0),
    addressRequired: !!d.checkout?.addressRequired,
    deliveries,
  };
}

/** The store needs a delivery choice per supplier before it will draft. */
export async function setDelivery(
  client: HtzClient,
  kind: 'quick' | 'regular',
  selections: { supplier_id: number; delivery_link_id: number }[],
): Promise<{ ok: boolean; error?: string }> {
  const res = await client.webApi('POST', '/api/cart/delivery', { kind, selections });
  if (res.status >= 400 || res.json?.error) return { ok: false, error: HtzClient.apiError(res) };
  return { ok: true };
}

export async function clearCart(client: HtzClient, kind: 'quick' | 'regular'): Promise<void> {
  await client.webApi('DELETE', `/api/cart?kind=${kind}`);
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
  },
): Promise<WalletPayResult> {
  if (opts.delivery && opts.delivery.length) {
    const set = await setDelivery(client, opts.kind, opts.delivery);
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
