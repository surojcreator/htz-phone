/**
 * "הארנק שלי" grants.
 *
 * The site renders the wallet tab (`/support_page#my_wallet`) from a server
 * payload, not from an API: `/api/benefits` only carries the header summary
 * (`{display, total, visible_total}`), which is `total: 0` whenever nothing is
 * currently usable. The rows behind "הטבות פעילות" / "הטבות לא פעילות" live in
 * the RSC props of `/support_page` as
 *
 *   "obligo": { total, active: [...], not_active: [...] }
 *
 * so that page is read and the object is pulled out of the flight payload.
 */
import { HtzClient } from './api';

export type WalletGrant = {
  id: number;
  title: string;
  /** value granted, ₪ */
  sum: number;
  /** already spent, ₪ */
  used: number;
  /** still available on that grant, ₪ */
  left: number;
  /** dd/mm/yyyy as the store sends it */
  expiresAt: string;
};

export type WalletGrants = {
  /** usable balance for new orders (the same number the site headlines) */
  total: number;
  active: WalletGrant[];
  inactive: WalletGrant[];
  /** ₪ left on expired grants — shown, never spendable */
  inactiveLeft: number;
  /** newest expiry date among the expired grants */
  inactiveUntil: string;
};

const empty = (): WalletGrants => ({ total: 0, active: [], inactive: [], inactiveLeft: 0, inactiveUntil: '' });

function grant(row: any): WalletGrant {
  return {
    id: Number(row?.obligo_id ?? row?.id ?? 0),
    title: String(row?.title ?? '').trim(),
    sum: Number(row?.sum ?? 0) || 0,
    used: Number(row?.used ?? 0) || 0,
    left: Number(row?.left ?? 0) || 0,
    expiresAt: String(row?.expires_at ?? ''),
  };
}

/** Every balanced JSON object that directly follows `key`. */
function objectsAfter(flat: string, key: string): any[] {
  const out: any[] = [];
  let at = flat.indexOf(key);
  while (at >= 0) {
    let start = at + key.length;
    while (start < flat.length && /\s/.test(flat[start])) start++;
    if (flat[start] === '{') {
      let depth = 0;
      for (let i = start; i < flat.length && i < start + 2_000_000; i++) {
        const ch = flat[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try {
              out.push(JSON.parse(flat.slice(start, i + 1)));
            } catch {
              /* the payload escapes some labels; that object is not ours */
            }
            break;
          }
        }
      }
    }
    at = flat.indexOf(key, at + key.length);
  }
  return out;
}

export function parseWalletGrants(html: string): WalletGrants {
  if (!html) return empty();
  const flat = html.replace(/\\"/g, '"');
  const candidates = objectsAfter(flat, '"obligo":');
  const wallet = candidates.find((o) => o && ('active' in o || 'not_active' in o));
  if (!wallet) return empty();

  const active: WalletGrant[] = (Array.isArray(wallet.active) ? wallet.active : []).map(grant);
  const inactive: WalletGrant[] = (Array.isArray(wallet.not_active) ? wallet.not_active : []).map(grant);
  const inactiveLeft = inactive.reduce((sum: number, g: WalletGrant) => sum + Math.max(0, g.left), 0);
  const inactiveUntil = inactive.map((g: WalletGrant) => g.expiresAt).filter(Boolean).sort().pop() ?? '';

  return {
    total: Number(wallet.total ?? 0) || 0,
    active,
    inactive,
    inactiveLeft,
    inactiveUntil,
  };
}

/** Read the wallet grants the way the site's wallet tab does. */
export async function readWalletGrants(client: HtzClient): Promise<WalletGrants> {
  // The wallet tab is behind the website session; the app session alone renders
  // an anonymous page with no wallet block in it.
  await client.ensureWebSession();
  const html = await client.webGet('/support_page');
  return parseWalletGrants(html);
}

/** One-line wording for the wallet check in the UI. */
export function walletGrantsText(g: WalletGrants): string {
  if (!g.active.length && !g.inactive.length) return 'no wallet grants';
  const parts = [`${g.active.length} active`];
  if (!g.inactive.length) {
    parts.push('0 expired');
  } else {
    const left = g.inactiveLeft ? `₪${g.inactiveLeft} left` : 'nothing left';
    parts.push(`${g.inactive.length} expired · ${left}${g.inactiveUntil ? ` · ${g.inactiveUntil}` : ''}`);
  }
  return parts.join(' · ');
}
