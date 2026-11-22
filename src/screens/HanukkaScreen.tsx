import React, { useEffect, useRef, useState } from 'react';
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
  Switch,
  Text,
  Vibration,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { HtzClient, WEB } from '../core/api';
import { HANUKKA_GROUP, HANUKKA_ITEMS, HanukkaResult, newHanukkaSession, readItemPage, runHanukkaAdaptive } from '../core/hanukka';
import { readWalletGrants, walletGrantsText } from '../core/grants';
import { checkoutNativeCart } from '../core/wallet';
import { runWalletGrantLoop, walletProjectCheckout } from '../core/walletProject';
import { startKeepAlive, stopKeepAlive } from '../core/keepAlive';
import { checkInt, checkPhone, checkQty } from '../core/format';
import { pushHistory } from '../core/history';
import { theme } from '../ui/theme';
import { useCreds } from '../ui/credentials';
import { useDefaults } from '../ui/defaults';
import { Field } from '../ui/Field';

export default function HanukkaScreen() {
  const creds = useCreds();
  const { defaults, loaded, patch } = useDefaults();
  const [itemId, setItemId] = useState(HANUKKA_ITEMS[0].id);
  const [qty, setQty] = useState('4');
  const [phone, setPhone] = useState('0555073599');
  const [variant, setVariant] = useState('');
  const [repeats, setRepeats] = useState('1');
  const [delay, setDelay] = useState('1200');
  const [dryRun, setDryRun] = useState(true);
  const [reload, setReload] = useState(false);
  const [background, setBackground] = useState(true);
  const [freshLogin, setFreshLogin] = useState(true);
  const [busy, setBusy] = useState(false);
  const [maxBusy, setMaxBusy] = useState(false);
  const [watching, setWatching] = useState(false);
  const [grantCount, setGrantCount] = useState('4');
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantProgress, setGrantProgress] = useState('');
  const grantStopRef = useRef(false);
  const [maxQty, setMaxQty] = useState<number | null>(null);
  const [limitNote, setLimitNote] = useState('');
  const [progress, setProgress] = useState('');
  const [continueOnError, setContinueOnError] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [result, setResult] = useState<HanukkaResult | null>(null);
  const cancelRef = useRef(false);
  const seeded = useRef(false);
  const watchRef = useRef(false);

  // defaults from the Defaults tab, applied once
  useEffect(() => {
    if (!loaded || seeded.current) return;
    seeded.current = true;
    setItemId(defaults.itemId || HANUKKA_ITEMS[0].id);
    setQty(String(defaults.qty));
    setPhone(defaults.orderPhone);
    setVariant(defaults.variant);
    setRepeats(String(defaults.repeats));
    setDelay(String(defaults.delay));
    setDryRun(defaults.dryRun);
    setBackground(defaults.background);
    setFreshLogin(defaults.freshLogin);
  }, [loaded]);

  // A new item/variant invalidates the previously read maximum.
  useEffect(() => {
    setMaxQty(null);
    setLimitNote('');
  }, [itemId, variant]);

  // Read the store's real max for the selected item so the form is accurate.
  useEffect(() => {
    if (!loaded || !creds.email.trim() || !creds.password || !itemId.trim()) return;
    loadMax();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, variant, loaded, creds.email, creds.password]);

  const phoneCheck = checkPhone(phone);
  const qtyCheck = checkQty(qty, 999);

  async function run() {
    cancelRef.current = false;
    setBusy(true);
    setLines([]);
    setResult(null);
    const push = (l: string) => setLines((prev) => (prev.length > 800 ? [...prev.slice(-800), l] : [...prev, l]));
    const total = Math.min(10000, Math.max(1, checkInt(repeats, 1, 1)));
    const gap = checkInt(delay, 1200, 0);
    const started = Date.now();
    let done = 0;
    let failed = 0;
    let keptAlive = false;
    let awake = false;
    try {
      try {
        await activateKeepAwakeAsync('htz-run');
        awake = true;
      } catch { /* screen may still sleep; the loop keeps running anyway */ }
      if (background) {
        keptAlive = await startKeepAlive();
        push(keptAlive
          ? '· background keep-alive on — you can leave the app'
          : '· background keep-alive unavailable; keep the app open');
      }
      const client = new HtzClient(creds.email.trim(), creds.password);
      const session = newHanukkaSession();
      for (let i = 1; i <= total; i++) {
        if (cancelRef.current) {
          push('— cancelled —');
          break;
        }
        const eta = done > 0 ? Math.round(((Date.now() - started) / done) * (total - done) / 1000) : 0;
        setProgress(`${i}/${total}` + (done > 0 ? ` · ${failed} failed · ~${eta}s left` : ''));

        // A long batch outlives its session: the store expires it or starts
        // refusing writes. Open a brand-new one every N orders instead of
        // discovering it halfway through an order.
        const refreshEvery = defaults.sessionRefreshEvery;
        const refreshing = i > 1 && refreshEvery > 0 && (i - 1) % refreshEvery === 0;
        if (refreshing) {
          session.loggedIn = false;
          push(`· refreshing session for order ${i}`);
        }

        push(`— run ${i}/${total} —`);
        const res = await runHanukkaAdaptive(client, {
          itemId,
          qty: qtyCheck.value,
          phone: phoneCheck.value,
          collected: variant.trim() || undefined,
          dryRun,
          session,
          freshLogin,
          forceSessionRefresh: refreshing,
          retryOnRateLimit: defaults.rateLimitRetries,
          forceReload: reload && i > 1,
          nativeCheckout: true,
          shouldStop: () => cancelRef.current,
          log: push,
        });
        setResult(res);
        if (res.payload) setLines((prev) => [...prev, '', ...res.payload!.split('\n')]);
        done++;
        if (!res.ok) {
          failed++;
          push(`✗ run ${i} failed: ${res.error || 'failed'}`);
          if (!continueOnError) {
            push('— stopping (continue-on-error is off) —');
            break;
          }
          push('— continuing —');
        }
        if (i < total && gap) await new Promise((r) => setTimeout(r, gap));
      }
      push(`— finished: ${done - failed}/${total} ok in ${Math.round((Date.now() - started) / 1000)}s —`);
    } catch (e: any) {
      push('✗ ' + (e?.message ?? String(e)));
    } finally {
      if (keptAlive) await stopKeepAlive();
      if (awake) { try { deactivateKeepAwake('htz-run'); } catch { /* ignore */ } }
      if (done > 0) {
        Vibration.vibrate(Platform.OS === 'ios' ? [0, 60, 80, 60] : [0, 120, 80, 120]);
        const last = result;
        void pushHistory({
          kind: 'order',
          account: creds.email.trim(),
          ok: failed === 0,
          summary: `${done - failed}/${total} ok`,
          orderId: last?.orderId,
          total: last?.total,
          cardUrl: last?.cardUrl,
          detail: failed && last?.error ? String(last.error).slice(0, 120) : undefined,
        });
      }
      setProgress('');
      setBusy(false);
    }
  }

  async function checkWalletAfterPay() {
    if (!creds.email.trim() || !creds.password) return;
    const push = (l: string) => setLines((prev) => [...prev, l]);
    try {
      const c = new HtzClient(creds.email.trim(), creds.password);
      const w = await c.appWallet();
      push(`· app API wallet: ₪${w.total}${w.obligo.length ? ` · ${w.obligo.length} wallet row(s)` : ''}`);
      // Same data as הארנק שלי → הטבות פעילות / הטבות לא פעילות on the site.
      const g = await readWalletGrants(c);
      push(`· grants: ₪${g.total} active · ${walletGrantsText(g)}`);
      for (const row of g.active.slice(0, 5)) push(`   ✓ ${row.title} · ₪${row.left}/${row.sum} · ${row.expiresAt}`);
      for (const row of g.inactive.slice(0, 5)) push(`   × ${row.title} · ₪${row.left}/${row.sum} · ${row.expiresAt}`);
    } catch (e: any) {
      push('✗ wallet check: ' + (e?.message ?? String(e)));
    }
  }

  /**
   * Watch הארנק שלי while an order is placed somewhere else (the site in a
   * webview, another device). Polls the app wallet and the site's grant list and
   * logs every change with a timestamp, so the moment a grant lands is visible
   * without guessing.
   */
  async function watchWallet() {
    if (watchRef.current) {
      watchRef.current = false;
      setWatching(false);
      setLines((prev) => [...prev, '· wallet watch stopped']);
      return;
    }
    if (!creds.email.trim() || !creds.password) return;
    watchRef.current = true;
    setWatching(true);
    const push = (l: string) => setLines((prev) => [...prev, l]);
    const stamp = () => new Date().toLocaleTimeString('he-IL');
    try {
      const c = new HtzClient(creds.email.trim(), creds.password);
      await c.appLogin();
      const w0 = await c.appWallet();
      const g0 = await readWalletGrants(c).catch(() => null);
      let lastTotal = w0.total;
      let lastRows = g0 ? g0.inactive.length + g0.active.length : -1;
      let lastActive = g0 ? g0.active.length : -1;
      push(`· watching the wallet from ${stamp()} — ₪${lastTotal} · ${lastRows} grant(s)`);

      for (let i = 0; i < 60 && watchRef.current; i++) {
        await new Promise((r) => setTimeout(r, 10000));
        if (!watchRef.current) break;
        const w = await c.appWallet().catch(() => null);
        const g = await readWalletGrants(c).catch(() => null);
        if (!w || !g) continue;
        const rows = g.inactive.length + g.active.length;
        if (w.total !== lastTotal || rows !== lastRows || g.active.length !== lastActive) {
          push(
            `${stamp()} · ₪${lastTotal} → ₪${w.total} · grants ${lastRows} → ${rows} (active ${lastActive} → ${g.active.length})`,
          );
          if (g.active.length) {
            for (const row of g.active.slice(0, 5)) push(`   ✓ ${row.title} · ₪${row.left}/${row.sum} · ${row.expiresAt}`);
          }
          lastTotal = w.total;
          lastRows = rows;
          lastActive = g.active.length;
        }
      }
      push('· wallet watch finished');
    } catch (e: any) {
      push('✗ watch: ' + (e?.message ?? String(e)));
    } finally {
      watchRef.current = false;
      setWatching(false);
    }
  }

  /**
   * The wallet-project checkout the site itself runs for these items:
   * /wallet_attraction_item → /checkout2_wallet → /api/wallet/cart → /api/wallet/pay.
   * It spends the live allocation (ארנק חוויות) instead of asking for a card.
   */
  async function runGrantLoop() {
    if (!creds.email.trim() || !creds.password) return;
    const push = (l: string) => setLines((prev) => [...prev, l]);
    const total = Math.min(500, Math.max(1, checkInt(grantCount, 4, 1)));
    grantStopRef.current = false;
    setGrantBusy(true);
    setGrantProgress('');
    try {
      const c = new HtzClient(creds.email.trim(), creds.password);
      const u: any = await c.appLogin();
      const tz = String(u.tz_number ?? '').trim();
      if (!tz) {
        push('✗ the account has no ת.ז on record — the wallet login needs it');
        return;
      }

      // products to spend allocations on: the configured item, the rest of the
      // חנוכה shop, then the regular PRO² shop — so a throttled shop can be
      // left behind instead of stalling the run.
      const shops: { project: number; ids: string[] }[] = [
        { project: 156, ids: [...new Set([itemId.trim(), '166122', '166119'].filter(Boolean))] },
        { project: 44, ids: ['160569', '155546', '96966', '152672'] },
      ];
      const targets: { itemId: number; variantId: number; label: string; projectId: number }[] = [];
      for (const shop of shops) {
        for (const id of shop.ids) {
          if (targets.length >= 10) break;
          const page = await readItemPage(c, id, String(shop.project)).catch(() => null);
          for (const v of (page?.variants ?? []).slice(0, 2)) {
            targets.push({
              itemId: Number(id),
              variantId: v.id,
              projectId: shop.project,
              label: `${id}/${v.id} ₪${v.price}${shop.project === 44 ? ' · PRO shop' : ''}`,
            });
          }
        }
      }
      if (!targets.length) {
        push('✗ no products could be read for the wallet loop');
        return;
      }
      push(`· ${targets.length} product(s) · running ${total}×`);

      const res = await runWalletGrantLoop(c, {
        count: total,
        tz,
        email: creds.email.trim(),
        targets,
        log: push,
        shouldStop: () => grantStopRef.current,
        onProgress: (done, all) => setGrantProgress(`${done}/${all}`),
      });

      push(
        `— grants: ${res.granted}/${total} · wallet ₪${res.walletBefore} → ₪${res.walletAfter}` +
          (res.error ? ` · ${res.error}` : res.stopped ? ' · stopped' : ''),
      );
    } catch (e: any) {
      push('✗ wallet loop: ' + (e?.message ?? String(e)));
    } finally {
      setGrantBusy(false);
      setGrantProgress('');
    }
  }

  async function checkoutWalletProject() {
    if (!creds.email.trim() || !creds.password) return;
    const push = (l: string) => setLines((prev) => [...prev, l]);
    push('· wallet checkout — /api/wallet/login → cart → pay');
    try {
      const c = new HtzClient(creds.email.trim(), creds.password);
      const u: any = await c.appLogin();
      const before = await c.appWallet();
      push(`· wallet before ₪${before.total}`);

      const page = await readItemPage(c, itemId.trim(), HANUKKA_GROUP).catch(() => null);
      const vs = page?.variants ?? [];
      const pick = variant.trim()
        ? vs.find((v) => String(v.id) === variant.trim())
        : [...vs].sort((a, b) => b.price - a.price)[0];
      if (!pick) {
        push('✗ could not read a model for ' + itemId);
        return;
      }
      push(`· ${qtyCheck.value}× ${itemId}/${pick.id} ₪${pick.price}`);

      const res = await walletProjectCheckout(c, {
        projectId: 156,
        itemId: Number(itemId),
        variantId: pick.id,
        qty: qtyCheck.value,
        identifier: String(u.tz_number ?? '').trim(),
        email: creds.email.trim(),
        name: [u.first_name, u.last_name].filter(Boolean).join(' ') || '—',
        phone: phoneCheck.value,
      });
      if (res.ok) {
        push(`✓ wallet order ${res.orderId ?? '?'}${res.total ? ` · ₪${res.total}` : ''}`);
      } else {
        push(`✗ ${res.stage}: ${res.error}${res.code ? ` (${res.code})` : ''}`);
      }

      const after = await c.appWallet();
      const delta = after.total - before.total;
      push(
        `· wallet after ₪${after.total}` +
          (delta > 0 ? `  ✓ +₪${delta} allocation` : delta < 0 ? ` (${delta})` : ' — unchanged'),
      );
    } catch (e: any) {
      push('✗ wallet checkout: ' + (e?.message ?? String(e)));
    }
  }

  async function checkoutNative() {
    if (!creds.email.trim() || !creds.password) return;
    const push = (l: string) => setLines((prev) => [...prev, l]);
    push('· native checkout — בצע הזמנה through the app API');
    try {
      const c = new HtzClient(creds.email.trim(), creds.password);
      await c.appLogin();
      const before = await c.appWallet();
      push(`· wallet before ₪${before.total}`);

      const cart = await c.appGetCart();
      let units = Number(cart?.total_items ?? 0);
      if (!units) {
        // Self-sufficient: put the configured item in the native cart, then submit.
        const page = await readItemPage(c, itemId.trim(), HANUKKA_GROUP).catch(() => null);
        const vs = page?.variants ?? [];
        // No model chosen means the most expensive one — the option the loop
        // works down from.
        const pick = variant.trim()
          ? vs.find((v) => String(v.id) === variant.trim())
          : [...vs].sort((a, b) => b.price - a.price)[0];
        if (!pick) {
          push('✗ could not read a model for ' + itemId);
          return;
        }
        const qty = qtyCheck.value;
        await c.appAddToCart({
          itemId: Number(itemId),
          itemType: 1,
          isQuick: 0,
          collectedIds: [{ id: pick.id, quantity: qty }],
        });
        units = Number((await c.appGetCart())?.total_items ?? 0);
        push(`· added ${qty}× ${itemId}/${pick.id} to the app cart`);
      }
      push(`· cart ${units} unit(s)`);

      const res = await checkoutNativeCart(c, { phone: phoneCheck.value, isQuick: 0 });
      if (res.ok) {
        push(`✓ order ${res.orderId ?? '?'} submitted · ₪${res.walletUsed ?? 0} from the wallet`);
      } else {
        push('✗ ' + (res.error ?? 'checkout failed'));
      }

      const after = await c.appWallet();
      const delta = after.total - before.total;
      push(`· wallet after ₪${after.total} (${delta > 0 ? '+' : ''}${delta})`);
    } catch (e: any) {
      push('✗ checkout: ' + (e?.message ?? String(e)));
    }
  }

  async function loadMax() {
    if (!creds.email.trim() || !creds.password) return;
    setMaxBusy(true);
    try {
      const c = new HtzClient(creds.email.trim(), creds.password);
      await c.ensureWebSession();
      const page = await readItemPage(c, itemId.trim(), HANUKKA_GROUP);
      const vs = page.variants;
      if (!vs.length) throw new Error('the item page has no models');
      const wanted = variant.trim() ? vs.find((v) => String(v.id) === variant.trim()) : vs[0];
      const max = wanted?.max;
      setMaxQty(max ?? null);
      const note = (page.html.match(/"purchaseLimitNote":"([^"]+)"/) || [])[1] || '';
      setLimitNote(note);
      setLines((prev) => [
        ...prev,
        `· max ${max ?? '?'} · ${wanted?.desc ?? ''}${note ? ` · ${note}` : ''}`,
      ]);
    } catch (e: any) {
      setLines((prev) => [...prev, '✗ max: ' + (e?.message ?? String(e))]);
    } finally {
      setMaxBusy(false);
    }
  }

  async function saveAsDefaults() {
    await patch({
      itemId,
      variant: variant.trim(),
      qty: qtyCheck.value,
      orderPhone: phoneCheck.value,
      repeats: Math.min(10000, Math.max(1, checkInt(repeats, 1, 1))),
      delay: checkInt(delay, 1200, 0),
      dryRun,
      background,
      freshLogin,
    });
    setLines((prev) => [...prev, '· current values saved as defaults']);
  }

  async function copyLog() {
    await Clipboard.setStringAsync(report).catch(() => {});
    setLines((prev) => [...prev, '· log copied to clipboard']);
  }

  /**
   * PPS links carry a transaction id that goes stale; asking again for the same
   * order returns a fresh one without creating a second order.
   */
  async function refreshPaymentLink() {
    const orderId = result?.orderId;
    if (!orderId || !creds.email.trim()) return;
    try {
      const c = new HtzClient(creds.email.trim(), creds.password);
      await c.ensureWebSession();
      const res = await c.webApi('POST', '/api/orders/payment-session', { order_id: orderId, new_card: true });
      const url = res.json?.data?.payment_url;
      if (res.status < 400 && url) {
        setResult((prev) => (prev ? { ...prev, cardUrl: String(url) } : prev));
        setLines((prev) => [...prev, `· new payment link for order ${orderId}`]);
      } else {
        setLines((prev) => [...prev, '· could not refresh the link: ' + HtzClient.apiError(res)]);
      }
    } catch (e: any) {
      setLines((prev) => [...prev, '· could not refresh the link: ' + (e?.message ?? String(e))]);
    }
  }

  async function clearCart() {
    if (!creds.email.trim() || !creds.password) {
      setLines((prev) => [...prev, '· enter the account email/password first']);
      return;
    }
    try {
      const c = new HtzClient(creds.email.trim(), creds.password);
      await c.ensureWebSession();
      const res = await c.webApi('DELETE', '/api/cart?kind=quick');
      setLines((prev) => [
        ...prev,
        res.status < 400 ? '· cart cleared' : '· could not clear the cart: ' + HtzClient.apiError(res),
      ]);
    } catch (e: any) {
      setLines((prev) => [...prev, '· could not clear the cart: ' + (e?.message ?? String(e))]);
    }
  }

  const canRun = !!creds.email.trim() && !!creds.password && phoneCheck.ok && qtyCheck.ok && !busy;

  function confirmAndRun() {
    const total = Math.min(10000, Math.max(1, checkInt(repeats, 1, 1)));
    if (dryRun) {
      void run();
      return;
    }
    Alert.alert(
      'Place real orders?',
      `${total} order(s) of ${qtyCheck.value} × ${itemId} with phone ${phoneCheck.value}.\n` +
        'Payment is left at the card step (new_card).',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Run', style: 'destructive', onPress: () => void run() },
      ],
    );
  }

  async function openCard(url: string) {
    // Relative or still-escaped URLs make iOS return "cannot open page"
    const absolute = url.startsWith('//') ? 'https:' + url : url;
    try {
      await Linking.openURL(absolute);
    } catch {
      await Share.share({ message: absolute, url: absolute }).catch(() => {});
    }
  }

  const report = lines.join('\n');

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.h1}>חנוכה order loop</Text>
        <Text style={styles.sub}>
          PRO² show tickets (group 156) + PRO shop. Auto-switches items from
          most expensive to cheapest when a purchase limit is hit. Every order is
          checked out with a new blank card (`new_card=true`, never a stored
          card); Htzone money is read through the Android app API before and after.
        </Text>


        <Text style={[styles.label, { marginTop: 16 }]}>Attraction</Text>
        <View style={styles.chips}>
          {HANUKKA_ITEMS.map((it) => (
            <Pressable
              key={it.id}
              onPress={() => setItemId(it.id)}
              style={[styles.chip, itemId === it.id && styles.chipActive]}
            >
              <Text style={[styles.chipText, itemId === it.id && styles.chipTextActive]}>{it.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Field
              label={`Qty${maxQty ? ` (max ${maxQty})` : ''}`}
              value={qty}
              onChange={setQty}
              keyboard="phone-pad"
              error={qty.length > 0 && !qtyCheck.ok ? qtyCheck.error : undefined}
            />
          </View>
          <Pressable
            onPress={loadMax}
            disabled={maxBusy || !itemId.trim()}
            style={({ pressed }) => [styles.maxButton, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.maxButtonText}>{maxBusy ? '…' : 'Max'}</Text>
          </Pressable>
        </View>
        {!!limitNote && <Text style={styles.hint}>{limitNote}</Text>}
        <Field
          label="Order phone"
          value={phone}
          onChange={setPhone}
          keyboard="phone-pad"
          error={phone.length > 0 && !phoneCheck.ok ? phoneCheck.error : undefined}
        />
        <Field label="Repeats (max 10000)" value={repeats} onChange={setRepeats} keyboard="phone-pad" />
        <Field label="Delay between repeats (ms)" value={delay} onChange={setDelay} keyboard="phone-pad" />
        <Field
          label="Preferred variant (auto-switch may override)"
          value={variant}
          onChange={setVariant}
        />
        <Text style={styles.hint}>
          The adaptive loop tries every item/variant from most expensive to cheapest; this field is not used by it.
        </Text>

        <View style={styles.switchRow}>
          <Text style={styles.label}>Dry run (print the payload, never pay)</Text>
          <Switch
            value={dryRun}
            onValueChange={setDryRun}
            trackColor={{ true: theme.accent, false: theme.border }}
            thumbColor="#fff"
          />
        </View>

        <View style={styles.switchRow}>
          <Text style={[styles.label, { flex: 1 }]}>Reload the item page on every repeat</Text>
          <Switch
            value={reload}
            onValueChange={setReload}
            trackColor={{ true: theme.accent, false: theme.border }}
            thumbColor="#fff"
          />
        </View>
        <Text style={styles.hint}>
          Off: one login and one item-page load for the whole batch — repeats go straight to cart + pay.
        </Text>

        <View style={styles.switchRow}>
          <Text style={[styles.label, { flex: 1 }]}>Log in fresh before the batch</Text>
          <Switch
            value={freshLogin}
            onValueChange={setFreshLogin}
            trackColor={{ true: theme.accent, false: theme.border }}
            thumbColor="#fff"
          />
        </View>
        <Text style={styles.hint}>
          On: a clean login before the first order (repeats still reuse it). Off: reuse whatever session is already open.
        </Text>

        <View style={styles.switchRow}>
          <Text style={[styles.label, { flex: 1 }]}>Keep running in the background</Text>
          <Switch
            value={background}
            onValueChange={setBackground}
            trackColor={{ true: theme.accent, false: theme.border }}
            thumbColor="#fff"
          />
        </View>
        <Text style={styles.hint}>
          iOS: holds a silent audio session so the loop keeps going when you switch apps or lock the screen.
          Android: same trick — set the app to Unrestricted battery use for long batches.
        </Text>

        <View style={styles.switchRow}>
          <Text style={[styles.label, { flex: 1 }]}>Continue after a failed run</Text>
          <Switch
            value={continueOnError}
            onValueChange={setContinueOnError}
            trackColor={{ true: theme.accent, false: theme.border }}
            thumbColor="#fff"
          />
        </View>

        <View style={styles.actionRow}>
          <Pressable
            onPress={confirmAndRun}
            disabled={!canRun}
            style={({ pressed }) => [
              styles.button,
              { flex: 1, marginTop: 0 },
              !canRun && styles.buttonDisabled,
              pressed && { opacity: 0.85 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                Run חנוכה loop ×{Math.min(10000, Math.max(1, checkInt(repeats, 1, 1)))}
                {dryRun ? ' (dry)' : ''}
              </Text>
            )}
          </Pressable>
          {busy && (
            <Pressable
              onPress={() => {
                cancelRef.current = true;
                setProgress('cancelling…');
              }}
              style={({ pressed }) => [styles.stopButton, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.stopText}>Stop</Text>
            </Pressable>
          )}
        </View>
        {!!progress && <Text style={styles.progress}>running {progress}</Text>}

        {/* Always available: wallet, the app's own בצע הזמנה, and a watcher. */}
        <View style={styles.card}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>Wallet & checkout</Text>
          <Pressable
            onPress={checkoutWalletProject}
            style={({ pressed }) => [styles.cardButton, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.cardButtonText}>בצע הזמנה (wallet)</Text>
          </Pressable>
          <Field
            label="wallet grants (how many times)"
            value={grantCount}
            onChange={setGrantCount}
            keyboard="number-pad"
            placeholder="4"
          />
          <View style={styles.actionRow}>
            <Pressable
              onPress={runGrantLoop}
              disabled={grantBusy}
              style={({ pressed }) => [
                styles.cardButton,
                { flex: 1 },
                grantBusy && { opacity: 0.6 },
                pressed && { opacity: 0.85 },
              ]}
            >
              {grantBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.cardButtonText}>
                  הרץ לופ ארנק ×{Math.min(500, Math.max(1, checkInt(grantCount, 4, 1)))}
                </Text>
              )}
            </Pressable>
            {grantBusy && (
              <Pressable
                onPress={() => {
                  grantStopRef.current = true;
                }}
                style={({ pressed }) => [styles.stopButton, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.stopText}>Stop</Text>
              </Pressable>
            )}
          </View>
          {!!grantProgress && <Text style={styles.progress}>grants {grantProgress}</Text>}
          <Pressable
            onPress={checkoutNative}
            style={({ pressed }) => [styles.cardButton, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.cardButtonText}>בצע הזמנה (app API)</Text>
          </Pressable>
          <Pressable
            onPress={checkWalletAfterPay}
            style={({ pressed }) => [styles.linkButton, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.linkButtonText}>Check wallet (Android app API)</Text>
          </Pressable>
          <Pressable
            onPress={watchWallet}
            style={({ pressed }) => [styles.linkButton, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.linkButtonText}>
              {watching ? 'Stop wallet watch' : 'נטר ארנק (10s · 10min)'}
            </Text>
          </Pressable>
        </View>

        {result && (
          <View style={[styles.card, { borderColor: result.ok ? theme.ok : theme.bad }]}>
            <Text style={[styles.cardTitle, { color: result.ok ? theme.ok : theme.bad }]}>
              {result.ok
                ? result.cardUrl
                  ? 'order staged — card entry required'
                  : result.relocation
                  ? 'order submitted'
                  : 'dry run ok'
                : 'failed'}
            </Text>
            {result.relocation && <Text style={styles.mono}>next → {result.relocation}</Text>}
            {!!result.orderId && (
              <Text style={styles.mono}>
                order {result.orderId}
                {typeof result.total === 'number' ? ` · ₪${result.total}` : ''}
                {typeof result.units === 'number' ? ` · ${result.units} unit(s)` : ''}
              </Text>
            )}
            {!!result.itemId && (
              <Text style={styles.mono}>
                bought {result.itemId}
                {result.variantId ? ` · variant ${result.variantId}` : ''}
                {typeof result.price === 'number' ? ` · ₪${result.price}` : ''}
              </Text>
            )}
            {typeof result.moneyBefore === 'number' && (
              <Text style={styles.mono}>
                Htzone money ₪{result.moneyBefore} → ₪{result.moneyAfter ?? result.moneyBefore}
                {typeof result.moneyDelta === 'number'
                  ? ` (${result.moneyDelta > 0 ? '+' : ''}${result.moneyDelta})`
                  : ''}
              </Text>
            )}
            {!!result.orderId && (
              <Pressable
                onPress={() => openCard(result.orderUrl || `${WEB}/checkout3_new/${result.orderId}`)}
                style={({ pressed }) => [styles.cardButton, { backgroundColor: theme.ok }, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.cardButtonText}>אישור הזמנה</Text>
              </Pressable>
            )}
            {result.error && <Text style={[styles.mono, { color: theme.bad }]}>{result.error}</Text>}
            {result.cardUrl && (
              <>
                <Text style={styles.mono} numberOfLines={2}>
                  {result.cardUrl}
                </Text>
                <Pressable
                  onPress={() => openCard(result.cardUrl!)}
                  style={({ pressed }) => [styles.cardButton, pressed && { opacity: 0.85 }]}
                >
                  <Text style={styles.cardButtonText}>Open card page</Text>
                </Pressable>
                <Pressable
                  onPress={refreshPaymentLink}
                  style={({ pressed }) => [styles.linkButton, pressed && { opacity: 0.85 }]}
                >
                  <Text style={styles.linkButtonText}>New payment link (if it expired)</Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        {!!result?.variants?.length && (
          <View style={styles.card}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Variants on the page</Text>
            {result.variants.map((v) => (
              <Text key={v.id} style={styles.mono} selectable>
                {v.id} · ₪{v.price}
                {v.fullPrice && v.fullPrice !== v.price ? ` (was ₪${v.fullPrice})` : ''}
                {v.max ? ` · max ${v.max}` : ''} — {v.desc}
              </Text>
            ))}
          </View>
        )}

        {lines.length > 0 && (
          <View style={styles.card}>
            <View style={styles.logActions}>
              <Pressable
                onPress={copyLog}
                style={({ pressed }) => [styles.shareButton, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.shareText}>Copy log</Text>
              </Pressable>
              <Pressable
                onPress={() => Share.share({ message: report }).catch(() => {})}
                style={({ pressed }) => [styles.shareButton, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.shareText}>Share log</Text>
              </Pressable>
              <Pressable
                onPress={saveAsDefaults}
                style={({ pressed }) => [styles.shareButton, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.shareText}>Save as defaults</Text>
              </Pressable>
              <Pressable
                onPress={clearCart}
                disabled={busy}
                style={({ pressed }) => [styles.shareButton, busy && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.shareText}>Clear cart</Text>
              </Pressable>
            </View>
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
  maxButton: {
    borderColor: theme.accent,
    borderWidth: 1,
    borderRadius: theme.radius,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  maxButtonText: { color: theme.accent, fontSize: 13, fontWeight: '800' },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: theme.card,
  },
  chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.dim, fontSize: 12.5, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    backgroundColor: theme.cardAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  button: {
    marginTop: 20,
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: '#27406b' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20 },
  stopButton: {
    backgroundColor: theme.bad,
    borderRadius: theme.radius,
    paddingHorizontal: 18,
    paddingVertical: 15,
    alignItems: 'center',
  },
  stopText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  progress: { color: theme.warn, fontSize: 12, marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  card: {
    marginTop: 18,
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    padding: theme.pad,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', marginBottom: 8 },
  cardButton: {
    marginTop: 12,
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
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
  logActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  shareText: { color: theme.dim, fontSize: 11.5, fontWeight: '700' },
  linkButton: { alignSelf: 'flex-start', marginTop: 10, paddingVertical: 4 },
  linkButtonText: { color: theme.accent, fontSize: 12, fontWeight: '700' },
  mono: { color: theme.dim, fontSize: 11.5, lineHeight: 17 },
});
