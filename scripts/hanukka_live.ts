/**
 * Live, headless חנוכה test — no emulator, no UI.
 *
 *   npx tsx scripts/hanukka_live.ts --email you@example.com --password '...'
 *   npx tsx scripts/hanukka_live.ts --email ... --password ... --order
 *
 * Without --order it only verifies the accounts, prints the Htzone-money
 * balance and the discovered candidate list (most expensive first). With
 * --order it places ONE staged order with a new card and prints the
 * before/after Htzone money.
 */
import { HtzClient } from '../src/core/api';
import { newHanukkaSession, previewHanukkaCandidates, runHanukkaAdaptive } from '../src/core/hanukka';

const argv = process.argv.slice(2);
const has = (k: string) => argv.includes(k);
const flag = (k: string, d = '') => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const email = flag('--email', process.env.HTZ_EMAIL || '');
const password = flag('--password', process.env.HTZ_PASS || '');
const phone = flag('--phone', process.env.HTZ_PHONE || '0500000000');
const qty = Math.max(1, parseInt(flag('--qty', '1'), 10) || 1);
const onlyItem = flag('--item', '');

if (!email || !password) {
  console.error('usage: --email <email> --password <pass> [--order] [--qty N] [--phone 05...]');
  process.exit(2);
}

(async () => {
  const client = new HtzClient(email.trim(), password);
  const session = newHanukkaSession();

  console.log('— account —');
  client.resetSession();
  await client.webLogin();
  session.loggedIn = true;
  const profile = await client.webProfile();
  console.log('  web email :', profile.email || '(not returned)');
  if (profile.email && String(profile.email).toLowerCase() !== email.trim().toLowerCase()) {
    console.error('  WRONG ACCOUNT: expected', email, 'got', profile.email);
    process.exit(1);
  }

  client.resetAppSession();
  const appUser: any = await client.appLogin();
  console.log('  app email :', appUser?.email || '(not returned)');
  const w0 = await client.appWallet();
  console.log('  htzone money before: ₪' + w0.total, '· wallet rows', w0.obligo.length);

  console.log('\n— candidates —');
  const candidates = await previewHanukkaCandidates(client, {
    itemId: onlyItem || '166122',
    onlyItem: onlyItem || undefined,
    qty,
    phone,
    session,
  });
  console.log(`  ${candidates.length} candidate(s), most expensive first:`);
  for (const c of candidates.slice(0, 20)) {
    console.log(
      `   ₪${String(c.price).padStart(6)}  ${c.isProShop ? 'PRO   ' : 'חנוכה'}  ${c.itemId}  variant ${c.variantId}  ${c.title}${c.max ? `  max ${c.max}` : ''}`,
    );
  }
  if (candidates.length > 20) console.log(`   … ${candidates.length - 20} more`);

  if (!has('--order')) {
    console.log('\nDiscovery only. Add --order to place ONE staged new-card order.');
    return;
  }

  console.log('\n— one staged order —');
  const res = await runHanukkaAdaptive(client, {
    itemId: onlyItem || '166122',
    onlyItem: onlyItem || undefined,
    qty,
    phone,
    session,
    dryRun: false,
    log: (l) => console.log('  ' + l),
  });
  console.log('\nresult:', {
    ok: res.ok,
    itemId: res.itemId,
    variantId: res.variantId,
    price: res.price,
    orderId: res.orderId,
    cardUrl: res.cardUrl,
    error: res.error,
    moneyBefore: res.moneyBefore,
    moneyAfter: res.moneyAfter,
    moneyDelta: res.moneyDelta,
  });

  const w1 = await client.appWallet();
  console.log('htzone money after: ₪' + w1.total, '· wallet rows', w1.obligo.length);
  console.log('delta: ₪' + (w1.total - w0.total));

  if (has('--wait') && res.cardUrl) {
    const secs = Math.max(30, parseInt(flag('--wait-seconds', '180'), 10) || 180);
    console.log(`\nPay the card page now. Polling the Android app API wallet for ${secs}s...`);
    const deadline = Date.now() + secs * 1000;
    let last = w1.total;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      const w = await client.appWallet();
      if (w.total !== last) {
        console.log(`  wallet changed: ₪${last} → ₪${w.total}`);
        last = w.total;
      } else {
        process.stdout.write('.');
      }
    }
    const wf = await client.appWallet();
    console.log('\nfinal app-API wallet: ₪' + wf.total, '· wallet rows', wf.obligo.length);
  }
})().catch((e) => {
  console.error('FAILED:', e?.message ?? e);
  process.exit(1);
});
