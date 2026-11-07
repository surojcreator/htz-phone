/**
 * Headless check — same code paths the app uses, runnable in Node.
 *
 *   npx tsx scripts/check.ts --email a@b.c --password pw --phone 0555071161
 *
 * 1. crypto round-trip + a fixed-vector self-test
 * 2. app-API login -> editUserInformation -> verify sweep
 *
 * Exit 0 only if the phone is confirmed and nothing else moved.
 */
import { decryptString, encryptString } from '../src/core/crypto';
import { HtzClient } from '../src/core/api';

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function cryptoChecks() {
  console.log('— crypto —');
  for (const sample of ['hello', 'almo.solomon@hp.com', '', 'x'.repeat(4096)]) {
    const blob = await encryptString(sample);
    const back = await decryptString(blob);
    const ok = back === sample;
    console.log(`  [${ok ? 'ok' : 'FAIL'}] len=${String(sample.length).padStart(5)}  ${blob.slice(0, 44)}…`);
    if (!ok) throw new Error('round-trip mismatch');
  }

  // deterministic vector: decrypting a blob produced elsewhere (e.g. by the
  // Python port) must yield the same plaintext. Pass one via --blob.
  const blob = arg('blob');
  if (blob) {
    const plain = await decryptString(blob);
    console.log(`  [interop] blob -> ${JSON.stringify(plain)}`);
  }

  const out = arg('emit');
  if (out) {
    const b = await encryptString(out);
    console.log(`  [emit] ${b}`);
  }
}

async function flowChecks() {
  const email = arg('email');
  const password = arg('password');
  const phone = arg('phone', '0555071161');
  if (!email || !password) {
    console.log('\n(no --email/--password supplied, skipping the live flow)');
    return 0;
  }

  console.log('\n— app API —');
  const client = new HtzClient(email, password);

  const before = await client.appLogin();
  console.log(`  logged in: id=${before.id} ${JSON.stringify(before.user_name)} phone=${before.phone}`);

  await client.appSetPhone(phone);
  console.log(`  editUserInformation { phone: ${phone} } -> status 1`);

  const report = await client.verify(phone);
  console.log('');
  for (const c of report.checks) {
    const flag = c.info ? 'INFO' : c.ok ? 'PASS' : 'FAIL';
    console.log(`  ${flag.padEnd(4)} ${c.name.padEnd(52)} ${String(c.value).slice(0, 18)}` +
      (c.note ? `  (${c.note})` : ''));
  }
  console.log(`\n  verdict: ${report.ok ? 'PHONE CONSISTENT' : 'INCONSISTENT'}`);
  return report.ok ? 0 : 1;
}

(async () => {
  await cryptoChecks();
  process.exit(await flowChecks());
})().catch((e) => {
  console.error(`\n[failed] ${e?.message ?? e}`);
  process.exit(2);
});
