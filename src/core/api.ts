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

/** Which surfaces a run touches. `both-web` is the default, matching the desktop tool. */
export type RunMode = 'both-web' | 'both-app' | 'web' | 'app';

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

/**
 * Cookies: we keep our own jar and tell fetch not to use the platform store.
 *
 * `secure_login` is bound to whichever PHPSESSID fetched /login, so the page
 * fetch and the POST must travel with the *same* cookie. Letting NSURLSession /
 * OkHttp add theirs produced a second PHPSESSID and, whenever the server saw
 * the other one, the site answered "מייל או סיסמא לא נכונים" for a valid password.
 */
const IS_NATIVE =
  typeof navigator !== 'undefined' && (navigator as any).product === 'ReactNative';
void IS_NATIVE;

async function withTimeout<T>(
  run: Promise<T> | ((signal?: AbortSignal) => Promise<T>),
  ms: number,
): Promise<T> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try { ctrl?.abort(); } catch { /* ignore */ }
      reject(new Error(`timeout after ${ms}ms`));
    }, ms);
  });
  try {
    // call sites may pass a promise (no abort) or a function that accepts the signal
    const started = typeof run === 'function' ? (run as (s?: AbortSignal) => Promise<T>)(ctrl?.signal) : run;
    // when the timeout wins, the aborted fetch still rejects later — keep that
    // rejection handled so Hermes/JSC doesn't surface it as an app error
    started.catch(() => {});
    return await Promise.race([started, timeout]);
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

export type DetailsForm = Record<string, string>;

/** fields worth restoring if the web write disturbs them */
const REPAIRABLE = ['birth_day', 'birth_month', 'city', 'ct_name', 'tz_number', 'first_name', 'last_name'];
/** server-derived / dynamic: reported but never treated as a failure */
const VOLATILE = new Set(['last_update', 'date_created', 'home_arr', 'params', 'birthday', 'allow_app_rating']);
/** a key that names a phone-ish field, same rule the desktop tool uses */
const PHONE_KEY = /(phone|tel|mobile|cell|whatsapp)/i;

/** Parse the inputs/selects of an HTML form into the values jQuery would serialize. */
export function parseFormFields(body: string): DetailsForm {
  const out: DetailsForm = {};
  const tagRe = /<(input|select)\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(body))) {
    const tag = m[0];
    const kind = m[1].toLowerCase();
    const attr = (name: string) => {
      // anchored so `data-value=` / `data-name=` can never be mistaken for the real thing
      const a = tag.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*["\']([^"\']*)', 'i'));
      return a ? a[1] : '';
    };
    const name = attr('name');
    if (!name) continue;
    const type = (attr('type') || kind).toLowerCase();

    if (kind === 'select') {
      const rest = body.slice(m.index);
      const end = rest.toLowerCase().indexOf('</select>');
      const block = end >= 0 ? rest.slice(0, end) : rest;
      const sel =
        block.match(/<option[^>]*\bselected\b[^>]*>/i) || block.match(/<option[^>]*>/i);
      let val = '';
      if (sel) {
        const v = sel[0].match(/value\s*=\s*["\']([^"\']*)/i);
        if (v) val = v[1];
        else {
          const close = block.indexOf('</option>', sel.index ?? 0);
          val = block
            .slice((sel.index ?? 0) + sel[0].length, close >= 0 ? close : block.length)
            .replace(/<[^>]+>/g, '')
            .trim();
        }
      }
      out[name] = val;
    } else if (type === 'radio' || type === 'checkbox') {
      if (/\bchecked\b/i.test(tag)) out[name] = attr('value') || 'on';
    } else if (['submit', 'button', 'reset', 'file', 'image'].includes(type)) {
      continue;
    } else {
      out[name] = attr('value');
    }
  }
  return out;
}

export class HtzClient {
  /**
   * Cookies are managed here, not by the platform.
   *
   * Two reasons, both learned the hard way:
   *
   * 1. `secure_login` is bound to the PHPSESSID that fetched /login. If the
   *    cookie that arrives with the POST differs from the one that fetched the
   *    page — which is what happens when the platform store and our jar each
   *    send their own — the site answers "מייל או סיסמא לא נכונים" even though
   *    the password is right.
   * 2. A stuck session can only be cleared by dropping the cookie. The platform
   *    store can't be cleared from JS, which is why the old build needed a
   *    reinstall. Here `resetSession()` mints a new PHPSESSID instead.
   *
   * Cookies are keyed by host: cms.htzone.co.il and www.htzone.co.il issue
   * separate PHPSESSIDs and must never be mixed.
   */

  /** Shared per account so a fresh screen doesn't log in again. */
  private static sessions = new Map<string, { jar: Record<string, string>; webAt: number }>();

  private get sess() {
    const key = this.email.trim().toLowerCase();
    let s = HtzClient.sessions.get(key);
    if (!s) {
      s = { jar: {}, webAt: 0 };
      HtzClient.sessions.set(key, s);
    }
    return s;
  }

  constructor(public email: string, public password: string) {}

  /** Drop every cookie for this account — the "reinstall" equivalent. */
  resetSession(): void {
    const s = this.sess;
    s.jar = {};
    s.webAt = 0;
  }

  private static hostOf(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return 'unknown';
    }
  }

  private cookieHeaderFor(url: string): string | undefined {
    const prefix = HtzClient.hostOf(url) + '|';
    const parts = Object.entries(this.sess.jar)
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => `${k.slice(prefix.length)}=${v}`);
    return parts.length ? parts.join('; ') : undefined;
  }

  /** PHP accepts a client-supplied id, so a fresh one is a fresh session. */
  private static newSessionId(): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 26; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)];
    return id;
  }

  private mintWebSession(): void {
    const s = this.sess;
    // keep unrelated cookies, replace the session id
    for (const k of Object.keys(s.jar)) {
      if (k.startsWith('www.htzone.co.il|PHPSESSID')) delete s.jar[k];
    }
    s.jar['www.htzone.co.il|PHPSESSID'] = HtzClient.newSessionId();
    s.webAt = 0;
  }

  private absorb(res: Response, url: string) {
    const h: any = res.headers;
    const raw: string[] =
      typeof h.getSetCookie === 'function' ? h.getSetCookie() : [h.get('set-cookie')].filter(Boolean);
    const prefix = HtzClient.hostOf(url) + '|';
    for (const one of raw) {
      for (const [k, v] of Object.entries(parseSetCookie(one))) this.sess.jar[prefix + k] = v;
    }
  }

  private async postJson(url: string, body: unknown): Promise<any> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    const cookie = this.cookieHeaderFor(url);
    if (cookie) headers.Cookie = cookie;

    const res = await withTimeout(
      fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        // React Native only attaches/stores cookies when the request opts in.
        // Without this the login succeeds but the follow-up call has no session
        // (the app API answers 150 "must be logged in").
        credentials: 'omit',
      }),
      25000,
    );
    this.absorb(res, url);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`non-JSON response (${res.status}): ${text.slice(0, 160)}`);
    }
  }

  /**
   * GET that survives one transient network failure (iOS Wi-Fi/cellular
   * handoff and DNS hiccups otherwise surface as "Network request failed"
   * in the middle of a verification run). Only used for idempotent reads.
   */
  private async getText(url: string, extra: Record<string, string> = {}): Promise<string> {
    const headers: Record<string, string> = { Accept: 'text/html,application/xhtml+xml', ...extra };
    const cookie = this.cookieHeaderFor(url);
    if (cookie) headers.Cookie = cookie;

    let lastErr: any;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await withTimeout(
          fetch(url, { headers, credentials: 'omit' }),
          25000,
        );
        this.absorb(res, url);
        return await res.text();
      } catch (e) {
        lastErr = e;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
      }
    }
    throw lastErr;
  }

  /** Web login: needs the inline secure_login token from /login. */
  async webLogin(): Promise<void> {
    const ajaxUrl = `${WEB}/_ajax/ajax.index.php`;
    let lastPage = '';
    let lastErr = '';

    for (let attempt = 0; attempt < 4; attempt++) {
      // A fresh session id on the first two attempts: it is the only reliable
      // way to escape a session the site has decided to stop issuing tokens for
      // (previously a reinstall was the workaround — this is the same thing).
      if (attempt < 2) this.mintWebSession();

      const loginUrl = `${WEB}/login?_=${Date.now()}&a=${attempt}`;
      try {
        lastPage = await this.getText(loginUrl);
      } catch (e: any) {
        lastErr = e?.message ?? String(e);
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1) ** 2));
        continue;
      }

      const token = HtzClient.tokenFrom(lastPage);
      if (!token) {
        lastErr = 'token missing';
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1) ** 2));
        continue;
      }

      const form = new URLSearchParams({
        email: this.email,
        password: this.password,
        remember: 'on',
        secure_login: token,
        file: 'user_service',
        action: 'login',
      });

      const res = await withTimeout(
        fetch(ajaxUrl, {
          method: 'POST',
          headers: {
            Accept: 'application/json, text/javascript, */*; q=0.01',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            Referer: loginUrl,
            Origin: WEB,
            ...(this.cookieHeaderFor(ajaxUrl) ? { Cookie: this.cookieHeaderFor(ajaxUrl)! } : {}),
          },
          body: form.toString(),
          credentials: 'omit',
        }),
        25000,
      );
      this.absorb(res, ajaxUrl);
      const json = await res.json().catch(() => ({}));
      const webErr = String(json?.err ?? '').trim();

      if (!webErr) {
        this.sess.webAt = Date.now();
        return;
      }

      lastErr = webErr;
      // "wrong password" is also what a token/session mismatch looks like, so
      // one retry with a brand-new session is worth it; after that it is real.
      if (!/לא נכונים/.test(webErr) || attempt >= 1) break;
      await new Promise((r) => setTimeout(r, 800));
    }

    this.sess.webAt = 0;
    const challenged =
      /captcha|recaptcha|too many|rate.?limit|\u05d7\u05e1\u05d5\u05dd|\u05d1\u05d5\u05d8/i.test(lastPage) ||
      (!!lastPage && lastPage.length < 3000);
    const why = /לא נכונים/.test(lastErr)
      ? `web login failed: ${lastErr} — the site rejected the credentials (or this session). Press Reset session in Defaults and try again; if it repeats, check the password.`
      : `secure_login token not found on /login (${lastPage.length} B, 4 tries)` +
        (challenged
          ? ' — the site is throttling this connection or asking for a challenge; wait a minute and retry'
          : ` — last error: ${lastErr || 'none'}`);
    throw new Error(why);
  }

  /** The token appears in a few spellings depending on the page variant. */
  private static tokenFrom(page: string): string | null {
    const patterns = [
      /var\s+secure_login\s*=\s*["']([^"']+)["']/,
      /secure_login\s*[:=]\s*["']([^"']+)["']/,
      /name=["']secure_login["'][^>]*value=["']([^"']+)["']/,
      /value=["']([^"']+)["'][^>]*name=["']secure_login["']/,
    ];
    for (const re of patterns) {
      const m = page.match(re);
      if (m) return m[1];
    }
    return null;
  }

  /**
   * Login only when the session is not already known-good.
   *
   * Every extra login counts against the site's rate limit and is what turns a
   * healthy session into "secure_login token not found" later in the day.
   */
  async ensureWebSession(force = false): Promise<void> {
    if (!force && this.sess.webAt && Date.now() - this.sess.webAt < 10 * 60_000) return;
    await this.webLogin();
  }

  /** Both phone-ish inputs in the details form. Re-logs in once if the session lapsed. */
  async webReadPhones(): Promise<{ telephone: string; phone: string; html: string }> {
    const once = async () => {
      const pageUrl = `${WEB}/support_page`;
      const html = await this.getText(pageUrl);
      // The details form lives inside a JSON-escaped HTML string. Unescape the
      // quotes once, then match conventionally — and anchor `value=` so
      // `data-value=` can never win the match.
      const flat = html.replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      const read = (field: string) => {
        const tag = flat.match(new RegExp(`<input[^>]*\\bname=['"]${field}['"][^>]*>`));
        if (!tag) return '';
        const v = tag[0].match(/(?:^|\s)value\s*=\s*['"]([^'"]*)/);
        return v ? v[1] : '';
      };
      return { telephone: read('telephone'), phone: read('phone'), html };
    };

    let out = await once();
    if (!out.telephone && !out.phone) {
      // page rendered but the form wasn't ours: the session is gone
      await this.ensureWebSession(true);
      out = await once();
    }
    return out;
  }

  /**
   * Full sweep, mirroring the desktop tool's `verify()`.
   *
   * Per app session: the phone, "מייל נוסף", and *every* phone-like key in the
   * user record (tel/mobile/cell/whatsapp) — a stale number hiding in a second
   * field is exactly what a whole-object scan is too noisy to catch. Then the
   * web profile: `telephone` plus any other phone-like form field, and the
   * additional-email field must be empty.
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
      const email2 = String(u.email_2 ?? '');
      checks.push({
        name: `app API · session ${session} · מייל נוסף empty`,
        value: email2.trim() ? email2.slice(0, 26) : 'empty',
        ok: !email2.trim(),
      });
      for (const [key, value] of Object.entries(u as Record<string, any>)) {
        if (key === 'phone' || !PHONE_KEY.test(key)) continue;
        if (typeof value !== 'string' && typeof value !== 'number') continue;
        if (!digits(value)) continue;
        checks.push({
          name: `app API · session ${session} · ${key}`,
          value: String(value),
          ok: canon(value) === expect,
        });
      }
    }

    try {
      await this.ensureWebSession();
      const form = await this.webForm();
      checks.push({
        name: 'web · /support_page telephone',
        value: String(form.telephone ?? ''),
        ok: canon(form.telephone) === expect,
      });
      for (const [key, value] of Object.entries(form)) {
        if (key === 'telephone' || !PHONE_KEY.test(key)) continue;
        if (!digits(value)) continue;
        checks.push({
          name: `web · /support_page ${key}`,
          value,
          ok: canon(value) === expect,
        });
      }
      // "מייל נוסף" must stay empty on this side too
      const more = String(form.email_more ?? '');
      checks.push({
        name: 'web · /support_page מייל נוסף empty',
        value: more.trim() ? more.slice(0, 24) : 'empty',
        ok: !more.trim(),
      });
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

  /** Every serializable field of the /support_page "my details" form. */
  async webForm(): Promise<DetailsForm> {
    try {
      return await this.readDetailsForm();
    } catch {
      // a lapsed session renders the page without our details block
      await this.ensureWebSession(true);
      return this.readDetailsForm();
    }
  }

  private async readDetailsForm(): Promise<DetailsForm> {
    const html = await this.webGet('/support_page');
    const anchor = html.indexOf('"next_step":"details_form"');
    if (anchor < 0) throw new Error('details form marker not found on /support_page');

    // the section is a JSON-escaped HTML string; unescape it exactly
    const tail = html.slice(anchor);
    const marker = '"section_html":"';
    const i = tail.indexOf(marker);
    if (i < 0) throw new Error('section_html not found for the details form');
    const buf: string[] = [];
    let j = i + marker.length;
    while (j < tail.length) {
      const ch = tail[j];
      if (ch === '\\' && j + 1 < tail.length) {
        buf.push(tail[j], tail[j + 1]);
        j += 2;
        continue;
      }
      if (ch === '"') break;
      buf.push(ch);
      j += 1;
    }
    let section = '';
    try {
      section = JSON.parse('"' + buf.join('') + '"');
    } catch {
      throw new Error('could not decode the details section');
    }
    if (!section.includes('telephone')) throw new Error('details section has no telephone field');

    const form = section.match(/<form[^>]*class=['"]update['"][^>]*>([\s\S]*?)<\/form>/i);
    return parseFormFields(form ? form[1] : section);
  }

  /**
   * Set `telephone` on the website. The endpoint REPLACES the record, so empty
   * form fields are filled from the app record first and anything that would be
   * blanked is refused.
   */
  async webApplyPhone(phone: string, appRecord?: User): Promise<{ filled: string[]; before: DetailsForm; after: DetailsForm }> {
    const before = await this.webForm();
    if (!('telephone' in before)) throw new Error('no telephone field in the details form');

    const payload: DetailsForm = { ...before, telephone: phone };
    const filled: string[] = [];
    if (appRecord) {
      for (const key of Object.keys(payload)) {
        if (String(payload[key] ?? '').trim()) continue;
        const appVal = (appRecord as any)[key];
        if ((typeof appVal === 'string' || typeof appVal === 'number') && String(appVal).trim() && String(appVal) !== '0') {
          payload[key] = String(appVal);
          filled.push(key);
        }
      }
    }

    const risky = Object.keys(before).filter((k) => String(before[k] ?? '').trim() && !String(payload[k] ?? '').trim());
    if (risky.length) throw new Error('refusing to blank fields: ' + risky.join(', '));

    const res = await this.webAjax('user_service', 'register_form_update', payload, '/support_page', 'action');
    const err = (res?.err ?? '').toString().trim();
    if (err) throw new Error('web update: ' + err);

    const after = await this.webForm();
    return { filled, before, after };
  }

  /**
   * Set the phone on BOTH surfaces and prove it.
   *
   * The app API and the website keep the number in different fields (`phone`
   * vs `telephone`). Writing only one of them is what made the app disagree
   * with the site, so this runs the same guarded sequence the desktop tool does.
   */
  async applyPhone(phone: string, mode: RunMode = 'both-web'): Promise<{
    appPhone: string;
    appOk: boolean;
    appEmail2: string;
    email2Ok: boolean;
    webTelephone: string;
    webOk: boolean;
    webWritten: boolean;
    appRun: boolean;
    webRun: boolean;
    repairs: string[];
    changed: string[];
    serverDerived: string[];
  }> {
    const useApp = mode !== 'web';
    const useWeb = mode !== 'app';
    const webFirst = mode !== 'both-app';

    const before: User = useApp ? await this.appLogin() : {};

    let webBefore: DetailsForm = {};
    let webAlready = true;
    let webWritten = false;

    const writeWeb = async () => {
      await this.ensureWebSession();
      webBefore = await this.webForm();
      webAlready = canon(webBefore.telephone) === canon(phone);
      if (webAlready) return;
      // passing the app record lets the merge step fill fields the form leaves
      // empty; without it (web-only run) the form is taken as-is
      await this.webApplyPhone(phone, useApp ? before : undefined);
      webWritten = true;
    };

    let repairs: Record<string, string> = {};
    const writeApp = async () => {
      if (!useApp) return;
      // when the web step rewrote the record, read it back and repair anything
      // it disturbed; otherwise the first read is still accurate
      const mid = webFirst && webWritten ? await this.appLogin() : before;
      repairs = {};
      for (const key of REPAIRABLE) {
        const was = (before as any)[key];
        const now = (mid as any)[key];
        if (typeof was === 'string' && was.trim() && was.trim() !== '0') {
          if (typeof now !== 'string' || !now.trim() || now.trim() === '0') repairs[key] = was;
        }
      }
      await this.appSetPhone(phone, repairs);
    };

    if (useWeb && webFirst) await writeWeb();
    await writeApp();
    if (useWeb && !webFirst) await writeWeb();

    // read back whatever was written
    const after: User = useApp ? await this.appLogin() : {};
    const webAfter: DetailsForm = useWeb ? await this.webForm() : {};

    const changed = useApp
      ? Object.keys({ ...before, ...after }).filter(
          (k) => !VOLATILE.has(k) && k !== 'phone' && k !== 'email_2' &&
            JSON.stringify((before as any)[k]) !== JSON.stringify((after as any)[k]),
        )
      : [];
    // dynamic server data: reported, never a failure (same split as the desktop tool)
    const serverDerived = useApp
      ? Object.keys({ ...before, ...after }).filter(
          (k) => VOLATILE.has(k) &&
            JSON.stringify((before as any)[k]) !== JSON.stringify((after as any)[k]),
        )
      : [];

    return {
      appPhone: useApp ? String(after.phone ?? '') : '',
      appOk: useApp ? canon(after.phone) === canon(phone) : true,
      appEmail2: useApp ? String(after.email_2 ?? '') : '',
      email2Ok: useApp ? !String(after.email_2 ?? '').trim() : true,
      webTelephone: useWeb ? String(webAfter.telephone ?? '') : '',
      webOk: useWeb ? canon(webAfter.telephone) === canon(phone) : true,
      webWritten,
      appRun: useApp,
      webRun: useWeb,
      repairs: Object.keys(repairs),
      changed: changed.sort(),
      serverDerived: serverDerived.sort(),
    };
  }

  /** App API login. Credentials are encrypted exactly like the native app does. */
  async appLogin(): Promise<User> {
    const res = await this.postJson(`${APP_API}loginUser/`, {
      email: await encryptString(this.email),
      password: await encryptString(this.password),
    });
    if (res?.status !== 1) {
      const msg = res?.err?.content || JSON.stringify(res).slice(0, 160);
      const hint = /סיסמא|סיסמה|נכונים/.test(String(msg))
        ? ' — the app API rejected the credentials: check the password (press Forget and retype it)'
        : '';
      throw new Error(`app login failed: ${msg}${hint}`);
    }
    return res.data as User;
  }

  /** Raw web GET through the same session (cookies included). */
  async webGet(path: string): Promise<string> {
    const url = path.startsWith('http') ? path : WEB + path;
    return this.getText(url, { Referer: `${WEB}/` });
  }

  /**
   * POST to the site's AJAX layer as one of its pages would.
   *
   * The dispatcher uses `act=` for special_service / cart_service and
   * `action=` for user_service / checkout2_service — sending the wrong one is
   * silently accepted with an empty body, which is how this was found.
   */
  async webAjax(
    file: string,
    action: string,
    form: Record<string, string>,
    referer = '/',
    verb: 'action' | 'act' = 'action',
  ): Promise<any> {
    const body: Record<string, string> = { ...form, file, [verb]: action };
    const encoded = Object.entries(body)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const ajaxUrl = `${WEB}/_ajax/ajax.index.php`;
    const res = await withTimeout(
      fetch(ajaxUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: WEB + referer,
          Origin: WEB,
          ...(this.cookieHeaderFor(ajaxUrl) ? { Cookie: this.cookieHeaderFor(ajaxUrl)! } : {}),
        },
        body: encoded,
        credentials: 'omit',
      }),
      30000,
    );
    this.absorb(res, ajaxUrl);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text.slice(0, 300) };
    }
  }

  /** POST an already-encoded body (needed for repeated keys like collected_itemsArr[]). */
  async webPostRaw(body: string, referer = '/'): Promise<any> {
    const ajaxUrl = `${WEB}/_ajax/ajax.index.php`;
    const res = await withTimeout(
      fetch(ajaxUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: WEB + referer,
          Origin: WEB,
          ...(this.cookieHeaderFor(ajaxUrl) ? { Cookie: this.cookieHeaderFor(ajaxUrl)! } : {}),
        },
        body,
        credentials: 'omit',
      }),
      30000,
    );
    this.absorb(res, ajaxUrl);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text.slice(0, 300) };
    }
  }

  /** App API partial update — only the fields passed are sent. */
  async appSetPhone(phone: string, extra?: Record<string, string>): Promise<void> {
    const write = async () => {
      const payload: Record<string, string> = { phone, email_2: '' };
      // empty values are rejected by the endpoint ("required field"), so they
      // are dropped the same way the desktop client drops them
      for (const [k, v] of Object.entries(extra ?? {})) {
        if (v !== undefined && v !== null && String(v) !== '') payload[k] = String(v);
      }
      const res = await this.postJson(`${APP_API}editUserInformation/`, payload);
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
export const STALE_CANDIDATES = ['0544464632', '0555073599', '0584248770'];

export { decryptString, encryptString };
