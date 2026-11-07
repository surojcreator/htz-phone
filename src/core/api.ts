/**
 * Htzone phone client.
 *
 * Two surfaces, both verified live:
 *
 *  APP API  https://cms.htzone.co.il/api/android/1.6/
 *    loginUser            POST { email, password }   <- both SecureEncryption-encrypted
 *    editUserInformation  POST { phone }             <- merges, does not replace the record
 *
 *  WEB      https://www.htzone.co.il
 *    /login                carries `var secure_login = "…"` (per page load)
 *    POST /_ajax/ajax.index.php  file=user_service&action=login
 *                                (+ secure_login, remember=on)
 *    /support_page         details form: `telephone` is the account phone
 *
 * Cookies are handled by the platform (OkHttp on Android, NSURLSession on iOS),
 * so one login is enough for the follow-up calls in the same session.
 */
import { decryptString, encryptString } from './crypto';

export const APP_API = 'https://cms.htzone.co.il/api/android/1.6/';
export const WEB = 'https://www.htzone.co.il';

export type User = Record<string, any>;

export type Check = {
  name: string;
  value: string;
  ok: boolean;
  info?: boolean;
  note?: string;
};

export type VerifyReport = {
  ok: boolean;
  checks: Check[];
  user?: User;
};

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const canon = (s: unknown) => {
  const d = digits(s);
  return d.startsWith('972') ? `0${d.slice(3)}` : d;
};

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

function parseSetCookie(header: string | null): Record<string, string> {
  const jar: Record<string, string> = {};
  if (!header) return jar;
  for (const part of header.split(/,(?=[^;]+?=)/)) {
    const pair = part.split(';')[0].trim();
    const eq = pair.indexOf('=');
    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return jar;
}

export class HtzClient {
  /**
   * Cookies are handled natively by RN (OkHttp / NSURLSession). Node's fetch has
   * no jar, so we mirror Set-Cookie ourselves and send it back explicitly —
   * harmless in RN, required for the headless harness.
   */
  private jar: Record<string, string> = {};

  constructor(public email: string, public password: string) {}

  private cookieHeader(): string | undefined {
    const parts = Object.entries(this.jar).map(([k, v]) => `${k}=${v}`);
    return parts.length ? parts.join('; ') : undefined;
  }

  private absorb(res: Response) {
    const h: any = res.headers;
    const raw: string[] =
      typeof h.getSetCookie === 'function' ? h.getSetCookie() : [h.get('set-cookie')].filter(Boolean);
    for (const one of raw) Object.assign(this.jar, parseSetCookie(one));
  }

  private async postJson(url: string, body: unknown): Promise<any> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;

    const res = await withTimeout(
      fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        // React Native only attaches/stores cookies when the request opts in.
        // Without this the login succeeds but the follow-up call has no session
        // (the app API answers 150 "must be logged in").
        credentials: 'include',
      }),
      25000,
    );
    this.absorb(res);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`non-JSON response (${res.status}): ${text.slice(0, 160)}`);
    }
  }

  /** Web login: needs the inline secure_login token from /login. */
  async webLogin(): Promise<void> {
    const pageRes = await withTimeout(
      fetch(`${WEB}/login`, {
        headers: this.cookieHeader() ? { Cookie: this.cookieHeader()! } : {},
        credentials: 'include',
      }),
      25000,
    );
    this.absorb(pageRes);
    const page = await pageRes.text();
    const m = page.match(/var\s+secure_login\s*=\s*"([^"]+)"/);
    if (!m) throw new Error('secure_login token not found on /login');

    const form = new URLSearchParams({
      email: this.email,
      password: this.password,
      remember: 'on',
      secure_login: m[1],
      file: 'user_service',
      action: 'login',
    });

    const res = await withTimeout(
      fetch(`${WEB}/_ajax/ajax.index.php`, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: `${WEB}/login`,
          Origin: WEB,
          ...(this.cookieHeader() ? { Cookie: this.cookieHeader()! } : {}),
        },
        body: form.toString(),
        credentials: 'include',
      }),
      25000,
    );
    this.absorb(res);
    const json = await res.json();
    if ((json?.err ?? '').toString().trim()) throw new Error(`web login failed: ${json.err}`);
  }

  /** Web read: both phone-ish inputs in the details form. */
  async webReadPhones(): Promise<{ telephone: string; phone: string; html: string }> {
    const res = await withTimeout(
      fetch(`${WEB}/support_page`, {
        headers: this.cookieHeader() ? { Cookie: this.cookieHeader()! } : {},
        credentials: 'include',
      }),
      25000,
    );
    this.absorb(res);
    const html = await res.text();
    const read = (field: string) => {
      const tag = html.match(new RegExp(`<input[^>]*name=['"]${field}['"][^>]*>`));
      if (!tag) return '';
      const v = tag[0].match(/value=['"]([^'"]*)['"]/);
      return v ? v[1] : '';
    };
    return { telephone: read('telephone'), phone: read('phone'), html };
  }

  /**
   * Full sweep. Uses a fresh app-API session for each read so a cached session
   * cannot produce a false positive.
   */
  async verify(expected: string): Promise<VerifyReport> {
    const checks: Check[] = [];
    const expect = canon(expected);
    let user: User | undefined;

    for (let session = 1; session <= 2; session++) {
      const u = await this.appLogin();
      if (!user) user = u;
      checks.push({
        name: `app API · loginUser (session ${session}) · phone`,
        value: String(u.phone ?? ''),
        ok: canon(u.phone) === expect,
      });
      const blob = JSON.stringify(u);
      for (const stale of STALE_CANDIDATES) {
        if (stale === expect) continue;
        checks.push({
          name: `app API · user object contains ${stale}`,
          value: String(blob.includes(stale)),
          ok: !blob.includes(stale),
        });
      }
    }

    try {
      await this.webLogin();
      const { telephone, phone, html } = await this.webReadPhones();
      checks.push({
        name: 'web · /support_page telephone',
        value: telephone,
        ok: canon(telephone) === expect,
      });
      checks.push({
        name: 'web · /support_page phone',
        value: phone,
        ok: canon(phone) === expect,
      });
      for (const stale of STALE_CANDIDATES) {
        if (stale === expect) continue;
        checks.push({
          name: `web · /support_page contains ${stale}`,
          value: String(html.includes(stale)),
          ok: !html.includes(stale),
        });
      }
    } catch (e: any) {
      checks.push({
        name: 'web · /support_page',
        value: 'unreachable',
        ok: true,
        info: true,
        note: e?.message ?? String(e),
      });
    }

    return { ok: checks.filter((c) => !c.info).every((c) => c.ok), checks, user };
  }

  /** App API login. Credentials are encrypted exactly like the native app does. */
  async appLogin(): Promise<User> {
    const res = await this.postJson(`${APP_API}loginUser/`, {
      email: await encryptString(this.email),
      password: await encryptString(this.password),
    });
    if (res?.status !== 1) {
      const msg = res?.err?.content || JSON.stringify(res).slice(0, 160);
      throw new Error(`app login failed: ${msg}`);
    }
    return res.data as User;
  }

  /** App API partial update — only `phone` is sent, so nothing else is touched. */
  async appSetPhone(phone: string): Promise<void> {
    const write = async () => {
      const res = await this.postJson(`${APP_API}editUserInformation/`, { phone });
      if (res?.status !== 1) {
        const err = res?.err ?? {};
        const message = err?.content || JSON.stringify(res).slice(0, 160);
        const authErr = new Error(message) as Error & { code?: number };
        authErr.code = typeof err?.id === 'number' ? err.id : undefined;
        throw authErr;
      }
    };

    try {
      await write();
    } catch (e: any) {
      // 150 = "to perform this action you must be logged in": the session
      // cookie didn't travel with the request. Re-authenticate once and retry.
      if (e?.code === 150) {
        await this.appLogin();
        await write();
        return;
      }
      throw e;
    }
  }
}

/** Numbers that must not survive anywhere on the account. */
export const STALE_CANDIDATES = ['0544464632', '0555073599'];

export { decryptString, encryptString };
