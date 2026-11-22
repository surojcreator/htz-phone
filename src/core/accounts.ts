/**
 * Multi-account storage.
 *
 * Every account is a label + email + password, kept in the platform secure
 * store (Keychain / Keystore). One is "active" and the whole app reads from it,
 * so the order screens no longer ask for credentials at all.
 *
 * The old single-credential record (htz.credentials.v1) is migrated on first
 * load, so upgrading keeps the account you were using.
 */
import * as SecureStore from 'expo-secure-store';

const ACCOUNTS_KEY = 'htz.accounts.v2';
const ACTIVE_KEY = 'htz.accounts.active.v2';
const LEGACY_KEY = 'htz.credentials.v1';
const SERVICE = 'htz-phone';

export type Account = {
  id: string;
  label: string;
  email: string;
  password: string;
  /** last phone we successfully wrote for this account */
  phone?: string;
  lastUsedAt?: number;
  addedAt: number;
};

export type AccountStore = {
  accounts: Account[];
  activeId: string | null;
};

const options: SecureStore.SecureStoreOptions = {
  keychainService: SERVICE,
  requireAuthentication: false,
};

const newId = (): string => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 12; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${Date.now().toString(36)}${s}`;
};

const clean = (raw: any): AccountStore => {
  const list = Array.isArray(raw?.accounts) ? raw.accounts : [];
  const accounts: Account[] = list
    .filter((a: any) => a && typeof a.email === 'string' && typeof a.password === 'string')
    .map((a: any) => ({
      id: String(a.id || newId()),
      label: String(a.label || a.email || 'account'),
      email: String(a.email),
      password: String(a.password),
      phone: a.phone ? String(a.phone) : undefined,
      lastUsedAt: typeof a.lastUsedAt === 'number' ? a.lastUsedAt : undefined,
      addedAt: typeof a.addedAt === 'number' ? a.addedAt : Date.now(),
    }));
  const activeId = accounts.some((a) => a.id === raw?.activeId) ? String(raw.activeId) : accounts[0]?.id ?? null;
  return { accounts, activeId };
};

export async function loadAccountStore(): Promise<AccountStore> {
  try {
    const raw = await SecureStore.getItemAsync(ACCOUNTS_KEY, options);
    if (raw) return clean(JSON.parse(raw));
  } catch {
    /* fall through to migration */
  }

  // one-time migration from the single-account layout
  try {
    const legacy = await SecureStore.getItemAsync(LEGACY_KEY, options);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (typeof parsed?.email === 'string' && typeof parsed?.password === 'string' && parsed.email.trim()) {
        const account: Account = {
          id: newId(),
          label: parsed.email,
          email: parsed.email,
          password: parsed.password,
          addedAt: Date.now(),
        };
        const store = { accounts: [account], activeId: account.id };
        await saveAccountStore(store);
        return store;
      }
    }
  } catch {
    /* ignore */
  }
  return { accounts: [], activeId: null };
}

export async function saveAccountStore(store: AccountStore): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(ACCOUNTS_KEY, JSON.stringify(store), options);
    if (store.activeId) await SecureStore.setItemAsync(ACTIVE_KEY, store.activeId, options);
    return true;
  } catch {
    return false;
  }
}

export function makeAccount(email: string, password: string, label?: string): Account {
  return {
    id: newId(),
    label: (label || email).trim() || email,
    email: email.trim(),
    password,
    addedAt: Date.now(),
    lastUsedAt: Date.now(),
  };
}
