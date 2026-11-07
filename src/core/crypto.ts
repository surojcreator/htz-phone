/**
 * SecureEncryption, ported to JS.
 *
 * The native app derives its key in libndkMethods.so:
 *   Java_il_co_inmanage_base_data_BaseEncryption_encryptionKey
 *     adr x1, #0x4c0            -> .rodata
 *     ldr x2, [x8, #0x538]      -> JNIEnv->NewStringUTF
 *   .rodata @ 0x4c0: "1inmahtzonenage2"
 *
 * Scheme (il.co.inmanage.base.data.SecureEncryption):
 *   key    = PBKDF2WithHmacSHA256(passphrase, salt, 32767) -> 128 bit
 *   enc    = 12-byte nonce || AES/GCM/NoPadding(plaintext)  (JCE appends the tag)
 *   output = Base64( 16-byte salt || nonce || ciphertext || tag )
 *
 * Pure JS so Android, iOS and Node all produce byte-compatible output.
 */
import { gcm } from '@noble/ciphers/aes';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { randomBytes } from '@noble/hashes/utils';

import { b64decode, b64encode, utf8Decode, utf8Encode } from './base64';

export const PASSPHRASE = '1inmahtzonenage2';

const ITERATIONS = 32767;
const KEY_LEN = 16;
const SALT_LEN = 16;
const NONCE_LEN = 12;
const TAG_LEN = 16;

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  return pbkdf2Async(sha256, utf8Encode(passphrase), salt, {
    c: ITERATIONS,
    dkLen: KEY_LEN,
  });
}

/** Mirrors SecureEncryption.encryptString(str, key). */
export async function encryptString(plaintext: string, passphrase: string = PASSPHRASE): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await deriveKey(passphrase, salt);
  const nonce = randomBytes(NONCE_LEN);
  const ctAndTag = gcm(key, nonce).encrypt(utf8Encode(plaintext));
  return b64encode(concat(salt, nonce, ctAndTag));
}

/** Mirrors SecureEncryption.decryptString(blob, key). */
export async function decryptString(blob: string, passphrase: string = PASSPHRASE): Promise<string> {
  const raw = b64decode(blob);
  if (raw.length < SALT_LEN + NONCE_LEN + TAG_LEN) {
    throw new Error('ciphertext shorter than salt+nonce+tag');
  }
  const salt = raw.slice(0, SALT_LEN);
  const nonce = raw.slice(SALT_LEN, SALT_LEN + NONCE_LEN);
  const ctAndTag = raw.slice(SALT_LEN + NONCE_LEN);
  const key = await deriveKey(passphrase, salt);
  return utf8Decode(gcm(key, nonce).decrypt(ctAndTag));
}

/** Shape guard used by the UI before doing anything expensive. */
export function looksEncrypted(s: string): boolean {
  return /^[A-Za-z0-9+/]{40,}={0,2}$/.test(s.trim());
}
