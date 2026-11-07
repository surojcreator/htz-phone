/**
 * Credential persistence.
 *
 * Passwords go to the platform secure store, never to AsyncStorage:
 *   iOS     → Keychain (kSecClassGenericPassword)
 *   Android → Keystore-encrypted SharedPreferences (expo-secure-store)
 *
 * If the store is unavailable (e.g. web preview), everything degrades to
 * "no persistence" instead of throwing.
 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'htz.credentials.v1';
const SERVICE = 'htz-phone';

export type Creds = { email: string; password: string };

const options: SecureStore.SecureStoreOptions = {
  keychainService: SERVICE,
  requireAuthentication: false,
};

export async function saveCredentials(creds: Creds): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(creds), options);
    return true;
  } catch {
    return false;
  }
}

export async function loadCredentials(): Promise<Creds | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY, options);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Creds;
    if (typeof parsed?.email === 'string' && typeof parsed?.password === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function clearCredentials(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY, options);
  } catch {
    /* ignore */
  }
}

/** Shown in the UI so it's obvious where the data lives. */
export const STORAGE_LABEL = 'Keychain / Android Keystore';
