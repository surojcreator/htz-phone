/**
 * A small, durable run log.
 *
 * The in-screen log dies with the app; when a batch runs in the background and
 * you come back hours later you want to know what it did. This keeps the last
 * handful of actions with enough detail to act on (order id, total, card link).
 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'htz.history.v1';
const SERVICE = 'htz-phone';
const LIMIT = 40;

export type HistoryKind = 'phone' | 'verify' | 'order' | 'buy';

export type HistoryEvent = {
  id: string;
  at: number;
  kind: HistoryKind;
  account: string;
  ok: boolean;
  summary: string;
  orderId?: number;
  total?: number;
  cardUrl?: string;
  detail?: string;
};

const options: SecureStore.SecureStoreOptions = {
  keychainService: SERVICE,
  requireAuthentication: false,
};

export async function loadHistory(): Promise<HistoryEvent[]> {
  try {
    const raw = await SecureStore.getItemAsync(KEY, options);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.at === 'number') : [];
  } catch {
    return [];
  }
}

export async function pushHistory(event: Omit<HistoryEvent, 'id' | 'at'> & { at?: number }): Promise<HistoryEvent[]> {
  const list = await loadHistory();
  const entry: HistoryEvent = {
    ...event,
    id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    at: event.at ?? Date.now(),
  };
  const next = [entry, ...list].slice(0, LIMIT);
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(next), options);
  } catch {
    /* ignore */
  }
  return next;
}

export async function clearHistory(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY, options);
  } catch {
    /* ignore */
  }
}

/** "14:22 · buy · ₪90 · order 6039366" */
export function historyLine(e: HistoryEvent): string {
  const t = new Date(e.at);
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  const bits = [`${hh}:${mm}`, e.kind, e.summary];
  if (typeof e.total === 'number') bits.splice(2, 0, `₪${e.total}`);
  if (e.orderId) bits.push(`order ${e.orderId}`);
  return `${e.ok ? '✓' : '✗'} ${bits.filter(Boolean).join(' · ')}`;
}
