import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { HtzClient, STALE_CANDIDATES } from '../core/api';
import { theme } from '../ui/theme';

type Row = { label: string; value: string; ok: boolean };

export default function SetPhoneScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('0555071161');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [done, setDone] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    setRows([]);
    setDone(false);
    try {
      const client = new HtzClient(email.trim(), password);

      const before = await client.appLogin();
      const beforePhone = String(before.phone ?? '');

      await client.appSetPhone(phone.trim());

      const after = await client.appLogin();
      const afterPhone = String(after.phone ?? '');
      const norm = (s: string) => s.replace(/\D/g, '');

      const out: Row[] = [
        { label: 'phone before', value: beforePhone, ok: true },
        { label: 'phone after', value: afterPhone, ok: norm(afterPhone) === norm(phone) },
      ];

      // nothing else may move
      const changed = Object.keys({ ...before, ...after }).filter(
        (k) =>
          !['phone', 'last_update', 'date_created', 'home_arr', 'params'].includes(k) &&
          JSON.stringify((before as any)[k]) !== JSON.stringify((after as any)[k]),
      );
      out.push({
        label: 'other fields',
        value: changed.length ? changed.join(', ') : 'unchanged',
        ok: changed.length === 0,
      });

      for (const stale of STALE_CANDIDATES) {
        const blob = JSON.stringify(after);
        out.push({
          label: `stale ${stale}`,
          value: blob.includes(stale) ? 'present' : 'absent',
          ok: !blob.includes(stale),
        });
      }

      setRows(out);
      setDone(out.every((r) => r.ok));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.h1}>Set account phone</Text>
        <Text style={styles.sub}>
          Writes via the app API (<Text style={styles.code}>cms.htzone.co.il</Text>) — a partial
          update, so only the phone changes.
        </Text>

        <Field label="Email" value={email} onChange={setEmail} keyboard="email-address" autoCap="none" />
        <Field label="Password" value={password} onChange={setPassword} secure autoCap="none" />
        <Field label="New phone" value={phone} onChange={setPhone} keyboard="phone-pad" />

        <Pressable
          onPress={run}
          disabled={busy || !email || !password || !phone}
          style={({ pressed }) => [
            styles.button,
            (busy || !email || !password || !phone) && styles.buttonDisabled,
            pressed && { opacity: 0.85 },
          ]}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Set phone</Text>}
        </Pressable>

        {error && (
          <View style={[styles.card, { borderColor: theme.bad }]}>
            <Text style={[styles.cardTitle, { color: theme.bad }]}>Failed</Text>
            <Text style={styles.mono}>{error}</Text>
          </View>
        )}

        {rows.length > 0 && (
          <View style={styles.card}>
            <Text style={[styles.cardTitle, { color: done ? theme.ok : theme.bad }]}>
              {done ? 'Phone confirmed' : 'Check failed'}
            </Text>
            {rows.map((r) => (
              <View key={r.label} style={styles.row}>
                <Text style={styles.rowLabel}>{r.label}</Text>
                <Text style={[styles.rowValue, { color: r.ok ? theme.ok : theme.bad }]}>
                  {r.value}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secure?: boolean;
  keyboard?: 'default' | 'email-address' | 'phone-pad';
  autoCap?: 'none' | 'sentences';
}) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChange}
        secureTextEntry={props.secure}
        keyboardType={props.keyboard ?? 'default'}
        autoCapitalize={props.autoCap ?? 'none'}
        autoCorrect={false}
        placeholderTextColor={theme.dim}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: theme.pad, paddingBottom: 48 },
  h1: { color: theme.text, fontSize: 24, fontWeight: '700', marginTop: 8 },
  sub: { color: theme.dim, fontSize: 13, marginTop: 6, lineHeight: 19 },
  code: { color: theme.accent },
  label: { color: theme.dim, fontSize: 12, marginBottom: 6, letterSpacing: 0.3 },
  input: {
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    color: theme.text,
    fontSize: 16,
  },
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
  cardTitle: { fontSize: 15, fontWeight: '700', marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: 12 },
  rowLabel: { color: theme.dim, fontSize: 13, flexShrink: 1 },
  rowValue: { fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  mono: { color: theme.dim, fontSize: 12, lineHeight: 18 },
});
