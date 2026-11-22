/**
 * The store's error codes, in words a person can act on.
 *
 * The API answers `{error:{code,message,details}}` in Hebrew; the UI should not
 * have to leak `cart_checkout_in_progress` at someone.
 */
const KNOWN: Record<string, string> = {
  too_many_requests: 'rate limited by the store — wait a moment, it retries by itself',
  unauthenticated: 'not logged in — the session expired',
  invalid_credentials: 'email or password rejected',
  validation_failed: 'the store rejected the values',
  variant_required: 'choose a model for this product first',
  purchase_limit_reached: 'you already bought the maximum of this item',
  over_purchase_limit: 'that is more than this item allows per order',
  cart_empty: 'the cart is empty',
  cart_checkout_in_progress: 'another checkout is open on this cart',
  cart_not_valid: 'the cart changed — it needs rebuilding',
  delivery_choice_missing: 'choose a delivery method',
  shipping_address_required: 'a delivery address is required',
  pickup_point_required: 'choose a pickup point',
  card_required: 'payment needs a card',
  order_not_found: 'order not found',
  wallet_checkout_empty: 'nothing to pay in the wallet checkout',
  three_d_secure_required: 'the bank asked for 3-D Secure',
  not_found: 'not found',
  method_not_allowed: 'that call is not allowed',
  server_error: 'the store had an error',
};

export type ApiFailure = { code?: string; message?: string; details?: any };

/** Best-effort message from any of the response envelopes we have seen. */
export function friendlyError(input: any): string {
  if (!input) return 'unknown error';
  if (typeof input === 'string') return input;

  const code = String(input?.error?.code ?? input?.code ?? input?.err?.id ?? '');
  const details = input?.error?.details ?? input?.details ?? {};
  const base = KNOWN[code];

  if (code === 'purchase_limit_reached') {
    return `${base} (limit ${details.limit ?? '?'}, remaining ${details.remaining ?? 0})`;
  }
  if (code === 'over_purchase_limit') {
    return `${base} (max ${details.max_purchase ?? '?'} per order)`;
  }
  if (code === 'rate_limit' || code === 'too_many_requests') return KNOWN.too_many_requests;
  if (base) return base;

  const message = input?.error?.message ?? input?.message ?? input?.err?.content ?? input?.err;
  if (typeof message === 'string' && message.trim()) return message.trim();
  return code || 'unknown error';
}

/** Pull the error body out of a `webApi` result. */
export function fromResponse(res: { status: number; json?: any }): string {
  if (res?.json?.error || res?.json?.err) return friendlyError(res.json);
  if (res && res.status >= 400) return `request failed (${res.status})`;
  return 'unknown error';
}
