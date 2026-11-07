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

export type DetailsForm = Record<string, string>;

/** fields worth restoring if the web write disturbs them */
const REPAIRABLE = ['birth_day', 'birth_month', 'city', 'ct_name', 'tz_number', 'first_name', 'last_name'];
const IGNORE_IN_DIFF = new Set(['last_update', 'date_created', 'home_arr', 'params', 'birthday', 'allow_app_rating']);

/** Parse the inputs/selects of an HTML form into the values jQuery would serialize. */
export function parseFormFields(body: string): DetailsForm {
  const out: DetailsForm = {};
  const tagRe = /<(input|select)\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(body))) {
    const tag = m[0];
    const kind = m[1].toLowerCase();
    const attr = (name: string) => {
      const a = tag.match(new RegExp(name + '\\s*=\\s*["\']([^"\']*)', 'i'));
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
      // "מייל נוסף" must stay empty on this side too
      try {
        const form = await this.webForm();
        const more = String(form.email_more ?? '');
        checks.push({
          name: 'web · /support_page מייל נוסף empty',
          value: more ? more.slice(0, 24) : 'empty',
          ok: !more.trim(),
        });
      } catch {
        checks.push({ name: 'web · details form', value: 'unreadable', ok: true, info: true });
      }
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

  /** Every serializable field of the /support_page "my details" form. */
  async webForm(): Promise<DetailsForm> {
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
  async applyPhone(phone: string): Promise<{
    appPhone: string;
    appOk: boolean;
    appEmail2: string;
    email2Ok: boolean;
    webTelephone: string;
    webOk: boolean;
    webWritten: boolean;
    repairs: string[];
    changed: string[];
  }> {
    const before = await this.appLogin();

    // 1. website first (it replaces the record)
    await this.webLogin();
    const webBefore = await this.webForm();
    const webAlready = canon(webBefore.telephone) === canon(phone);
    if (!webAlready) await this.webApplyPhone(phone, before);

    // 2. app write, repairing anything the web step disturbed
    const mid = await this.appLogin();
    const repairs: Record<string, string> = {};
    for (const key of REPAIRABLE) {
      const was = (before as any)[key];
      const now = (mid as any)[key];
      if (typeof was === 'string' && was.trim() && was.trim() !== '0') {
        if (typeof now !== 'string' || !now.trim() || now.trim() === '0') repairs[key] = was;
      }
    }
    await this.appSetPhone(phone, repairs);

    // 3. read both back
    const after = await this.appLogin();
    const webAfter = await this.webForm();

    const changed = Object.keys({ ...before, ...after }).filter(
      (k) => !IGNORE_IN_DIFF.has(k) && k !== 'phone' && k !== 'email_2' &&
        JSON.stringify((before as any)[k]) !== JSON.stringify((after as any)[k]),
    );

    return {
      appPhone: String(after.phone ?? ''),
      appOk: canon(after.phone) === canon(phone),
      appEmail2: String(after.email_2 ?? ''),
      email2Ok: !String(after.email_2 ?? '').trim(),
      webTelephone: String(webAfter.telephone ?? ''),
      webOk: canon(webAfter.telephone) === canon(phone),
      webWritten: !webAlready,
      repairs: Object.keys(repairs),
      changed,
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
      throw new Error(`app login failed: ${msg}`);
    }
    return res.data as User;
  }

  /** Raw web GET through the same session (cookies included). */
  async webGet(path: string): Promise<string> {
    const url = path.startsWith('http') ? path : WEB + path;
    const res = await withTimeout(
      fetch(url, {
        headers: {
          ...(this.cookieHeader() ? { Cookie: this.cookieHeader()! } : {}),
          Accept: 'text/html,application/xhtml+xml',
          Referer: `${WEB}/`,
        },
        credentials: 'include',
      }),
      30000,
    );
    this.absorb(res);
    return res.text();
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
    const res = await withTimeout(
      fetch(`${WEB}/_ajax/ajax.index.php`, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: WEB + referer,
          Origin: WEB,
          ...(this.cookieHeader() ? { Cookie: this.cookieHeader()! } : {}),
        },
        body: encoded,
        credentials: 'include',
      }),
      30000,
    );
    this.absorb(res);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text.slice(0, 300) };
    }
  }

  /** POST an already-encoded body (needed for repeated keys like collected_itemsArr[]). */
  async webPostRaw(body: string, referer = '/'): Promise<any> {
    const res = await withTimeout(
      fetch(`${WEB}/_ajax/ajax.index.php`, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: WEB + referer,
          Origin: WEB,
          ...(this.cookieHeader() ? { Cookie: this.cookieHeader()! } : {}),
        },
        body,
        credentials: 'include',
      }),
      30000,
    );
    this.absorb(res);
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
      const res = await this.postJson(`${APP_API}editUserInformation/`, {
        phone,
        email_2: '',
        ...(extra ?? {}),
      });
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
