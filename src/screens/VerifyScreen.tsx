import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Check, HtzClient } from '../core/api';
import { checkPhone } from '../core/format';
import { theme } from '../ui/theme';
import { useCreds } from '../ui/credentials';
import { Field } from './SetPhoneScreen';

export default function VerifyScreen() {
  const creds = useCreds();
  const [expected, setExpected] = useState('0555071161');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [ok, setOk] = useState(false);

  const phoneCheck = checkPhone(expected);
  const canRun = !!creds.email.trim() && !!creds.password && phoneCheck.ok && !busy;

  async function run() {
    setBusy(true);
    setError(null);
    setChecks(null);
    try {
      const report = await new HtzClient(creds.email.trim(), creds.password).verify(phoneCheck.value);
      setChecks(report.checks);
      setOk(report.ok);
      if (report.ok) await creds.persist(creds.email, creds.password);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const color = (c: Check) => (c.info ? theme.warn : c.ok ? theme.ok : theme.bad);
  const flag = (c: Check) => (c.info ? 'INFO' : c.ok ? 'PASS' : 'FAIL');

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.h1}>Verify phone</Text>
        <Text style={styles.sub}>
          Read-only. Two independent app-API sessions plus the web profile, and a hunt for any
          stale number.
        </Text>

        <Field label="Email" value={creds.email} onChange={creds.setEmail} keyboard="email-address" />
        <Field label="Password" value={creds.password} onChange={creds.setPassword} secure />
        <Field label="Expected phone" value={expected} onChange={setExpected} keyboard="phone-pad"
               error={expected.length > 0 && !phoneCheck.ok ? phoneCheck.error : undefined} />

        <Pressable
          onPress={run}
          disabled={!canRun}
          style={({ pressed }) => [styles.button, !canRun && styles.buttonDisabled, pressed && { opacity: 0.85 }]}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Run sweep</Text>}
        </Pressable>

        {error && (
          <View style={[styles.card, { borderColor: theme.bad }]}>
            <Text style={[styles.cardTitle, { color: theme.bad }]}>Failed</Text>
            <Text style={styles.mono}>{error}</Text>
          </View>
        )}

        {checks && (
          <View style={styles.card}>
            <Text style={[styles.cardTitle, { color: ok ? theme.ok : theme.bad }]}>
              {ok ? 'Phone consistent everywhere' : 'Inconsistencies found'}
            </Text>
            {checks.map((c, i) => (
              <View key={`${c.name}-${i}`} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{c.name}</Text>
                  {!!c.note && <Text style={styles.note}>{c.note}</Text>}
                </View>
                <Text style={[styles.badge, { color: color(c), borderColor: color(c) }]}>{flag(c)}</Text>
                <Text style={[styles.rowValue, { color: color(c) }]} numberOfLines={1}>
                  {c.value}
                </Text>
              </View>
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
  button: {
    marginTop: 22,
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: '#27406b' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  card: {
    marginTop: 20,
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    padding: theme.pad,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
  },
  rowLabel: { color: theme.text, fontSize: 12.5, lineHeight: 17 },
  note: { color: theme.dim, fontSize: 11, marginTop: 2 },
  badge: {
    fontSize: 10,
    fontWeight: '800',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  rowValue: { fontSize: 12, fontWeight: '600', maxWidth: 120, textAlign: 'right' },
  mono: { color: theme.dim, fontSize: 12, lineHeight: 18 },
});
