import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Check, HtzClient } from '../core/api';
import { friendlyError } from '../core/errors';
import { checkPhone } from '../core/format';
import { historyLine, HistoryEvent, loadHistory, pushHistory } from '../core/history';
import { theme } from '../ui/theme';
import { useAccounts } from '../ui/accounts';
import { useDefaults } from '../ui/defaults';
import { Field } from '../ui/Field';

type Row = { label: string; value: string; ok: boolean; info?: boolean };

export default function HomeScreen() {
  const { active, notePhone, touch } = useAccounts();
  const { defaults } = useDefaults();

  const [phone, setPhone] = useState('');
  const [expected, setExpected] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (seeded) return;
    setPhone(defaults.phone);
    setExpected(defaults.phone);
    setSeeded(true);
  }, [defaults.phone, seeded]);

  useEffect(() => {
    loadHistory().then(setHistory);
  }, []);

  const phoneCheck = checkPhone(phone);
  const expectCheck = checkPhone(expected);

  const runApply = async () => {
    if (!active || !phoneCheck.ok) return;
    setBusy('apply');
    setRows([]);
    setChecks(null);
    setError(null);
    try {
      const client = new HtzClient(active.email, active.password);
      const rep = await client.applyPhone(phoneCheck.value, defaults.mode);

      const out: Row[] = [
        {
          label: 'app phone',
          value: rep.appRun ? rep.appPhone || '(none)' : 'skipped (web-only run)',
          ok: rep.appOk,
          info: !rep.appRun,
        },
        {
          label: 'web phone',
          value: rep.webRun ? rep.webTelephone || '(none)' : 'skipped (app-only run)',
          ok: rep.webOk,
          info: !rep.webRun,
        },
        {
          label: 'מייל נוסף',
          value: rep.appRun ? rep.appEmail2 || 'empty' : 'skipped',
          ok: rep.email2Ok,
          info: !rep.appRun,
        },
        { label: 'web write', value: rep.webWritten ? 'applied' : 'already set', ok: true, info: true },
        { label: 'other fields', value: rep.changed.length ? rep.changed.join(', ') : 'unchanged', ok: true, info: true },
      ];
      if (rep.repairs.length) out.push({ label: 'repaired', value: rep.repairs.join(', '), ok: true, info: true });
      if (rep.serverDerived.length) out.push({ label: 'server-derived', value: rep.serverDerived.join(', '), ok: true, info: true });

      setRows(out);
      const ok = rep.appOk && rep.webOk && rep.email2Ok;
      if (ok) await notePhone(phoneCheck.value); else await touch();

      setHistory(
        await pushHistory({
          kind: 'phone',
          account: active.email,
          ok,
          summary: ok ? `set ${phoneCheck.value}` : 'set phone failed',
          detail: ok ? undefined : rep.changed.join(', ') || 'mismatch',
        }),
      );
      if (ok) await runVerify(client);
    } catch (e: any) {
      const msg = friendlyError(e?.message ?? e);
      setError(msg);
      setHistory(
        await pushHistory({ kind: 'phone', account: active.email, ok: false, summary: 'set phone failed', detail: msg }),
      );
    } finally {
      setBusy(null);
    }
  };

  const runVerify = async (clientArg?: HtzClient) => {
    if (!active || !expectCheck.ok) return;
    setBusy('verify');
    setChecks(null);
    setError(null);
    try {
      const client = clientArg ?? new HtzClient(active.email, active.password);
      const report = await client.verify(expectCheck.value);
      setChecks(report.checks);
      const fails = report.checks.filter((c) => !c.info && !c.ok).map((c) => c.name);
      setHistory(
        await pushHistory({
          kind: 'verify',
          account: active.email,
          ok: report.ok,
          summary: report.ok ? `${expectCheck.value} confirmed` : 'mismatch found',
          detail: report.ok ? undefined : fails.slice(0, 3).join(', '),
        }),
      );
    } catch (e: any) {
      const msg = friendlyError(e?.message ?? e);
      setError(msg);
      setHistory(await pushHistory({ kind: 'verify', account: active.email, ok: false, summary: 'verify failed', detail: msg }));
    } finally {
      setBusy(null);
    }
  };

  const confirmApply = () => {
    if (!active) return;
    if (defaults.mode === 'web' || defaults.mode === 'app') {
      Alert.alert('Write only one surface?', `Mode is "${defaults.mode}" — the other surface keeps its old number.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Run', onPress: () => void runApply() },
      ]);
      return;
    }
    void runApply();
  };

  const report = checks?.map((c) => `${c.info ? 'INFO' : c.ok ? 'PASS' : 'FAIL'} ${c.name} ${c.value}`).join('\n') ?? '';

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.h1}>Account</Text>
        {active ? (
          <Text style={styles.sub}>
            {active.label} · {active.email}
            {active.phone ? ` · last set ${active.phone}` : ''}
          </Text>
        ) : (
          <Text style={[styles.sub, { color: theme.warn }]}>No account yet — add one in Settings.</Text>
        )}

        <Field
          label="Phone to write"
          value={phone}
          onChange={setPhone}
          keyboard="phone-pad"
          placeholder="05XXXXXXXX"
          error={phone.length > 0 && !phoneCheck.ok ? phoneCheck.error : undefined}
        />

        <View style={styles.row}>
          <Pressable
            onPress={confirmApply}
            disabled={!active || !phoneCheck.ok || !!busy}
            style={({ pressed }) => [styles.button, { flex: 1 }, (!active || !phoneCheck.ok || !!busy) && styles.buttonDisabled, pressed && { opacity: 0.85 }]}
          >
            {busy === 'apply' ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Set phone</Text>}
          </Pressable>
          <Pressable
            onPress={() => runVerify()}
            disabled={!active || !expectCheck.ok || !!busy}
            style={({ pressed }) => [styles.ghost, (!active || !expectCheck.ok || !!busy) && styles.dim, pressed && { opacity: 0.85 }]}
          >
            {busy === 'verify' ? <ActivityIndicator color={theme.dim} /> : <Text style={styles.ghostText}>Verify</Text>}
          </Pressable>
        </View>
        <Text style={styles.hint}>
          Mode: {defaults.mode} — change it in Settings. Verify reads both surfaces and checks מייל נוסף.
        </Text>

        {rows.length > 0 && (
          <View style={styles.card}>
            {rows.map((r) => (
              <View key={r.label} style={styles.line}>
                <Text style={styles.lineLabel}>{r.label}</Text>
                <Text style={[styles.lineValue, { color: r.info ? theme.dim : r.ok ? theme.ok : theme.bad }]}>{r.value}</Text>
              </View>
            ))}
          </View>
        )}

        {!!error && (
          <View style={[styles.card, { borderColor: theme.bad }]}>
            <Text style={[styles.cardTitle, { color: theme.bad }]}>Failed</Text>
            <Text style={styles.mono}>{error}</Text>
          </View>
        )}

        {checks && (
          <View style={styles.card}>
            <Text style={[styles.cardTitle, { color: checks.every((c) => c.info || c.ok) ? theme.ok : theme.bad }]}>
              {checks.every((c) => c.info || c.ok) ? `Verified — ${expectCheck.value}` : 'Verification failed'}
            </Text>
            {checks.map((c, i) => (
              <View key={`${c.name}-${i}`} style={styles.line}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lineLabel}>{c.name}</Text>
                  {!!c.note && <Text style={styles.hint}>{c.note}</Text>}
                </View>
                <Text style={[styles.badge, { color: c.info ? theme.warn : c.ok ? theme.ok : theme.bad, borderColor: c.info ? theme.warn : c.ok ? theme.ok : theme.bad }]}>
                  {c.info ? 'INFO' : c.ok ? 'PASS' : 'FAIL'}
                </Text>
              </View>
            ))}
            <Pressable onPress={() => Share.share({ message: report }).catch(() => {})} style={styles.shareButton}>
              <Text style={styles.shareText}>Share report</Text>
            </Pressable>
          </View>
        )}

        {history.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>Recent</Text>
              <Pressable onPress={() => loadHistory().then(setHistory)}>
                <Text style={styles.link}>refresh</Text>
              </Pressable>
            </View>
            {history.slice(0, 6).map((e) => (
              <Text key={e.id} style={[styles.mono, { color: e.ok ? theme.dim : theme.bad }]} selectable>
                {historyLine(e)}
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
  hint: { color: theme.dim, fontSize: 11, marginTop: 6 },
  row: { flexDirection: 'row', gap: 10, marginTop: 20, alignItems: 'stretch' },
  button: { backgroundColor: theme.accent, borderRadius: theme.radius, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
  buttonDisabled: { backgroundColor: '#27406b' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ghost: { borderColor: theme.border, borderWidth: 1, borderRadius: theme.radius, paddingHorizontal: 22, justifyContent: 'center', alignItems: 'center' },
  ghostText: { color: theme.dim, fontSize: 14, fontWeight: '700' },
  dim: { opacity: 0.45 },
  card: {
    marginTop: 20,
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    padding: theme.pad,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  cardTitle: { color: theme.text, fontSize: 15, fontWeight: '700', marginBottom: 8 },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: 12 },
  lineLabel: { color: theme.dim, fontSize: 13, flexShrink: 1 },
  lineValue: { fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  badge: { fontSize: 10, fontWeight: '800', borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  mono: { color: theme.dim, fontSize: 12, lineHeight: 18 },
  link: { color: theme.accent, fontSize: 12, fontWeight: '700' },
  shareButton: { alignSelf: 'flex-start', borderColor: theme.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginTop: 10 },
  shareText: { color: theme.dim, fontSize: 11.5, fontWeight: '700' },
});
