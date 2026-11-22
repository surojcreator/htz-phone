import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { HtzClient } from '../core/api';
import { checkPhone, checkQty } from '../core/format';
import { pushHistory } from '../core/history';
import {
  addToCart,
  CartLine,
  CartSummary,
  clearCart,
  mergeCarts,
  parseProductRef,
  payFromWallet,
  ProductRef,
  readCart,
  readNativeCart,
  readProductWebview,
  readWallet,
  removeCartLine,
  setCartQty,
  verifyAddedItem,
  WalletPayResult,
} from '../core/wallet';
import { useCreds } from '../ui/credentials';
import { useDefaults } from '../ui/defaults';
import { theme } from '../ui/theme';
import { Field } from '../ui/Field';

type Kind = 'regular' | 'quick';

/** A product with many in-stock models needs an explicit pick, same as the site. */
function pickVariant(r: ProductRef, typed: string): number | undefined {
  const manual = typed.trim() ? Number(typed.trim()) : NaN;
  if (Number.isFinite(manual) && manual > 0) return manual;
  const inStock = r.variants.filter((v) => v.inStock !== false);
  if (inStock.length === 1) return inStock[0].id;
  return undefined;
}

export default function CartScreen() {
  const creds = useCreds();
  const { defaults, loaded: defaultsLoaded } = useDefaults();

  const [kind, setKind] = useState<Kind>('regular');
  const [product, setProduct] = useState('');
  const [qty, setQty] = useState('1');
  const [variantId, setVariantId] = useState('');
  const [phone, setPhone] = useState(defaults.orderPhone);
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');

  const [cart, setCart] = useState<CartSummary | null>(null);
  const [wallet, setWallet] = useState<{ ok: boolean; total: number; error?: string } | null>(null);
  const [deliveryId, setDeliveryId] = useState<number | null>(null);
  const [pay, setPay] = useState<WalletPayResult | null>(null);

  const [busy, setBusy] = useState(false);
  const [lineBusy, setLineBusy] = useState<string | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [found, setFound] = useState<ProductRef | null>(null);

  const autoLoaded = useRef(false);
  const seededPhone = useRef(false);

  // Stored order phone is the starting value; typing wins from then on.
  useEffect(() => {
    if (!defaultsLoaded || seededPhone.current) return;
    seededPhone.current = true;
    setPhone(defaults.orderPhone);
  }, [defaultsLoaded, defaults.orderPhone]);

  // The resolved product (and its model list) belongs to the current URL only.
  useEffect(() => {
    setFound(null);
    setVariantId('');
  }, [product]);

  const qtyCheck = checkQty(qty, 999);
  const phoneCheck = checkPhone(phone);
  const ref = parseProductRef(product);
  const modelNeeded =
    !!found &&
    found.id === ref?.id &&
    found.variants.filter((v) => v.inStock !== false).length > 1 &&
    !variantId.trim();
  const canAdd = !!creds.email.trim() && !!creds.password && !!ref && qtyCheck.ok && !busy && !modelNeeded;
  const canPay = !!creds.email.trim() && !!creds.password && !!cart && cart.lines.length > 0 && phoneCheck.ok && !busy;

  const push = useCallback((l: string) => {
    setLines((prev) => (prev.length > 400 ? [...prev.slice(-400), l] : [...prev, l]));
  }, []);

  const client = useCallback(() => new HtzClient(creds.email.trim(), creds.password), [creds.email, creds.password]);

  const pickDelivery = useCallback(
    (sum: CartSummary, wanted: number | null, hasAddress: boolean) => {
      if (wanted && sum.deliveries.some((d) => d.id === wanted)) return wanted;
      const usable = sum.deliveries.filter((d) => (d.usesAddress ? hasAddress : true) && !d.needsPoint);
      return usable[0]?.id ?? sum.deliveries.find((d) => !d.needsPoint)?.id ?? null;
    },
    [],
  );

  const applyCart = useCallback(
    (sum: CartSummary) => {
      setCart(sum);
      setDeliveryId((prev) => pickDelivery(sum, prev, !!(address.trim() && city.trim())));
    },
    [address, city, pickDelivery],
  );

  const refresh = useCallback(
    async (c?: HtzClient, quiet = false) => {
      const client0 = c ?? client();
      if (!c) await client0.ensureWebSession();
      let sum = await readCart(client0, kind);
      try {
        const native = await readNativeCart(client0);
        sum = mergeCarts(sum, native) ?? sum;
      } catch {
        /* native cart unavailable */
      }
      applyCart(sum);
      if (!quiet) push(`• cart ${sum.kind}: ${sum.lines.length} line(s) · ${sum.units} unit(s) · ₪${sum.total}`);
      return sum;
    },
    [applyCart, client, kind, push],
  );

  // Restored credentials get one silent cart load so the tab opens with state.
  useEffect(() => {
    if (autoLoaded.current || !creds.loaded) return;
    if (creds.rememberState !== 'saved') return;
    const e = creds.email.trim();
    if (!e || !creds.password) return;
    autoLoaded.current = true;
    (async () => {
      try {
        const c = new HtzClient(e, creds.password);
        await c.ensureWebSession();
        let sum = await readCart(c, kind);
        try {
          const native = await readNativeCart(c);
          sum = mergeCarts(sum, native) ?? sum;
        } catch {
          /* native cart unavailable */
        }
        setCart(sum);
        setDeliveryId(pickDelivery(sum, null, false));
      } catch {
        /* silent: credentials may be stale */
      }
    })();
  }, [creds.loaded, creds.rememberState, creds.email, creds.password, kind, pickDelivery]);

  async function switchKind(next: Kind) {
    if (next === kind) return;
    setKind(next);
    setPay(null);
    setCart(null);
    if (!creds.email.trim() || !creds.password) return;
    setBusy(true);
    try {
      const c = client();
      await c.ensureWebSession();
      let sum = await readCart(c, next);
      try {
        const native = await readNativeCart(c);
        sum = mergeCarts(sum, native) ?? sum;
      } catch {
        /* native cart unavailable */
      }
      setCart(sum);
      setDeliveryId(pickDelivery(sum, null, !!(address.trim() && city.trim())));
      push(`• cart ${sum.kind}: ${sum.lines.length} line(s) · ₪${sum.total}`);
    } catch (e: any) {
      push('✗ ' + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function loadCart() {
    if (!creds.email.trim() || !creds.password) return push('• email and password first');
    setBusy(true);
    try {
      const c = client();
      push('• logging in…');
      await c.ensureWebSession();
      await refresh(c);
    } catch (e: any) {
      push('✗ ' + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function loadMax() {
    if (!ref) return push('• paste a product URL or id first');
    setBusy(true);
    try {
      const c = client();
      const p = found && found.id === ref.id ? found : await readProductWebview(c, product, ref.kind);
      setFound(p);
      const inStock = p.variants.filter((v) => v.inStock !== false);
      const v = inStock[0];
      const max = v?.max ?? 99;
      setQty(String(max));
      push(`· max ${max}${v?.label ? ` · ${v.label}` : ''}`);
    } catch (e: any) {
      push('✗ max: ' + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!ref) return push('• paste a product URL or id first');
    setBusy(true);
    try {
      const c = client();

      let resolved: ProductRef | null = found && found.id === ref.id ? found : null;
      if (!resolved) {
        resolved = await readProductWebview(c, product, ref.kind);
        setFound(resolved);
      }
      const vid = pickVariant(resolved, variantId);
      const available = resolved.variants.filter((v) => v.inStock !== false);
      if (!vid && available.length > 1) {
        setFound(resolved);
        push('• this product has models — choose one below, then press Add again');
        return;
      }
      if (!vid && resolved.variants.length === 0) push('• no model id on the page — paste one above');

      const res = await addToCart(c, { kind, id: ref.id, qty: qtyCheck.value, variantId: vid });
      if (!res.ok) return push('✗ add: ' + res.error);

      const verdict = await verifyAddedItem(c, kind, ref.id, vid);
      let sum = await refresh(c, true);
      if (!sum.lines.some((l) => l.itemId === ref.id)) {
        try {
          const native = await readNativeCart(c);
          sum = mergeCarts(sum, native) ?? sum;
          setCart(sum);
        } catch {
          /* keep the web cart view */
        }
      }
      if (!verdict.ok) {
        push('✗ ' + verdict.error);
        return;
      }
      push(`✓ added ${resolved.title.slice(0, 60)} · ${sum.lines.length} line(s) · ₪${sum.total}`);
    } catch (e: any) {
      push('✗ ' + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function changeQty(line: CartLine, delta: number) {
    if (!cart) return;
    const next = line.qty + delta;
    if (next < 1) return remove(line);
    setLineBusy(line.key || String(line.itemId));
    try {
      const c = client();
      const res = await setCartQty(c, kind, line, next, cart.version);
      if (!res.ok) return push('✗ qty: ' + res.error);
      const sum = await refresh(c, true);
      push(`• ${line.title.slice(0, 40)} → ${next} · ₪${sum.total}`);
    } catch (e: any) {
      push('✗ ' + (e?.message ?? String(e)));
    } finally {
      setLineBusy(null);
    }
  }

  async function remove(line: CartLine) {
    if (!cart) return;
    setLineBusy(line.key || String(line.itemId));
    try {
      const c = client();
      const res = await removeCartLine(c, kind, line, cart.version);
      if (!res.ok) return push('✗ remove: ' + res.error);
      const sum = await refresh(c, true);
      push(`• removed ${line.title.slice(0, 40)} · ₪${sum.total}`);
    } catch (e: any) {
      push('✗ ' + (e?.message ?? String(e)));
    } finally {
      setLineBusy(null);
    }
  }

  function confirmEmpty() {
    if (!cart || cart.lines.length === 0) return;
    Alert.alert('Clear the cart?', `This removes ${cart.lines.length} line(s) from the ${kind} cart.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: empty },
    ]);
  }

  async function empty() {
    setBusy(true);
    try {
      const c = client();
      await c.ensureWebSession();
      await clearCart(c, kind, cart?.version);
      const sum = await refresh(c, true);
      setPay(null);
      push(`• cart cleared · ₪${sum.total}`);
    } catch (e: any) {
      push('✗ ' + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function checkWallet() {
    if (!creds.email.trim() || !creds.password) return push('• email and password first');
    setWalletBusy(true);
    try {
      const c = client();
      const w = await readWallet(c);
      setWallet(w);
      if (w.ok) push(`• wallet balance ₪${w.total}`);
      else push('✗ wallet: ' + w.error);
    } finally {
      setWalletBusy(false);
    }
  }

  async function payNow() {
    if (!cart || cart.lines.length === 0) return push('• add something to the cart first');
    if (!phoneCheck.ok) return push('✗ ' + phoneCheck.error);
    setBusy(true);
    try {
      const c = client();
      await c.ensureWebSession();
      const profile = await c.webProfile();
      const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim() || '—';
      const picked = cart.deliveries.find((d) => d.id === deliveryId);

      push('• asking the store what the wallet covers…');
      const res = await payFromWallet(c, {
        kind,
        name,
        phone: phoneCheck.value,
        email: String(profile.email || creds.email),
        ...(address.trim() && city.trim() ? { address: { address: address.trim(), city: city.trim() } } : {}),
        ...(picked ? { delivery: [{ supplier_id: picked.supplierId, delivery_link_id: picked.id }] } : {}),
        version: cart.version,
      });
      setPay(res);

      if (!res.ok) return push('✗ ' + (res.error || 'payment failed'));
      void pushHistory({
        kind: 'buy',
        account: creds.email.trim(),
        ok: true,
        summary: res.paid ? 'paid from wallet' : 'staged for card',
        orderId: res.orderId,
        total: res.total,
        cardUrl: res.cardUrl,
      });
      if (res.paid) {
        push(`✓ PAID from wallet — order ${res.orderId} · ₪${res.total} (covered ₪${res.covered})`);
        if (res.relocation) push('  → ' + res.relocation);
        setCart(null);
        setWallet(wallet ? { ...wallet, total: Math.max(0, wallet.total - (res.covered ?? 0)) } : wallet);
      } else {
        push(`• order ${res.orderId} · ₪${res.total} — wallet covers ₪${res.covered}, ₪${res.toPay} left by card`);
        if (res.cardUrl) push('  CARD → ' + res.cardUrl);
      }
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
        <Text style={styles.h1}>Cart</Text>
        <Text style={styles.sub}>
          Add products to the cart, then pay the whole cart from the account wallet balance. If the
          balance does not cover the total, the order stops at the card step with a payment link.
        </Text>


        <View style={styles.chips}>
          {(['regular', 'quick'] as Kind[]).map((k) => (
            <Pressable
              key={k}
              onPress={() => switchKind(k)}
              style={[styles.chip, kind === k && styles.chipActive]}
            >
              <Text style={[styles.chipText, kind === k && styles.chipTextActive]}>
                {k === 'regular' ? 'Regular cart' : 'Quick cart'}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>
          /item/… goes to the regular cart · /wallet_attraction_item/… goes to the quick cart
        </Text>

        <Text style={styles.section}>Add a product</Text>
        <Field
          label="Product URL or id"
          value={product}
          onChange={setProduct}
          placeholder="https://www.htzone.co.il/item/49464/…"
        />
        <View style={styles.qtyRow}>
          <View style={{ flex: 1 }}>
            <Field
              label="Qty"
              value={qty}
              onChange={setQty}
              keyboard="number-pad"
              error={qty.length > 0 && !qtyCheck.ok ? qtyCheck.error : undefined}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Model id (blank = auto)"
              value={variantId}
              onChange={setVariantId}
              keyboard="number-pad"
              placeholder="only if asked"
            />
          </View>
          <Pressable
            onPress={loadMax}
            disabled={busy || !ref}
            style={({ pressed }) => [styles.maxBtn, (busy || !ref) && styles.dim, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.maxBtnText}>Max</Text>
          </Pressable>
        </View>

        {found && found.variants.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Model</Text>
            {found.variants.map((v) => {
              const selected = String(v.id) === variantId.trim();
              const out = v.inStock === false;
              return (
                <Pressable
                  key={v.id}
                  onPress={() => setVariantId(String(v.id))}
                  disabled={out}
                  style={[styles.option, selected && styles.optionActive, out && styles.dim]}
                >
                  <Text style={[styles.optionText, selected && { color: theme.accent }]}>
                    {selected ? '● ' : '○ '}
                    {v.label || `model ${v.id}`}
                    {v.price > 0 ? ` · ₪${v.price}` : ''}
                    {out ? ' · out of stock' : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={styles.row}>
          <Pressable
            onPress={loadCart}
            disabled={busy}
            style={({ pressed }) => [styles.ghost, busy && styles.dim, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.ghostText}>Load cart</Text>
          </Pressable>
          <Pressable
            onPress={add}
            disabled={!canAdd}
            style={({ pressed }) => [styles.button, { flex: 1 }, !canAdd && styles.buttonDisabled, pressed && { opacity: 0.85 }]}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{modelNeeded ? 'Select a model' : 'Add to cart'}</Text>}
          </Pressable>
          <Pressable
            onPress={confirmEmpty}
            disabled={busy || !cart || cart.lines.length === 0}
            style={({ pressed }) => [
              styles.ghost,
              (busy || !cart || cart.lines.length === 0) && styles.dim,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.ghostText}>Clear</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Cart · {cart?.kind ?? kind}</Text>
            <Text style={styles.dimText}>v{cart?.version ?? '—'}</Text>
          </View>
          {!cart && <Text style={styles.mono}>not loaded yet — press Load cart</Text>}
          {cart && cart.lines.length === 0 && <Text style={styles.mono}>empty</Text>}
          {cart?.lines.map((l) => {
            const id = l.key || String(l.itemId);
            const working = lineBusy === id;
            return (
              <View key={id} style={styles.line}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lineTitle} numberOfLines={2}>
                    {l.title || `item ${l.itemId}`}
                  </Text>
                  <Text style={styles.mono}>
                    ₪{l.price} each{l.variantId ? ` · model ${l.variantId}` : ''}
                  </Text>
                  {!!l.invalid && <Text style={styles.invalid}>{l.invalid}</Text>}
                </View>
                {working ? (
                  <ActivityIndicator color={theme.dim} style={{ marginHorizontal: 16 }} />
                ) : (
                  <View style={styles.stepper}>
                    <Pressable onPress={() => changeQty(l, -1)} style={styles.stepBtn} hitSlop={8}>
                      <Text style={styles.stepText}>−</Text>
                    </Pressable>
                    <Text style={styles.qtyText}>{l.qty}</Text>
                    <Pressable onPress={() => changeQty(l, +1)} style={styles.stepBtn} hitSlop={8}>
                      <Text style={styles.stepText}>+</Text>
                    </Pressable>
                    <Pressable onPress={() => remove(l)} style={styles.removeBtn} hitSlop={8}>
                      <Text style={styles.removeText}>✕</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
          {cart?.warnings.map((w, i) => (
            <Text key={`w-${i}`} style={styles.invalid}>
              {w}
            </Text>
          ))}
          {!!cart && (
            <Text style={styles.total}>
              total ₪{cart.total} · {cart.units} unit(s)
            </Text>
          )}
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
                {d.usesAddress && <Text style={styles.optionHint}>needs the address fields below</Text>}
                {d.needsPoint && <Text style={styles.optionHint}>needs a pickup point — not supported here</Text>}
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Checkout</Text>
          <View style={styles.walletRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Wallet balance</Text>
              <Text style={styles.walletValue}>
                {walletBusy ? '…' : wallet ? (wallet.ok ? `₪${wallet.total}` : 'unavailable') : 'not checked'}
              </Text>
              {!!wallet?.error && <Text style={styles.hint}>{wallet.error}</Text>}
            </View>
            <Pressable
              onPress={checkWallet}
              disabled={walletBusy}
              style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.ghostText}>{walletBusy ? '…' : 'Check'}</Text>
            </Pressable>
          </View>

          <Field
            label="Order phone"
            value={phone}
            onChange={setPhone}
            keyboard="phone-pad"
            error={phone.length > 0 && !phoneCheck.ok ? phoneCheck.error : undefined}
          />
          <Field label="Delivery address (if asked)" value={address} onChange={setAddress} placeholder="street, house" />
          <Field label="City" value={city} onChange={setCity} placeholder="city" />

          <Pressable
            onPress={payNow}
            disabled={!canPay}
            style={({ pressed }) => [styles.button, styles.payButton, !canPay && styles.buttonDisabled, pressed && { opacity: 0.85 }]}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Pay cart from wallet</Text>}
          </Pressable>
        </View>

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
            {lines.slice(-60).map((l, i) => (
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
  section: { color: theme.text, fontSize: 16, fontWeight: '700', marginTop: 26, marginBottom: 8 },
  label: { color: theme.dim, fontSize: 12, marginBottom: 6, letterSpacing: 0.3 },
  hint: { color: theme.dim, fontSize: 11, marginTop: 4 },
  chips: { flexDirection: 'row', gap: 8, marginTop: 18, flexWrap: 'wrap' },
  chip: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: theme.card,
  },
  chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.dim, fontSize: 13, fontWeight: '700' },
  chipTextActive: { color: '#fff' },
  qtyRow: { flexDirection: 'row', gap: 10 },
  maxBtn: {
    borderColor: theme.accent,
    borderWidth: 1,
    borderRadius: theme.radius,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  maxBtnText: { color: theme.accent, fontSize: 13, fontWeight: '800' },
  row: { flexDirection: 'row', gap: 10, marginTop: 18, alignItems: 'stretch' },
  button: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 15,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { backgroundColor: '#27406b' },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  ghost: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ghostText: { color: theme.dim, fontSize: 13.5, fontWeight: '700' },
  dim: { opacity: 0.45 },
  dimText: { color: theme.dim, fontSize: 11 },
  card: {
    marginTop: 20,
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    padding: theme.pad,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: theme.text, fontSize: 15, fontWeight: '700', marginBottom: 10 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopColor: theme.border,
    borderTopWidth: 1,
    paddingVertical: 10,
  },
  lineTitle: { color: theme.text, fontSize: 13.5, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepBtn: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.cardAlt,
  },
  stepText: { color: theme.text, fontSize: 17, fontWeight: '700', lineHeight: 20 },
  qtyText: { color: theme.text, fontSize: 13, fontWeight: '700', minWidth: 22, textAlign: 'center' },
  removeBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', marginLeft: 2 },
  removeText: { color: theme.bad, fontSize: 14, fontWeight: '800' },
  total: { color: theme.text, fontSize: 14, fontWeight: '800', marginTop: 12 },
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
  walletRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  walletValue: { color: theme.text, fontSize: 22, fontWeight: '800' },
  payButton: { marginTop: 16 },
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
  invalid: { color: theme.bad, fontSize: 11, marginTop: 3, lineHeight: 15 },
  mono: { color: theme.dim, fontSize: 12, lineHeight: 18 },
});
