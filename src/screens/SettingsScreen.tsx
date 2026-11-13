import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { checkPhone, checkQty } from '../core/format';
import { HtzClient } from '../core/api';
import { BUILT_IN, RUN_MODES } from '../core/defaults';
import { theme } from '../ui/theme';
import { useCreds } from '../ui/credentials';
import { useDefaults } from '../ui/defaults';
import { Field } from './SetPhoneScreen';

export default function SettingsScreen() {
  const { defaults, loaded, patch, reset, savedAt } = useDefaults();
  const creds = useCreds();

  const [phone, setPhone] = useState(defaults.phone);
  const [orderPhone, setOrderPhone] = useState(defaults.orderPhone);
  const [itemId, setItemId] = useState(defaults.itemId);
  const [variant, setVariant] = useState(defaults.variant);
  const [qty, setQty] = useState(String(defaults.qty));
  const [repeats, setRepeats] = useState(String(defaults.repeats));
  const [delay, setDelay] = useState(String(defaults.delay));
  const [dryRun, setDryRun] = useState(defaults.dryRun);
  const [background, setBackground] = useState(defaults.background);
  const [mode, setMode] = useState(defaults.mode);
  const [touched, setTouched] = useState(false);
  const [notice, setNotice] = useState('');

  // take the stored values once, then let the user edit freely
  useEffect(() => {
    if (!loaded || touched) return;
    setPhone(defaults.phone);
    setOrderPhone(defaults.orderPhone);
    setItemId(defaults.itemId);
    setVariant(defaults.variant);
    setQty(String(defaults.qty));
    setRepeats(String(defaults.repeats));
    setDelay(String(defaults.delay));
    setDryRun(defaults.dryRun);
    setBackground(defaults.background);
    setMode(defaults.mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const phoneCheck = checkPhone(phone);
  const orderCheck = checkPhone(orderPhone);
  const qtyCheck = checkQty(qty, 20);
  const repeatsNum = parseInt(repeats, 10);
  const delayNum = parseInt(delay, 10);
  const repeatsOk = Number.isFinite(repeatsNum) && repeatsNum >= 1 && repeatsNum <= 50;
  const delayOk = Number.isFinite(delayNum) && delayNum >= 0;
  const itemOk = /^\d{3,}$/.test(itemId.trim());
  const canSave = phoneCheck.ok && orderCheck.ok && qtyCheck.ok && repeatsOk && delayOk && itemOk;

  async function save() {
    if (!canSave) {
      setNotice('fix the highlighted fields first');
      return;
    }
    await patch({
      phone: phoneCheck.value,
      orderPhone: orderCheck.value,
      itemId: itemId.trim(),
      variant: variant.trim(),
      qty: qtyCheck.value,
      repeats: repeatsNum,
      delay: delayNum,
      dryRun,
      background,
      mode,
    });
    setTouched(false);
    setNotice('saved — screens pick it up on next open');
  }

  async function restore() {
    await reset();
    setTouched(false);
    setNotice('restored the built-in defaults');
    setPhone(BUILT_IN.phone);
    setOrderPhone(BUILT_IN.orderPhone);
    setItemId(BUILT_IN.itemId);
    setVariant(BUILT_IN.variant);
    setQty(String(BUILT_IN.qty));
    setRepeats(String(BUILT_IN.repeats));
    setDelay(String(BUILT_IN.delay));
    setDryRun(BUILT_IN.dryRun);
    setBackground(BUILT_IN.background);
    setMode(BUILT_IN.mode);
  }

  const mark = () => setTouched(true);

  async function resetSession() {
    const email = creds.email.trim();
    if (!email) {
      setNotice('enter the account email on the Set phone tab first');
      return;
    }
    new HtzClient(email, creds.password).resetSession();
    setNotice('session cleared — the next run logs in with a fresh session');
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.h1}>Defaults</Text>
      <Text style={styles.sub}>
        Every value the app starts with. Changing one here changes it everywhere — no rebuild.
      </Text>

      <Field
        label="Account phone (Set phone target)"
        value={phone}
        onChange={(v) => { mark(); setPhone(v); }}
        keyboard="phone-pad"
        placeholder={BUILT_IN.phone}
        error={phone.length > 0 && !phoneCheck.ok ? phoneCheck.error : undefined}
      />
      <Field
        label="חנוכה order phone (shippingPhone2)"
        value={orderPhone}
        onChange={(v) => { mark(); setOrderPhone(v); }}
        keyboard="phone-pad"
        placeholder={BUILT_IN.orderPhone}
        error={orderPhone.length > 0 && !orderCheck.ok ? orderCheck.error : undefined}
      />
      <Field
        label="Attraction id"
        value={itemId}
        onChange={(v) => { mark(); setItemId(v); }}
        keyboard="number-pad"
        placeholder={BUILT_IN.itemId}
        error={itemId.length > 0 && !itemOk ? 'digits only' : undefined}
      />
      <Field
        label="Variant (blank = first class)"
        value={variant}
        onChange={(v) => { mark(); setVariant(v); }}
        placeholder="252787 or 252787:2,252788:2"
      />
      <Field
        label="Qty per order"
        value={qty}
        onChange={(v) => { mark(); setQty(v); }}
        keyboard="number-pad"
        placeholder={String(BUILT_IN.qty)}
        error={qty.length > 0 && !qtyCheck.ok ? qtyCheck.error : undefined}
      />
      <Field
        label="Repeats (max 10000)"
        value={repeats}
        onChange={(v) => { mark(); setRepeats(v); }}
        keyboard="number-pad"
        placeholder={String(BUILT_IN.repeats)}
        error={repeats.length > 0 && !repeatsOk ? '1 to 10000' : undefined}
      />
      <Field
        label="Delay between repeats (ms)"
        value={delay}
        onChange={(v) => { mark(); setDelay(v); }}
        keyboard="number-pad"
        placeholder={String(BUILT_IN.delay)}
        error={delay.length > 0 && !delayOk ? '0 or more' : undefined}
      />

      <Text style={[styles.label, { marginTop: 18 }]}>Set phone run mode</Text>
      <View style={styles.modes}>
        {RUN_MODES.map((m) => (
          <Pressable
            key={m.id}
            onPress={() => { mark(); setMode(m.id); }}
            style={[styles.mode, mode === m.id && styles.modeActive]}
          >
            <Text style={[styles.modeText, mode === m.id && styles.modeTextActive]}>{m.label}</Text>
            <Text style={[styles.modeHint, mode === m.id && styles.modeHintActive]}>{m.hint}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.switchRow}>
        <Text style={styles.label}>Dry run by default (never pay)</Text>
        <Switch
          value={dryRun}
          onValueChange={(v) => { mark(); setDryRun(v); }}
          trackColor={{ true: theme.accent, false: theme.border }}
          thumbColor="#fff"
        />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.label}>Keep running in the background</Text>
        <Switch
          value={background}
          onValueChange={(v) => { mark(); setBackground(v); }}
          trackColor={{ true: theme.accent, false: theme.border }}
          thumbColor="#fff"
        />
      </View>

      <View style={styles.actionRow}>
        <Pressable
          onPress={save}
          disabled={!canSave}
          style={({ pressed }) => [styles.button, { flex: 1 }, !canSave && styles.buttonDisabled, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.buttonText}>Save defaults</Text>
        </Pressable>
        <Pressable
          onPress={restore}
          style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.ghostText}>Reset</Text>
        </Pressable>
      </View>

      {!!notice && <Text style={styles.notice}>{notice}</Text>}
      {savedAt > 0 && !notice && <Text style={styles.notice}>last save {new Date(savedAt).toLocaleTimeString()}</Text>}
      <Text style={[styles.notice, { marginTop: 6 }]}>
        stored in the keychain / keystore, next to the credentials
      </Text>

      <View style={styles.divider} />
      <Text style={styles.label}>Session</Text>
      <Text style={[styles.notice, { marginTop: 4 }]}>
        Drops the stored website session and mints a new one on the next request. This is what
        reinstalling the app used to do — use it when login starts failing.
      </Text>
      <Pressable
        onPress={resetSession}
        style={({ pressed }) => [styles.ghost, { marginTop: 10, paddingVertical: 12 }, pressed && { opacity: 0.85 }]}
      >
        <Text style={styles.ghostText}>Reset session</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: theme.pad, paddingBottom: 48 },
  h1: { color: theme.text, fontSize: 24, fontWeight: '700', marginTop: 8 },
  sub: { color: theme.dim, fontSize: 13, marginTop: 6, lineHeight: 19 },
  label: { color: theme.dim, fontSize: 12, letterSpacing: 0.3 },
  modes: { gap: 8, marginTop: 6 },
  mode: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: theme.card,
  },
  modeActive: { borderColor: theme.accent, backgroundColor: theme.cardAlt },
  modeText: { color: theme.text, fontSize: 13.5, fontWeight: '700' },
  modeTextActive: { color: theme.accent },
  modeHint: { color: theme.dim, fontSize: 11.5, marginTop: 2 },
  modeHintActive: { color: theme.dim },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 18,
    backgroundColor: theme.cardAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 22, alignItems: 'stretch' },
  button: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: '#27406b' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ghost: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  ghostText: { color: theme.dim, fontSize: 14, fontWeight: '700' },
  notice: { color: theme.dim, fontSize: 12, marginTop: 12 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginTop: 26, marginBottom: 18 },
});
