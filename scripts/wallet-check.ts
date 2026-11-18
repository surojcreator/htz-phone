/**
 * Exercise the app's own wallet code against the live store:
 * add a catalogue product, choose delivery, draft, read obligo, get the result.
 */
import { HtzClient } from '../src/core/api';
import { addToCart, clearCart, payFromWallet, readCart } from '../src/core/wallet';

const EMAIL = 'yoel.bokobza@partner.samsung.com';
const PASS = 'lolo1234';

(async () => {
  const c = new HtzClient(EMAIL, PASS);
  await c.ensureWebSession();
  const me = await c.webProfile();
  const name = [me.first_name, me.last_name].filter(Boolean).join(' ').trim();

  console.log('=== catalogue product (regular cart) ===');
  await clearCart(c, 'regular');
  const add = await addToCart(c, { kind: 'regular', id: 52078, qty: 1 });
  console.log('add:', add.ok ? 'ok' : add.error);
  const cart = await readCart(c, 'regular');
  console.log('cart:', cart.kind, 'lines', cart.lines.length, 'total', cart.total, 'deliveries', cart.deliveries.length);
  for (const d of cart.deliveries) console.log(`   ${d.id} ${d.type} "${d.label.slice(0, 40)}" addr=${d.usesAddress} point=${d.needsPoint}`);

  const standard = cart.deliveries.find((d) => d.usesAddress && !d.needsPoint) || cart.deliveries[0];
  const res = await payFromWallet(c, {
    kind: 'regular',
    name,
    phone: '0555073599',
    email: EMAIL,
    address: { address: 'הרצל 1', city: 'תל אביב' },
    delivery: standard ? [{ supplier_id: standard.supplierId, delivery_link_id: standard.id }] : undefined,
  });
  console.log('wallet result:', JSON.stringify(res, null, 2).slice(0, 600));

  console.log('\n=== wallet attraction (quick cart) ===');
  await clearCart(c, 'quick');
  const add2 = await addToCart(c, { kind: 'quick', id: 166122, qty: 2, variantId: 252787 });
  console.log('add:', add2.ok ? 'ok' : add2.error);
  const cart2 = await readCart(c, 'quick');
  console.log('cart:', cart2.kind, 'units', cart2.units, 'total', cart2.total, 'deliveries', cart2.deliveries.length);
  const res2 = await payFromWallet(c, { kind: 'quick', name, phone: '0555073599', email: EMAIL });
  console.log('wallet result:', JSON.stringify(res2, null, 2).slice(0, 600));

  await clearCart(c, 'regular');
  await clearCart(c, 'quick');
  console.log('\ncarts cleared');
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
