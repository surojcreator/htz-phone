/**
 * Headless check for the חנוכה loop port.
 *
 *   npx tsx scripts/hanukka-check.ts --item 166122 --qty 4 --phone 0555073599 --dry-run
 *
 * Credentials from --email/--password or HTZ_EMAIL/HTZ_PASS.
 * Dry run prints the pay_order_wallet body and never pays.
 */
import { HtzClient } from '../src/core/api';
import { buildPayBody, parseVariants, runHanukka } from '../src/core/hanukka';

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

(async () => {
  const email = arg('email', process.env.HTZ_EMAIL || '');
  const password = arg('password', process.env.HTZ_PASS || '');
  if (!email || !password) {
    console.error('need --email/--password or HTZ_EMAIL/HTZ_PASS');
    process.exit(2);
  }

  const client = new HtzClient(email, password);
  const res = await runHanukka(client, {
    itemId: arg('item', '166122'),
    qty: parseInt(arg('qty', '4'), 10) || 4,
    phone: arg('phone', '0555073599'),
    collected: arg('collect', undefined as unknown as string) || undefined,
    dryRun: process.argv.includes('--dry-run'),
    log: (l) => console.log('  ' + l),
  });

  if (res.variants.length) {
    console.log('\n  variants:');
    for (const v of res.variants) console.log(`    ${v.id}  ₪${v.price}  ${v.desc}`);
  }
  if (res.payload) {
    console.log('\n  pay_order_wallet body:');
    console.log(res.payload.split('&').map((p) => '    ' + p).join('\n'));
  }
  if (res.raw) {
    console.log('\n  raw response:');
    console.log('   ' + JSON.stringify(res.raw).slice(0, 1200));
  }
  console.log('\n  RESULT:', res.ok ? (res.relocation ? 'NEXT ' + res.relocation : res.cardUrl ? 'CARD REQUIRED -> ' + res.cardUrl : 'dry-run ok') : 'FAILED ' + (res.error || ''));
  process.exit(res.ok ? 0 : 1);
})();
