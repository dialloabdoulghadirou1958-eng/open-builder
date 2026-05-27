/**
 * WebCrypto helpers for the local credential vault.
 *
 * All keys are AES-GCM 256 bits. Passphrase-derived keys go through PBKDF2
 * (SHA-256, high iteration count). Per-record IVs are random 12 bytes; salt is
 * random 16 bytes and stored alongside the ciphertext.
 *
 * Keys themselves are always created with `extractable: false`. They never
 * leave SubtleCrypto and can be stored in IndexedDB directly thanks to the
 * structured-clone support browsers give CryptoKey.
 */

const PBKDF2_ITERATIONS = 200_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface EncryptedRecord {
  iv: string;
  ciphertext: string;
}

export function isWebCryptoAvailable(): boolean {
  return (
    typeof crypto !== "undefined" &&
    typeof crypto.subtle !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  );
}

export function generateRandomBytes(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function generateDeviceKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Re-pack a Uint8Array as a fresh ArrayBuffer-backed view so newer
 *  TypeScript libdom typings accept it as a BufferSource. */
function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

export async function deriveKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    asBufferSource(enc.encode(passphrase)),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: asBufferSource(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptString(
  key: CryptoKey,
  plaintext: string,
): Promise<EncryptedRecord> {
  const iv = generateRandomBytes(IV_BYTES);
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBufferSource(iv) },
    key,
    asBufferSource(enc.encode(plaintext)),
  );
  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptString(
  key: CryptoKey,
  record: EncryptedRecord,
): Promise<string> {
  const iv = base64ToBytes(record.iv);
  const ciphertext = base64ToBytes(record.ciphertext);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBufferSource(iv) },
    key,
    asBufferSource(ciphertext),
  );
  return new TextDecoder().decode(plain);
}

export function generateSalt(): Uint8Array {
  return generateRandomBytes(SALT_BYTES);
}
