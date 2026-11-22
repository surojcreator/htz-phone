// Solve the Cloudflare orchestrated challenge on htz.mltp.co.il, then read GetBalance.
import { chromium } from 'playwright';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
const BASE = 'https://htz.mltp.co.il';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stealth = () => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'languages', { get: () => ['he-IL', 'he', 'en-US', 'en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  window.chrome = window.chrome || { runtime: {} };
  const orig = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function (p) {
    if (p === 37445) return 'Intel Inc.';
    if (p === 37446) return 'Intel Iris OpenGL Engine';
    return orig.call(this, p);
  };
  const q = navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query = (params) =>
    params.name === 'notifications' ? Promise.resolve({ state: 'prompt' }) : q(params);
};

async function probe(page, label) {
  await page.goto(`${BASE}/GetBalance`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 20; i++) {
    const body = await page.evaluate(() => document.body?.innerText?.slice(0, 300) ?? '').catch(() => '');
    const title = await page.title().catch(() => '');
    if (body && !/Just a moment|רק רגע/.test(title) && !/Just a moment/.test(body)) {
      console.log(`· ${label} · title "${title}" · body:`, body.replace(/\s+/g, ' ').slice(0, 300));
      return true;
    }
    await sleep(1500);
  }
  console.log(`· ${label} · still challenged · title "${await page.title().catch(() => '')}"`);
  return false;
}

async function run({ headless, channel }) {
  const dir = `./.cf-${channel ?? 'c'}-${Date.now()}`;
  const ctx = await chromium.launchPersistentContext(dir, {
    headless,
    channel,
    userAgent: UA,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    viewport: { width: 1366, height: 900 },
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  try {
    await ctx.addInitScript(stealth);
    const page = await ctx.newPage();
    console.log(`· warm up ${BASE}/ (headless=${headless})`);
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});

    // let the orchestrated challenge settle; move the mouse a bit like a human
    for (let i = 0; i < 30; i++) {
      const t = await page.title().catch(() => '');
      if (t && !/Just a moment|רק רגע/.test(t)) break;
      await page.mouse.move(200 + i * 7, 300 + i * 5).catch(() => {});
      await sleep(1200);
    }
    const clear = (await ctx.cookies(BASE)).find((c) => c.name === 'cf_clearance');
    console.log('· cf_clearance:', clear ? 'yes' : 'none');

    if (await probe(page, 'GetBalance')) return true;
    // second attempt after a longer idle
    await sleep(8000);
    return await probe(page, 'GetBalance retry');
  } finally {
    await ctx.close().catch(() => {});
  }
}

(async () => {
  for (const cfg of [
    { headless: false, channel: 'chrome' },
    { headless: true, channel: 'chrome' },
  ]) {
    try {
      if (await run(cfg)) {
        console.log('\nOK');
        return;
      }
    } catch (e) {
      console.log(`✗ ${cfg.channel} headless=${cfg.headless}:`, String(e?.message ?? e).slice(0, 140));
    }
  }
  console.log('\nno clearance');
})();
