/**
 * React Native has no Web Crypto. `@noble/*` calls crypto.getRandomValues() for
 * the salt and nonce, which is why the app threw
 * "crypto.getRandomValues is not a function" on device (Node has it, Hermes
 * doesn't). This installs the missing primitive backed by expo-crypto, which
 * uses the platform CSPRNG (SecRandomCopyBytes on iOS, SecureRandom on Android).
 *
 * Import this before anything that touches crypto — index.js does it first.
 */
import * as Crypto from 'expo-crypto';

type GetRandomValues = <T extends ArrayBufferView | null>(array: T) => T;

function viewOf(array: ArrayBufferView): Uint8Array {
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

export function installRandomPolyfill(): void {
  const g: any = globalThis as any;

  try {
    if (!g.crypto) g.crypto = {};

    if (typeof g.crypto.getRandomValues !== 'function') {
      const impl: GetRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
        if (!array) throw new TypeError('getRandomValues: argument is null');
        const bytes = Crypto.getRandomBytes(array.byteLength);
        viewOf(array as ArrayBufferView).set(bytes);
        return array;
      };
      g.crypto.getRandomValues = impl;
    }

    if (typeof g.crypto.randomUUID !== 'function') {
      g.crypto.randomUUID = () => Crypto.randomUUID();
    }
  } catch (e) {
    // never let the polyfill take the app down; encryption surfaces a clear error
    console.warn('crypto polyfill unavailable:', e);
  }
}

installRandomPolyfill();

/** Explicit CSPRNG helper for code that wants to be obvious about it. */
export function randomBytes(length: number): Uint8Array {
  return Crypto.getRandomBytes(length);
}
