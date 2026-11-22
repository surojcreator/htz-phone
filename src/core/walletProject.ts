/**
 * The experiences-wallet checkout ("ארנק חוויות").
 *
 * Wallet-attraction items (מופעי חנוכה, PRO shop) have their own checkout on the
 * site: `/wallet_attraction_item/<id>?proj_id=<project>` → `/checkout2_wallet`,
 * which posts
 *
 *   POST /api/wallet/cart  { project_id, item_id, page:"attraction",
 *                            lines:[{variant_id, quantity}], addons:{}, features:{} }
 *   POST /api/wallet/pay   { shipping:{name,phone,email}, billing:{name,phone} }
 *
 * Both require the wallet-project session created by
 *
 *   POST /api/wallet/login { email, identifier, takanon:1, project_id }
 *
 * and the login only answers for a member holding a live allocation — which is
 * why it returns `wallet_login_refused / לא נמצאה זכאות` once the grant expired.
 */
import { HtzClient } from './api';

export type WalletProjectResult = {
  ok: boolean;
  stage: 'login' | 'cart' | 'pay';
  /** store wording, untouched */
  error?: string;
  code?: string;
  orderId?: number;
  total?: number;
  raw?: any;
};

type Payload = { status: number; json: any };

function fail(stage: WalletProjectResult['stage'], res: Payload): WalletProjectResult {
  const e = res?.json?.error;
  return {
    ok: false,
    stage,
    code: e?.code,
    error: e?.message ?? HtzClient.apiError(res),
    raw: res?.json,
  };
}

/** Open the wallet-project session for a member.
 *
 * The identifying field is **`tz`** (תעודת זהות), not `identifier` — sending
 * anything else answers `wallet_login_refused / לא נמצאה זכאות`. On success the
 * member's allocation becomes live and הארנק שלי shows it.
 */
export async function walletProjectLogin(
  client: HtzClient,
  opts: { projectId: number | string; tz: string; email: string },
): Promise<WalletProjectResult> {
  await client.ensureWebSession();
  const res = await client.webApi('POST', '/api/wallet/login', {
    email: opts.email,
    tz: opts.tz,
    takanon: 1,
    project_id: opts.projectId,
  });
  if (res.status >= 400 || res.json?.error) return fail('login', res);
  return { ok: true, stage: 'login', raw: res.json };
}

/** Put the attraction in the wallet cart, then pay it from the allocation. */
export async function walletProjectCheckout(
  client: HtzClient,
  opts: {
    projectId: number | string;
    itemId: number;
    variantId: number;
    qty: number;
    identifier: string;
    email: string;
    name: string;
    phone: string;
  },
): Promise<WalletProjectResult> {
  const login = await walletProjectLogin(client, {
    projectId: opts.projectId,
    tz: opts.identifier,
    email: opts.email,
  });
  if (!login.ok) return login;

  const cart = await client.webApi('POST', '/api/wallet/cart', {
    project_id: opts.projectId,
    item_id: opts.itemId,
    page: 'attraction',
    lines: [{ variant_id: opts.variantId, quantity: opts.qty }],
    addons: {},
    features: {},
  });
  if (cart.status >= 400 || cart.json?.error) return fail('cart', cart);

  const pay = await client.webApi('POST', '/api/wallet/pay', {
    shipping: { name: opts.name, phone: opts.phone, email: opts.email },
    billing: { name: opts.name, phone: opts.phone },
  });
  if (pay.status >= 400 || pay.json?.error) return fail('pay', pay);

  const data = pay.json?.data ?? {};
  return {
    ok: true,
    stage: 'pay',
    orderId: Number(data.order_id ?? data.orderId ?? data.id ?? 0) || undefined,
    total: Number(data.total ?? data.sum ?? 0) || undefined,
    raw: pay.json,
  };
}

/** One product the grant loop can spend an allocation on. */
export type GrantTarget = { itemId: number; variantId: number; label?: string; projectId?: number };

export type GrantLoopStep = { index: number; ok: boolean; target: string; detail: string };

export type GrantLoopResult = {
  granted: number;
  attempts: number;
  walletBefore: number;
  walletAfter: number;
  steps: GrantLoopStep[];
  error?: string;
  stopped?: boolean;
};

const isRateLimited = (res: { status: number; json: any }) =>
  res.status === 429 || res.json?.error?.code === 'too_many_requests';

/**
 * Repeat the allocation step `count` times.
 *
 * Every `wallet/cart` credits one allocation to הארנק שלי, so the loop is
 * login → cart → read the balance → repeat. When the store throttles, the loop
 * moves to the next product in `targets` instead of dying on the rate limit.
 */
export async function runWalletGrantLoop(
  client: HtzClient,
  opts: {
    count: number;
    tz: string;
    email: string;
    projectId?: number | string;
    targets: GrantTarget[];
    gapMs?: number;
    log?: (line: string) => void;
    shouldStop?: () => boolean;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<GrantLoopResult> {
  const projectId = opts.projectId ?? 156;
  const log = opts.log ?? (() => {});
  const targets = opts.targets.filter((t) => t.itemId && t.variantId);
  const steps: GrantLoopStep[] = [];
  const gap = Math.max(0, opts.gapMs ?? 1500);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const balance = async () => (await client.appWallet().catch(() => null))?.total ?? 0;

  const walletBefore = await balance();
  let walletLast = walletBefore;
  let granted = 0;
  let attempts = 0;

  if (!targets.length) {
    return { granted: 0, attempts: 0, walletBefore, walletAfter: walletBefore, steps, error: 'no products to run on' };
  }

  let idx = 0;
  let loggedIn = false;
  const cooldown = new Map<string, number>();
  const loggedInProjects = new Set<string>();
  const keyOf = (t: GrantTarget, fallback: number | string) => `${t.itemId}:${t.variantId}:${t.projectId ?? fallback}`;

  for (let i = 1; i <= Math.max(0, opts.count); i++) {
    if (opts.shouldStop?.()) {
      return { granted, attempts, walletBefore, walletAfter: walletLast, steps, stopped: true };
    }
    opts.onProgress?.(i, opts.count);

    if (!loggedIn) {
      const login = await walletProjectLogin(client, { projectId, tz: opts.tz, email: opts.email });
      if (!login.ok) {
        steps.push({ index: i, ok: false, target: 'login', detail: login.error ?? 'login refused' });
        log(`✗ login: ${login.error ?? 'refused'}`);
        return { granted, attempts, walletBefore, walletAfter: walletLast, steps, error: login.error };
      }
      loggedIn = true;
      loggedInProjects.add(String(projectId));
      log('✓ wallet login');
    }

    // A throttled product hands the next iteration to the next product — same
    // shop first, then the other shop (PRO² shop / חנוכה). A target that just
    // throttled is parked for a while so the loop stops poking it.
    let done = false;
    const now = Date.now();
    const available = targets.filter((t) => (cooldown.get(keyOf(t, projectId)) ?? 0) <= now);
    const ordered = [...available].sort(
      (a, b) =>
        Number((b.projectId ?? projectId) === projectId) - Number((a.projectId ?? projectId) === projectId),
    );
    for (const target of ordered) {
      if (done) break;
      const pid = String(target.projectId ?? projectId);
      // Each shop has its own wallet session.
      if (!loggedInProjects.has(pid)) {
        const login = await walletProjectLogin(client, { projectId: pid, tz: opts.tz, email: opts.email });
        if (!login.ok) {
          log(`· shop ${pid} not available for this member (${login.error ?? 'login refused'})`);
          cooldown.set(keyOf(target, projectId), Date.now() + 300_000);
          continue;
        }
        loggedInProjects.add(pid);
        log(`✓ wallet login · shop ${pid}`);
      }
      const name = target.label ?? `${target.itemId}/${target.variantId}`;
      attempts++;
      const shop = (target.projectId ?? projectId) === projectId ? 'current shop' : `shop ${target.projectId ?? projectId}`;
      const cart = await client.webApi('POST', '/api/wallet/cart', {
        project_id: Number(pid),
        item_id: target.itemId,
        page: 'attraction',
        lines: [{ variant_id: target.variantId, quantity: 1 }],
        addons: {},
        features: {},
      });

      if (cart.status < 400 && !cart.json?.error) {
        const after = await balance();
        const delta = after - walletLast;
        walletLast = after;
        granted += delta > 0 ? 1 : 0;
        const sign = delta > 0 ? `+₪${delta}` : delta < 0 ? `−₪${Math.abs(delta)}` : '±0';
        steps.push({ index: i, ok: true, target: name, detail: `${sign} (wallet ₪${after})` });
        log(`✓ ${i}/${opts.count} · ${name} · ${sign} · wallet ₪${after}`);
        idx = Math.max(0, targets.indexOf(target));
        done = true;
        break;
      }

      if (isRateLimited(cart)) {
        cooldown.set(keyOf(target, projectId), Date.now() + 45_000);
        steps.push({ index: i, ok: false, target: name, detail: `rate limited (${shop}) — next product` });
        log(`· ${name} rate limited (${shop}) — switching product`);
        await sleep(2000);
        continue;
      }

      // Anything else is about the item itself (limit/sold out): next product too.
      const detail = cart.json?.error?.message ?? HtzClient.apiError(cart);
      steps.push({ index: i, ok: false, target: name, detail });
      log(`✗ ${name}: ${detail}`);
      await sleep(1000);
    }

    if (!done) {
      idx = (idx + 1) % targets.length;
      // Everything is parked: wait out the shortest cooldown instead of spinning.
      if (!ordered.length) {
        const soonest = Math.min(...targets.map((t) => cooldown.get(keyOf(t, projectId)) ?? 0));
        const wait = Math.min(30_000, Math.max(2_000, soonest - Date.now()));
        log(`· every product is cooling down — waiting ${Math.round(wait / 1000)}s`);
        await sleep(wait);
      }
    }
    if (gap) await sleep(gap);
  }

  return { granted, attempts, walletBefore, walletAfter: walletLast, steps };
}
