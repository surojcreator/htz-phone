/**
 * חנוכה order loop — PRO² show tickets (group 156: attractions 166122, 166119).
 *
 * Port of wallet_loop.mjs's attraction path to the app's own HTTP stack:
 *   webLogin -> wallet sign-in (wallet_login_quick) -> item page (variants)
 *   -> cart_service::add_wallet_attraction -> /checkout2_wallet (supplier)
 *   -> checkout2_service::pay_order_wallet
 *
 * The pay body mirrors the request the site itself sends (captured from the
 * checkout page), including `payOption=new_card`, qty on the chosen variant and
 * the order phone.
 */
import { HtzClient } from './api';

export const HANUKKA_GROUP = '156';
export const HANUKKA_DEFAULT_ITEM = '166122';
export const HANUKKA_ITEMS = [
  { id: '166122', label: 'חנוכה 2026 · 166122' },
  { id: '166119', label: 'חנוכה 2026 · 166119' },
];

export type Variant = { id: number; price: number; desc: string };
export type Step = { step: string; ok: boolean; detail?: string };

export type HanukkaOptions = {
  itemId: string;
  qty: number;
  phone: string;
  collected?: string;      // "252788" or "252787:2,252788:2"
  proj?: string;           // default 156
  payment?: string;        // default '2' (two payments)
  payOption?: string;      // forced 'new_card'
  dryRun?: boolean;
  shouldStop?: () => boolean;
  log?: (line: string) => void;
};

export type HanukkaResult = {
  ok: boolean;
  steps: Step[];
  variants: Variant[];
  payload?: string;
  relocation?: string;
  cardUrl?: string;
  error?: string;
  raw?: unknown;
};

/**
 * Classify the pay_order_wallet response.
 *
 * The site answers one of:
 *   { relocation: "…" }                       order finished, follow the redirect
 *   { html: "<iframe src=CreditGuard…>" }      order staged — card entry required
 *   { err: {...} }                             refused
 * The CreditGuard iframe is a SUCCESS for us: the order exists and waits for a card.
 */
export function interpretPayResponse(pay: any): { ok: boolean; relocation?: string; cardUrl?: string; error?: string } {
  if (!pay || typeof pay !== 'object') return { ok: false, error: 'empty response' };
  const err = pay.err && (pay.err.content || pay.err);
  if (err) return { ok: false, error: String(err) };
  if (pay.relocation) return { ok: true, relocation: String(pay.relocation) };
  const html = typeof pay.html === 'string' ? pay.html : '';
  const iframe = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (iframe) return { ok: true, cardUrl: iframe[1] };
  if (typeof pay.url === 'string' && pay.url) return { ok: true, cardUrl: pay.url };
  return { ok: false, error: 'unrecognised response' };
}

const enc = (s: string) => encodeURIComponent(s);

/** The site returns err as a string or as { content } — normalise both. */
function errText(j: any): string {
  const e = j && j.err;
  if (!e) return '';
  if (typeof e === 'string') return e.trim();
  const s = e.content || e.msg || '';
  if (s) return String(s).trim();
  return JSON.stringify(e).slice(0, 160);
}

function text(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Rows the item page exposes: data-collected_id / data-price / .cell.desc */
export function parseVariants(html: string): Variant[] {
  const out: Variant[] = [];
  const seen = new Set<number>();
  const chunks = html.split(/(?=data-collected_id=["'])/).slice(1);
  for (const chunk of chunks) {
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

/** The checkout2_service::pay_order_wallet body the site posts. */
export function buildPayBody(o: {
  phone: string;
  supplier: string;
  item: string;
  payment: string;
  payOption: string;
  lines: { id: number; qty: number }[];
}): string {
  const S = o.supplier;
  const I = o.item;
  const parts: string[] = [
    'shippingPhone2=' + enc(o.phone),
    'payOption=' + enc(o.payOption),
    'hdBoxItAddress=',
    'hdBoxItName=',
    'hdBoxItLocker=',
    'chitabox_city_name%5B' + S + '%5D%5B' + I + '%5D=',
    'preferredPaymentsSelectBox%5B' + S + '%5D=' + enc(o.payment),
  ];
  for (const l of o.lines.filter((x) => x.qty > 0)) {
    parts.push('collected_itemsArr%5Bcollected_id%5D%5B%5D=' + l.id);
    parts.push('collected_itemsArr%5Bamount%5D%5B%5D=' + l.qty);
  }
  parts.push('show_address=1');
  parts.push('hdSelfDeliveryText=');
  parts.push('is_quick=1');
  parts.push('file=checkout2_service');
  parts.push('action=pay_order_wallet');
  return parts.join('&');
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

  try {
    await client.webLogin();
    add('web login', true, client.email);
    if (stopped()) return abort('wallet sign-in');

    // ---- wallet sign-in for the item's project -------------------------
    const signIn = async (p: string): Promise<string | null> => {
      const after = `after_page=wallet_attraction_item-com&after_id=${item}`;
      await client.webGet(`/wallet_login/${p}?${after}`);
      const j = await client.webAjax('special_service', 'wallet_login_quick', {
        project_id: p,
        signin_type: '3',
        after_page: 'wallet_attraction_item-com',
        after_id: item,
      }, `/wallet_login/${p}`, 'act');
      return (j && j.href) || null;
    };

    let href = await signIn(proj);
    if (!href) {
      add('wallet sign-in', false, 'PRO² quick sign-in refused (account not eligible, or TZ sign-in required)');
      return { ok: false, steps, variants: [], error: 'wallet sign-in refused' };
    }
    add('wallet sign-in', true, `proj ${proj}`);

    const cardUrl = (h: string | null) => {
      let u = h && /wallet_attraction_item-com\//.test(h) ? h : `/wallet_attraction_item-com/${item}`;
      if (!/^https?:/i.test(u) && !u.startsWith('/')) u = '/' + u;
      return u;
    };

    let html = await client.webGet(cardUrl(href));
    const pageProj = (html.match(/proj_id=(\d+)/) || html.match(/wallet_attractions_sale\/(\d+)/) || [])[1];
    if (pageProj && pageProj !== proj) {
      const href2 = await signIn(pageProj);
      if (!href2) {
        add('wallet sign-in (item project)', false, `proj ${pageProj} refused`);
        return { ok: false, steps, variants: [], error: 'sign-in refused for the item project' };
      }
      proj = pageProj;
      html = await client.webGet(cardUrl(href2));
      add('wallet sign-in (item project)', true, `proj ${proj}`);
    }

    if (!/data-collected_id=["']|class="item_title"/.test(html)) {
      add('item page', false, `did not render (${html.length} B)`);
      return { ok: false, steps, variants: [], error: 'item page did not render' };
    }
    if (/אין לך זכאות/.test(html)) {
      add('eligibility', false, 'PRO² gate closed — this account has no shop eligibility');
      return { ok: false, steps, variants: [], error: 'no PRO² eligibility on this account' };
    }

    const title = text((html.match(/class="item_title"[^>]*>([\s\S]{0,160}?)<\//) || [])[1] || '');
    variants = parseVariants(html);
    const allowance = Number((html.match(/data-max_no_points=['"](\d+)['"]/) || html.match(/data-max=['"](\d+)['"]/) || [])[1] || 0);
    add('item', true, `${title || item} · ${variants.length} variant(s)${allowance ? ` · allowance ${allowance}` : ''}`);

    const lines = buildLines(variants, opts.collected, opts.qty);
    const wanted = lines.filter((l) => l.qty > 0);
    if (!wanted.length) {
      add('cart selection', false, 'nothing selected');
      return { ok: false, steps, variants, error: 'nothing selected' };
    }
    const total = wanted.reduce((a, l) => a + l.qty, 0);
    if (allowance && total > allowance) log(`! ${total} units requested, allowance is ${allowance}`);
    add('cart selection', true, wanted.map((l) => `${l.id}×${l.qty}`).join(', '));
    if (stopped()) return abort('cart add');

    // ---- seed the cart ------------------------------------------------
    await client.webAjax("cart_service", "empty_cart", {}, `/wallet_attraction_item/${item}`, "act");
    const addRes = await client.webAjax('cart_service', 'add_wallet_attraction', {
      is_quick: '1',
      is_collected: variants.length ? '1' : '0',
      item_id: item,
      collected_arr: JSON.stringify(wanted.map((l) => ({ collectedId: l.id, quantity: l.qty }))),
    }, `/wallet_attraction_item/${item}`, 'act');
    const amount = addRes && addRes.data && Number(addRes.data.amount || 0);
    if (!addRes || addRes.status !== 1) {
      const detail = errText(addRes) || `status ${addRes?.status ?? '?'}: ${JSON.stringify(addRes).slice(0, 120)}`;
      add('cart add', false, detail);
      return { ok: false, steps, variants, error: detail };
    }
    if (amount === 0) {
      add('cart add', false, 'accepted but added 0 units (stock / per-member limit)');
      return { ok: false, steps, variants, error: 'silent refusal — 0 units added' };
    }
    add('cart add', true, `${amount} unit(s)`);

    // ---- checkout page: supplier + payment options ---------------------
    const co = await client.webGet('/checkout2_wallet');
    const supplier = (co.match(/name="preferredPaymentsSelectBox\[(\d+)\]"/) || [])[1] || '2452';
    const payment = '2';   // two payments — the option the site checks by default
    add('checkout page', true, `supplier ${supplier} · payment ${payment}`);

    const payBody = buildPayBody({
      phone: opts.phone,
      supplier,
      item,
      payment,
      payOption: opts.payOption || 'new_card',
      lines,
    });

    if (opts.dryRun) {
      log('— dry run, payload not sent —');
      return { ok: true, steps, variants, payload: payBody };
    }

    if (stopped()) return abort('payment');

    const pay = await client.webPostRaw(payBody, '/checkout2_wallet');
    const verdict = interpretPayResponse(pay);
    if (!verdict.ok) {
      const detail = verdict.error || errText(pay) || 'unrecognised response';
      add('pay', false, detail.slice(0, 160));
      return { ok: false, steps, variants, payload: payBody, error: detail, raw: pay };
    }
    if (verdict.relocation) {
      add('pay', true, `next → ${verdict.relocation}`);
      return { ok: true, steps, variants, payload: payBody, relocation: verdict.relocation, raw: pay };
    }
    add('pay', true, 'order staged — card entry required');
    log(`CARD PAYMENT REQUIRED -> ${verdict.cardUrl}`);
    return { ok: true, steps, variants, payload: payBody, cardUrl: verdict.cardUrl, raw: pay };
  } catch (e: any) {
    add('error', false, e?.message ?? String(e));
    return { ok: false, steps, variants: [], error: e?.message ?? String(e) };
  }
}
