import { HtzClient, WEB, APP_API } from '../src/core/api';

const [email, password] = process.argv.slice(2);

const PHONE_RE = /\b0\d{8,9}\b/g;

function scan(label: string, blob: string) {
  const hits = new Map<string, number>();
  for (const m of blob.matchAll(PHONE_RE)) hits.set(m[0], (hits.get(m[0]) || 0) + 1);
  const list = [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(`\n${label} — ${hits.size} distinct phone-like values`);
  for (const [v, n] of list) console.log(`   ${v}  x${n}`);
}

(async () => {
  const c = new HtzClient(email, password);

  // ---- app API record -------------------------------------------------
  const u = await c.appLogin();
  console.log('== app API user object ==');
  for (const [k, v] of Object.entries(u)) {
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/phone|tel|mobile|cell|whatsapp|contact/i.test(k) || /^\s*0\d{8,9}\s*$/.test(s)) {
      console.log(`   ${k} = ${JSON.stringify(s).slice(0, 80)}`);
    }
  }

  // ---- web details form ----------------------------------------------
  await c.webLogin();
  const form = await c.webForm();
  console.log('\n== web details form ==');
  for (const [k, v] of Object.entries(form)) {
    if (/phone|tel|mobile|cell|whatsapp|contact/i.test(k) || /^\s*0\d{8,9}\s*$/.test(v)) {
      console.log(`   ${k} = ${JSON.stringify(v)}`);
    }
  }

  // ---- raw pages ------------------------------------------------------
  const support = await c.webGet('/support_page');
  scan('raw /support_page', support);

  const checkout = await c.webGet('/checkout2_wallet').catch((e) => 'ERR ' + e.message);
  scan('raw /checkout2_wallet', checkout);
  const coInputs = [...checkout.matchAll(/<input[^>]*name=['"]([^'"]+)['"][^>]*>/gi)]
    .map((m) => m[0])
    .filter((t) => /phone|tel/i.test(t));
  console.log('\ncheckout phone inputs:');
  for (const t of coInputs.slice(0, 10)) console.log('   ' + t.replace(/\s+/g, ' ').slice(0, 140));

  // ---- app API endpoints that might hold a phone ----------------------
  for (const ep of ['getUserInformation', 'getUserData', 'getProfile', 'getUserDetails']) {
    try {
      const r = await (c as any).postJson(APP_API + ep + '/', {});
      const s = JSON.stringify(r).slice(0, 200);
      console.log(`\n${ep}: ${s}`);
    } catch (e: any) {
      console.log(`\n${ep}: ${e.message.slice(0, 80)}`);
    }
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
