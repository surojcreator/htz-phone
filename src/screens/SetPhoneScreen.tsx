import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { HtzClient, STALE_CANDIDATES } from '../core/api';
import { checkPhone } from '../core/format';
import { STORAGE_LABEL } from '../core/storage';
import { useCreds } from '../ui/credentials';
import { theme } from '../ui/theme';

type Row = { label: string; value: string; ok: boolean };

export default function SetPhoneScreen() {
  const creds = useCreds();
  const [phone, setPhone] = useState('0555071161');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [done, setDone] = useState(false);

  const phoneCheck = checkPhone(phone);
  const canRun = !!creds.email.trim() && !!creds.password && phoneCheck.ok && !busy;

  async function run() {
    setBusy(true);
    setError(null);
    setRows([]);
    setDone(false);
    try {
      const client = new HtzClient(creds.email.trim(), creds.password);

      const before = await client.appLogin();
      const beforePhone = String(before.phone ?? '');

      await client.appSetPhone(phoneCheck.value);

      const after = await client.appLogin();
      const afterPhone = String(after.phone ?? '');
      const norm = (s: string) => s.replace(/\D/g, '');

      const out: Row[] = [
        { label: 'phone before', value: beforePhone, ok: true },
        { label: 'phone after', value: afterPhone, ok: norm(afterPhone) === norm(phoneCheck.value) },
      ];

      const changed = Object.keys({ ...before, ...after }).filter(
        (k) =>
          !['phone', 'last_update', 'date_created', 'home_arr', 'params', 'birthday', 'allow_app_rating'].includes(k) &&
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
      const allOk = out.every((r) => r.ok);
      setDone(allOk);
      if (allOk) await creds.persist(creds.email, creds.password);
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

        <Field label="Email" value={creds.email} onChange={creds.setEmail} keyboard="email-address" />
        <Field label="Password" value={creds.password} onChange={creds.setPassword} secure />
        <Field
          label="New phone"
          value={phone}
          onChange={setPhone}
          keyboard="phone-pad"
          error={phone.length > 0 && !phoneCheck.ok ? phoneCheck.error : undefined}
        />

        <RememberRow
          value={creds.remember}
          onChange={creds.setRemember}
          state={creds.rememberState}
          onForget={creds.forget}
        />

        <Pressable
          onPress={run}
          disabled={!canRun}
          style={({ pressed }) => [styles.button, !canRun && styles.buttonDisabled, pressed && { opacity: 0.85 }]}
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
                <Text style={[styles.rowValue, { color: r.ok ? theme.ok : theme.bad }]}>{r.value}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function RememberRow(props: {
  value: boolean;
  onChange: (v: boolean) => void;
  state: 'idle' | 'saved' | 'cleared' | 'unavailable';
  onForget: () => void;
}) {
  const hint =
    props.state === 'saved'
      ? `Saved in ${STORAGE_LABEL}`
      : props.state === 'cleared'
      ? 'Not saved'
      : props.state === 'unavailable'
      ? 'Secure storage unavailable on this build'
      : `Stored in ${STORAGE_LABEL}`;

  return (
    <View style={styles.rememberRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>Remember email &amp; password</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      {props.state === 'saved' && (
        <Pressable onPress={props.onForget} style={styles.forget}>
          <Text style={styles.forgetText}>Forget</Text>
        </Pressable>
      )}
      <Switch
        value={props.value}
        onValueChange={props.onChange}
        trackColor={{ true: theme.accent, false: theme.border }}
        thumbColor="#fff"
      />
    </View>
  );
}

export function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secure?: boolean;
  keyboard?: 'default' | 'email-address' | 'phone-pad';
  autoCap?: 'none' | 'sentences';
  error?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <View style={{ marginTop: 14 }}>
      <Text style={styles.label}>{props.label}</Text>
      <View style={[styles.inputWrap, props.error ? { borderColor: theme.bad } : null]}>
        <TextInput
          value={props.value}
          onChangeText={props.onChange}
          secureTextEntry={props.secure && !visible}
          keyboardType={props.keyboard ?? 'default'}
          autoCapitalize={props.autoCap ?? 'none'}
          autoCorrect={false}
          autoComplete="off"
          textContentType="none"
          placeholderTextColor={theme.dim}
          style={styles.input}
        />
        {props.secure && (
          <Pressable onPress={() => setVisible((v) => !v)} hitSlop={10} style={styles.eye}>
            <Text style={styles.eyeText}>{visible ? 'hide' : 'show'}</Text>
          </Pressable>
        )}
      </View>
      {!!props.error && <Text style={styles.errorText}>{props.error}</Text>}
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
  hint: { color: theme.dim, fontSize: 11, marginTop: 2 },
  errorText: { color: theme.bad, fontSize: 11.5, marginTop: 5 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    paddingRight: 10,
  },
  input: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    color: theme.text,
    fontSize: 16,
  },
  eye: { paddingHorizontal: 6, paddingVertical: 4 },
  eyeText: { color: theme.accent, fontSize: 12, fontWeight: '700' },
  rememberRow: {
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
  forget: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  forgetText: { color: theme.dim, fontSize: 11, fontWeight: '600' },
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
