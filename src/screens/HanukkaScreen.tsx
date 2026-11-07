import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { HtzClient } from '../core/api';
import { HANUKKA_ITEMS, HanukkaResult, runHanukka } from '../core/hanukka';
import { checkInt, checkPhone, checkQty } from '../core/format';
import { theme } from '../ui/theme';
import { useCreds } from '../ui/credentials';
import { Field } from './SetPhoneScreen';

export default function HanukkaScreen() {
  const creds = useCreds();
  const [itemId, setItemId] = useState(HANUKKA_ITEMS[0].id);
  const [qty, setQty] = useState('4');
  const [phone, setPhone] = useState('0555073599');
  const [variant, setVariant] = useState('');
  const [repeats, setRepeats] = useState('1');
  const [delay, setDelay] = useState('1200');
  const [dryRun, setDryRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [result, setResult] = useState<HanukkaResult | null>(null);
  const cancelRef = useRef(false);

  const phoneCheck = checkPhone(phone);
  const qtyCheck = checkQty(qty, 20);

  async function run() {
    cancelRef.current = false;
    setBusy(true);
    setLines([]);
    setResult(null);
    const total = Math.max(1, checkInt(repeats, 1, 1));
    const gap = checkInt(delay, 1200, 0);
    try {
      const client = new HtzClient(creds.email.trim(), creds.password);
      for (let i = 1; i <= total; i++) {
        if (cancelRef.current) {
          setLines((prev) => [...prev, '— cancelled —']);
          break;
        }
        setProgress(`${i}/${total}`);
        setLines((prev) => [...prev, `— run ${i}/${total} —`]);
        const res = await runHanukka(client, {
          itemId,
          qty: qtyCheck.value,
          phone: phoneCheck.value,
          collected: variant.trim() || undefined,
          dryRun,
          shouldStop: () => cancelRef.current,
          log: (l) => setLines((prev) => [...prev, l]),
        });
        setResult(res);
        if (res.payload) setLines((prev) => [...prev, '', ...res.payload!.split('&')]);
        if (!res.ok) {
          setLines((prev) => [...prev, `✗ stopped on run ${i}: ${res.error || 'failed'}`]);
          break;
        }
        if (i < total && gap) await new Promise((r) => setTimeout(r, gap));
      }
    } catch (e: any) {
      setLines((prev) => [...prev, '✗ ' + (e?.message ?? String(e))]);
    } finally {
      setProgress('');
      setBusy(false);
    }
  }

  const canRun = !!creds.email.trim() && !!creds.password && phoneCheck.ok && qtyCheck.ok && !busy;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.h1}>חנוכה order loop</Text>
        <Text style={styles.sub}>
          PRO² show tickets (group 156). Pays with a new card — `payOption=new_card` is forced.
        </Text>

        <Field label="Email" value={creds.email} onChange={creds.setEmail} keyboard="email-address" />
        <Field label="Password" value={creds.password} onChange={creds.setPassword} secure />

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

        <Field
          label="Qty (allowance 4)"
          value={qty}
          onChange={setQty}
          keyboard="phone-pad"
          error={qty.length > 0 && !qtyCheck.ok ? qtyCheck.error : undefined}
        />
        <Field
          label="Order phone"
          value={phone}
          onChange={setPhone}
          keyboard="phone-pad"
          error={phone.length > 0 && !phoneCheck.ok ? phoneCheck.error : undefined}
        />
        <Field label="Repeats" value={repeats} onChange={setRepeats} keyboard="phone-pad" />
        <Field label="Delay between repeats (ms)" value={delay} onChange={setDelay} keyboard="phone-pad" />
        <Field
          label="Variant (blank = first class)"
          value={variant}
          onChange={setVariant}
        />
        <Text style={styles.hint}>252787 = rows 31-39 (₪58) · 252788 = rows 1-30 (₪99) · 252787:2,252788:2 = split</Text>

        <View style={styles.switchRow}>
          <Text style={styles.label}>Dry run (print the payload, never pay)</Text>
          <Switch
            value={dryRun}
            onValueChange={setDryRun}
            trackColor={{ true: theme.accent, false: theme.border }}
            thumbColor="#fff"
          />
        </View>

        <View style={styles.actionRow}>
          <Pressable
            onPress={run}
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
                Run חנוכה loop ×{Math.max(1, checkInt(repeats, 1, 1))}
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

        {result && (
          <View style={[styles.card, { borderColor: result.ok ? theme.ok : theme.bad }]}>
            <Text style={[styles.cardTitle, { color: result.ok ? theme.ok : theme.bad }]}>
              {result.ok ? (result.relocation ? 'order submitted' : 'dry run ok') : 'failed'}
            </Text>
            {result.relocation && <Text style={styles.mono}>next → {result.relocation}</Text>}
            {result.error && <Text style={[styles.mono, { color: theme.bad }]}>{result.error}</Text>}
          </View>
        )}

        {lines.length > 0 && (
          <View style={styles.card}>
            {lines.map((l, i) => (
              <Text key={i} style={styles.mono} numberOfLines={4}>
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
  mono: { color: theme.dim, fontSize: 11.5, lineHeight: 17 },
});
