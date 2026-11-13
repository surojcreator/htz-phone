/**
 * Editable defaults for every value the app ships with.
 *
 * These used to be hard-coded in each screen, which meant changing the account
 * phone or the order phone required a rebuild. They now live in the secure
 * store (same place as the credentials) and every screen reads from here.
 */
import * as SecureStore from 'expo-secure-store';

import type { RunMode } from './api';

const KEY = 'htz.defaults.v1';
const SERVICE = 'htz-phone';

export type Defaults = {
  /** account phone written by "Set phone" */
  phone: string;
  /** shippingPhone2 used by the חנוכה order */
  orderPhone: string;
  itemId: string;
  variant: string;
  qty: number;
  repeats: number;
  delay: number;
  dryRun: boolean;
  background: boolean;
  /** which surfaces a set-phone run touches */
  mode: RunMode;
};

export const BUILT_IN: Defaults = {
  phone: '0555071161',
  orderPhone: '0555073599',
  itemId: '166122',
  variant: '',
  qty: 4,
  repeats: 1,
  delay: 1200,
  dryRun: true,
  background: true,
  mode: 'both-web',
};

export const RUN_MODES: { id: RunMode; label: string; hint: string }[] = [
  { id: 'both-web', label: 'Both · web first', hint: 'Desktop behaviour: site, then app API' },
  { id: 'both-app', label: 'Both · app first', hint: 'App API first, then the site' },
  { id: 'web', label: 'Web only', hint: 'Only the website profile is written' },
  { id: 'app', label: 'App only', hint: 'Only the app API is written' },
];

const MODES = RUN_MODES.map((m) => m.id);

const clampInt = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' ? v : v === undefined || v === null ? fallback : String(v);

/** Anything read from storage (or typed by hand) goes through this. */
export function normalize(raw: any): Defaults {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    phone: str(r.phone, BUILT_IN.phone).trim() || BUILT_IN.phone,
    orderPhone: str(r.orderPhone, BUILT_IN.orderPhone).trim() || BUILT_IN.orderPhone,
    itemId: str(r.itemId, BUILT_IN.itemId).trim() || BUILT_IN.itemId,
    variant: str(r.variant, BUILT_IN.variant),
    qty: clampInt(r.qty, BUILT_IN.qty, 1, 20),
    repeats: clampInt(r.repeats, BUILT_IN.repeats, 1, 50),
    delay: clampInt(r.delay, BUILT_IN.delay, 0, 600000),
    dryRun: typeof r.dryRun === 'boolean' ? r.dryRun : BUILT_IN.dryRun,
    background: typeof r.background === 'boolean' ? r.background : BUILT_IN.background,
    mode: MODES.includes(r.mode) ? (r.mode as RunMode) : BUILT_IN.mode,
  };
}

const options: SecureStore.SecureStoreOptions = {
  keychainService: SERVICE,
  requireAuthentication: false,
};

export async function loadDefaults(): Promise<Defaults> {
  try {
    const raw = await SecureStore.getItemAsync(KEY, options);
    if (!raw) return { ...BUILT_IN };
    return normalize(JSON.parse(raw));
  } catch {
    return { ...BUILT_IN };
  }
}

export async function saveDefaults(d: Defaults): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(normalize(d)), options);
    return true;
  } catch {
    return false;
  }
}

export async function clearDefaults(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY, options);
  } catch {
    /* ignore */
  }
}
