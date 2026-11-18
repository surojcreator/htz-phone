import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { HtzClient } from '../core/api';
import { checkPhone, checkQty } from '../core/format';
import {
  addToCart,
  CartSummary,
  clearCart,
  parseProductRef,
  payFromWallet,
  ProductRef,
  readCart,
  readProduct,
  WalletPayResult,
} from '../core/wallet';
import { theme } from '../ui/theme';
import { useCreds } from '../ui/credentials';
import { useDefaults } from '../ui/defaults';
import { Field } from './SetPhoneScreen';

export default function ProductScreen() {
  const creds = useCreds();
  const { defaults } = useDefaults();

  const [product, setProduct] = useState('');
  const [qty, setQty] = useState('1');
  const [variantId, setVariantId] = useState('');
  const [phone, setPhone] = useState(defaults.orderPhone);
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [found, setFound] = useState<ProductRef | null>(null);
  const [cart, setCart] = useState<CartSummary | null>(null);
  const [deliveryId, setDeliveryId] = useState<number | null>(null);
  const [pay, setPay] = useState<WalletPayResult | null>(null);
  const [autoPay, setAutoPay] = useState(true);

  const qtyCheck = checkQty(qty, 99);
  const phoneCheck = checkPhone(phone);
  const ref = parseProductRef(product);
  const canRun = !!creds.email.trim() && !!creds.password && !!ref && qtyCheck.ok && phoneCheck.ok && !busy;

  const push = (l: string) => setLines((prev) => (prev.length > 400 ? [...prev.slice(-400), l] : [...prev, l]));
  const client = () => new HtzClient(creds.email.trim(), creds.password);

  async function lookup() {
    if (!ref) return push('· paste a product URL or id first');
    setBusy(true);
    try {
      const c = client();
      await c.ensureWebSession();
      const p = await readProduct(c, product);
      setFound(p);
      push(`· ${p.title}`);
      if (p.variants.length) {
        for (const v of p.variants.slice(0, 8)) push(`   variant ${v.id} · ₪${v.price} — ${v.label}`);
      } else {
        push('   no variant list on the page — if the add fails with "choose a model", paste the model id');
      }
    } catch (e: any) {
      push('✗ ' + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!ref) return push('· paste a product URL or id first');
    setBusy(true);
    try {
      const c = client();
      await c.ensureWebSession();

      // Auto-resolve the model id: vouchers and catalogue items both expose it
      // as the first price option, so a pasted URL is enough to add.
      let resolved: ProductRef | null = found && found.id === ref.id ? found : null;
      if (!resolved) {
        resolved = await readProduct(c, product);
        setFound(resolved);
      }
      const vid = variantId.trim() ? Number(variantId.trim()) : resolved.variants[0]?.id;
      if (!vid) push('· no model id on the page — paste one in the field above');

      const res = await addToCart(c, { kind: ref.kind, id: ref.id, qty: qtyCheck.value, variantId: vid });
      if (!res.ok) {
        push('✗ add: ' + res.error);
        return;
      }
      const sum = await readCart(c, ref.kind);
      setCart(sum);
      autoPickDelivery(sum);
      push(`✓ added — cart ${sum.kind}: ${sum.units} unit(s) · ₪${sum.total}`);
      if (sum.deliveries.length) push(`· ${sum.deliveries.length} delivery option(s) — pick one`);
      if (sum.addressRequired) push('· this cart needs a delivery address');

      if (autoPay) await payNow(c, sum);
    } catch (e: any) {
      push('✗ ' + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  }

  function autoPickDelivery(sum: CartSummary) {
    if (deliveryId && sum.deliveries.some((d) => d.id === deliveryId)) return;
    const hasAddress = !!(address.trim() && city.trim());
    const usable = sum.deliveries.filter((d) => (d.usesAddress ? hasAddress : true) && !d.needsPoint);
    const pick = usable[0] || sum.deliveries.find((d) => !d.needsPoint) || null;
    setDeliveryId(pick ? pick.id : null);
    if (pick) push(`· delivery: ${pick.label}`);
    else if (sum.deliveries.length) push('· every delivery option needs an address or a pickup point');
  }

  async function payNow(c?: HtzClient, sum?: CartSummary) {
    const client0 = c ?? client();
    try {
      if (!c) await client0.ensureWebSession();
      const profile = await client0.webProfile();
      const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim() || '—';
      const kind = ref?.kind ?? 'regular';
      const body = {
        kind,
        name,
        phone: phoneCheck.value,
        email: String(profile.email || creds.email),
        ...(address.trim() && city.trim() ? { address: { address: address.trim(), city: city.trim() } } : {}),
        ...(deliveryId && cart?.deliveries.length
          ? { delivery: [{ supplier_id: cart.deliveries.find((d) => d.id === deliveryId)!.supplierId, delivery_link_id: deliveryId }] }
          : {}),
      };
      push('· asking the store what the wallet covers…');
      const res = await payFromWallet(client0, body as any);
      setPay(res);
      if (!res.ok) {
        push('✗ ' + (res.error || 'payment failed'));
        return;
      }
      if (res.paid) {
        push(`✓ PAID from wallet — order ${res.orderId} · ₪${res.total} (covered ₪${res.covered})`);
        if (res.relocation) push('  → ' + res.relocation);
        setCart(sum ?? (await readCart(client0, kind)));
      } else {
        push(
          `· order ${res.orderId} · ₪${res.total} — wallet covers ₪${res.covered}, ₪${res.toPay} left by card`,
        );
        if (res.cardUrl) push('  CARD → ' + res.cardUrl);
      }
    } catch (e: any) {
      push('✗ ' + (e?.message ?? String(e)));
    }
  }

  async function empty() {
    if (!ref) return;
    setBusy(true);
    try {
      const c = client();
      await c.ensureWebSession();
      await clearCart(c, ref.kind);
      setCart(await readCart(c, ref.kind));
      setPay(null);
      push('· cart cleared');
    } catch (e: any) {
      push('✗ ' + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function openCard(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      await Share.share({ message: url, url }).catch(() => {});
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.h1}>Buy with wallet</Text>
        <Text style={styles.sub}>
          Add any htzone product to the cart and pay it from the account's wallet balance. If the
          balance does not cover the total, the order waits at the card step for the remainder.
        </Text>

        <Field label="Email" value={creds.email} onChange={creds.setEmail} keyboard="email-address" placeholder="name@company.co.il" />
        <Field label="Password" value={creds.password} onChange={creds.setPassword} secure placeholder="account password" />

        <Field
          label="Product URL or id"
          value={product}
          onChange={setProduct}
          placeholder="https://www.htzone.co.il/item/49464/…"
        />
        <Text style={styles.hint}>
          /item/… goes to the regular cart · /wallet_attraction_item/… goes to the quick cart
        </Text>

        <Field label="Qty" value={qty} onChange={setQty} keyboard="number-pad" error={qty.length > 0 && !qtyCheck.ok ? qtyCheck.error : undefined} />
        <Field
          label="Model / variant id (blank = first on the page)"
          value={variantId}
          onChange={setVariantId}
          keyboard="number-pad"
          placeholder="needed when the store says 'choose a model'"
        />
        <Field
          label="Order phone"
          value={phone}
          onChange={setPhone}
          keyboard="phone-pad"
          error={phone.length > 0 && !phoneCheck.ok ? phoneCheck.error : undefined}
        />
        <Field label="Delivery address (only if the cart asks)" value={address} onChange={setAddress} placeholder="street, house, city" />
        <Field label="City" value={city} onChange={setCity} placeholder="city name" />

        <View style={styles.switchRow}>
          <Text style={[styles.label, { flex: 1 }]}>Pay from wallet right after adding</Text>
          <Switch
            value={autoPay}
            onValueChange={setAutoPay}
            trackColor={{ true: theme.accent, false: theme.border }}
            thumbColor="#fff"
          />
        </View>

        <View style={styles.row}>
          <Pressable
            onPress={lookup}
            disabled={busy || !ref}
            style={({ pressed }) => [styles.ghost, (!ref || busy) && styles.dim, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.ghostText}>Look up</Text>
          </Pressable>
          <Pressable
            onPress={add}
            disabled={!canRun}
            style={({ pressed }) => [styles.button, { flex: 1 }, !canRun && styles.buttonDisabled, pressed && { opacity: 0.85 }]}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Add · pay from wallet</Text>}
          </Pressable>
          <Pressable
            onPress={empty}
            disabled={busy || !ref}
            style={({ pressed }) => [styles.ghost, (!ref || busy) && styles.dim, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.ghostText}>Clear</Text>
          </Pressable>
        </View>

        {cart && cart.deliveries.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Delivery</Text>
            {cart.deliveries.map((d) => (
              <Pressable
                key={`${d.supplierId}-${d.id}`}
                onPress={() => setDeliveryId(d.id)}
                style={[styles.option, deliveryId === d.id && styles.optionActive]}
              >
                <Text style={[styles.optionText, deliveryId === d.id && { color: theme.accent }]}>
                  {deliveryId === d.id ? '● ' : '○ '}
                  {d.label} {d.price ? `(+₪${d.price})` : '(free)'}
                </Text>
                {d.usesAddress && <Text style={styles.optionHint}>needs the address fields above</Text>}
                {d.needsPoint && <Text style={styles.optionHint}>needs a pickup point — not supported yet</Text>}
              </Pressable>
            ))}
          </View>
        )}

        {cart && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Cart · {cart.kind}</Text>
            {cart.lines.length === 0 && <Text style={styles.mono}>empty</Text>}
            {cart.lines.map((l, i) => (
              <Text key={i} style={styles.mono} selectable>
                {l.title.slice(0, 60)} · {l.qty} × ₪{l.price}
              </Text>
            ))}
            <Text style={[styles.mono, { marginTop: 6, fontWeight: '700' }]}>
              total ₪{cart.total} · {cart.units} unit(s)
            </Text>
          </View>
        )}

        {pay?.orderId ? (
          <View style={[styles.card, { borderColor: pay.paid ? theme.ok : theme.warn }]}>
            <Text style={[styles.cardTitle, { color: pay.paid ? theme.ok : theme.warn }]}>
              {pay.paid ? 'paid from wallet' : 'waiting for the card step'}
            </Text>
            <Text style={styles.mono}>
              order {pay.orderId} · ₪{pay.total} · wallet ₪{pay.covered}
              {pay.paid ? '' : ` · card ₪${pay.toPay}`}
            </Text>
            {!!pay.cardUrl && (
              <Pressable
                onPress={() => openCard(pay.cardUrl!)}
                style={({ pressed }) => [styles.cardButton, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.cardButtonText}>Open card page</Text>
              </Pressable>
            )}
          </View>
        ) : null}

        {lines.length > 0 && (
          <View style={styles.card}>
            <Pressable
              onPress={() => Share.share({ message: lines.join('\n') }).catch(() => {})}
              style={({ pressed }) => [styles.shareButton, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.shareText}>Share log</Text>
            </Pressable>
            {lines.map((l, i) => (
              <Text key={i} style={styles.mono} selectable numberOfLines={4}>
                {l}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: theme.pad, paddingBottom: 48 },
  h1: { color: theme.text, fontSize: 24, fontWeight: '700', marginTop: 8 },
  sub: { color: theme.dim, fontSize: 13, marginTop: 6, lineHeight: 19 },
  label: { color: theme.dim, fontSize: 12, marginBottom: 6, letterSpacing: 0.3 },
  hint: { color: theme.dim, fontSize: 11, marginTop: 6 },
  row: { flexDirection: 'row', gap: 10, marginTop: 22, alignItems: 'stretch' },
  button: { backgroundColor: theme.accent, borderRadius: theme.radius, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
  buttonDisabled: { backgroundColor: '#27406b' },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  ghost: { borderColor: theme.border, borderWidth: 1, borderRadius: theme.radius, paddingHorizontal: 14, justifyContent: 'center' },
  ghostText: { color: theme.dim, fontSize: 13.5, fontWeight: '700' },
  dim: { opacity: 0.45 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 18,
    backgroundColor: theme.cardAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  card: {
    marginTop: 20,
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    padding: theme.pad,
  },
  cardTitle: { color: theme.text, fontSize: 15, fontWeight: '700', marginBottom: 10 },
  option: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  optionActive: { borderColor: theme.accent, backgroundColor: theme.cardAlt },
  optionText: { color: theme.text, fontSize: 13 },
  optionHint: { color: theme.dim, fontSize: 11, marginTop: 2 },
  cardButton: { marginTop: 10, backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  cardButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  shareButton: {
    alignSelf: 'flex-start',
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 10,
  },
  shareText: { color: theme.dim, fontSize: 11.5, fontWeight: '700' },
  mono: { color: theme.dim, fontSize: 12, lineHeight: 18 },
});
