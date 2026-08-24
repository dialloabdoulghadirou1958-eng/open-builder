import localforage from "localforage";
import {
  bytesToBase64,
  base64ToBytes,
  decryptString,
  deriveKeyFromPassphrase,
  encryptString,
  generateSalt,
  isWebCryptoAvailable,
  type EncryptedRecord,
} from "./crypto";
import { deleteDeviceKey, loadOrCreateDeviceKey } from "./device-key";

/**
 * Local credential vault.
 *
 * Stores encrypted name -> value pairs in a dedicated localforage instance.
 * The vault has two modes:
 *
 *   - "device":     auto-unlocks at startup using a non-extractable device key
 *                   kept in IndexedDB. No user friction; security comparable
 *                   to localStorage against an XSS adversary, but ciphertext
 *                   is opaque to extensions/clipboards/devtools dumps.
 *   - "passphrase": user must enter a passphrase to derive the key (PBKDF2).
 *                   The key lives only in memory once unlocked.
 *
 * The vault is intentionally simple: a single mode field + a salt (for
 * passphrase mode) + a verifier record used to check that an unlock attempt
 * actually produced the right key.
 */

const vaultStorage = localforage.createInstance({
  name: "open-builder-vault",
});

const META_KEY = "__meta__";
const VERIFIER_KEY = "__verifier__";
const VERIFIER_PLAINTEXT = "open-builder-vault-v1";
const PENDING_MIGRATION_KEY = "__pending_secret_migration__";

interface VaultMeta {
  mode: "device" | "passphrase";
  salt?: string;
}

export interface PendingSecretMigration {
  apiKey?: string | null;
}

export function sanitizePendingSecretMigration(
  value: unknown,
): PendingSecretMigration | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, "apiKey")) return null;
  if (typeof record.apiKey !== "string" && record.apiKey !== null) return null;
  return { apiKey: record.apiKey };
}

export async function removeLegacyAuthFromPendingMigration(): Promise<void> {
  const record = await vaultStorage.getItem<unknown>(PENDING_MIGRATION_KEY);
  if (!record) return;
  const sanitized = sanitizePendingSecretMigration(record);
  if (sanitized) {
    await vaultStorage.setItem(PENDING_MIGRATION_KEY, sanitized);
  } else {
    await vaultStorage.removeItem(PENDING_MIGRATION_KEY);
  }
}

let currentKey: CryptoKey | null = null;
let currentMode: VaultMeta["mode"] = "device";
let bootPromise: Promise<VaultBootResult> | null = null;

export interface VaultBootResult {
  /** True when the vault has previously been initialised (any record exists). */
  initialised: boolean;
  /** Current persisted mode. */
  mode: VaultMeta["mode"];
  /** True if unlock succeeded (always true in device mode; depends on key in passphrase mode). */
  unlocked: boolean;
}

async function readMeta(): Promise<VaultMeta | null> {
  return (await vaultStorage.getItem<VaultMeta>(META_KEY)) ?? null;
}

async function writeMeta(meta: VaultMeta): Promise<void> {
  await vaultStorage.setItem(META_KEY, meta);
}

async function writeVerifier(key: CryptoKey): Promise<void> {
  const record = await encryptString(key, VERIFIER_PLAINTEXT);
  await vaultStorage.setItem(VERIFIER_KEY, record);
}

async function verifyKey(key: CryptoKey): Promise<boolean> {
  const record = await vaultStorage.getItem<EncryptedRecord>(VERIFIER_KEY);
  if (!record) return false;
  try {
    const plain = await decryptString(key, record);
    return plain === VERIFIER_PLAINTEXT;
  } catch {
    return false;
  }
}

/**
 * Boot the vault on app startup.
 *
 * - If no meta record exists, initialise in device mode and write the verifier.
 * - If meta says device mode, load the device key and unlock automatically.
 * - If meta says passphrase mode, leave the vault locked until `unlockWithPassphrase`.
 */
export async function bootVault(): Promise<VaultBootResult> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    if (!isWebCryptoAvailable()) {
      return { initialised: false, mode: "device", unlocked: false };
    }
    const meta = await readMeta();
    if (!meta) {
      const key = await loadOrCreateDeviceKey();
      currentKey = key;
      currentMode = "device";
      await writeMeta({ mode: "device" });
      await writeVerifier(key);
      return { initialised: false, mode: "device", unlocked: true };
    }
    currentMode = meta.mode;
    if (meta.mode === "device") {
      const key = await loadOrCreateDeviceKey();
      if (await verifyKey(key)) {
        currentKey = key;
        return { initialised: true, mode: "device", unlocked: true };
      }
      // Verifier mismatch — device key is no longer the one that wrote the
      // vault. Reset to a fresh state so the app can keep functioning.
      currentKey = key;
      await writeVerifier(key);
      return { initialised: true, mode: "device", unlocked: true };
    }
    return { initialised: true, mode: "passphrase", unlocked: false };
  })();
  return bootPromise;
}

export function isUnlocked(): boolean {
  return currentKey !== null;
}

export function getMode(): VaultMeta["mode"] {
  return currentMode;
}

export function lock(): void {
  if (currentMode === "passphrase") {
    currentKey = null;
  }
}

export async function unlockWithPassphrase(passphrase: string): Promise<boolean> {
  const meta = await readMeta();
  if (!meta || meta.mode !== "passphrase" || !meta.salt) return false;
  const salt = base64ToBytes(meta.salt);
  const key = await deriveKeyFromPassphrase(passphrase, salt);
  if (!(await verifyKey(key))) return false;
  currentKey = key;
  return true;
}

/**
 * Convert the vault from device-key mode to passphrase mode. Re-encrypts
 * every stored record under the new passphrase-derived key. Must be called
 * while the vault is currently unlocked (otherwise records are unreadable).
 */
export async function upgradeToPassphrase(passphrase: string): Promise<void> {
  if (!currentKey) throw new Error("vault: must be unlocked to upgrade");
  const oldKey = currentKey;
  const salt = generateSalt();
  const newKey = await deriveKeyFromPassphrase(passphrase, salt);
  await reencryptAll(oldKey, newKey);
  currentKey = newKey;
  currentMode = "passphrase";
  await writeMeta({ mode: "passphrase", salt: bytesToBase64(salt) });
  await writeVerifier(newKey);
  // Device key is no longer needed; remove it so secrets only exist under the
  // passphrase-derived key.
  await deleteDeviceKey();
}

/**
 * Downgrade from passphrase mode back to device-key mode. Requires the vault
 * to be unlocked. After this, no passphrase will be required.
 */
export async function downgradeToDevice(): Promise<void> {
  if (!currentKey) throw new Error("vault: must be unlocked to downgrade");
  const oldKey = currentKey;
  const newKey = await loadOrCreateDeviceKey();
  await reencryptAll(oldKey, newKey);
  currentKey = newKey;
  currentMode = "device";
  await writeMeta({ mode: "device" });
  await writeVerifier(newKey);
}

async function reencryptAll(oldKey: CryptoKey, newKey: CryptoKey): Promise<void> {
  const keys = await vaultStorage.keys();
  await Promise.all(
    keys
      .filter((k) => k !== META_KEY && k !== VERIFIER_KEY)
      .map(async (k) => {
        const record = await vaultStorage.getItem<EncryptedRecord>(k);
        if (!record) return;
        try {
          const plain = await decryptString(oldKey, record);
          const next = await encryptString(newKey, plain);
          await vaultStorage.setItem(k, next);
        } catch {
          // skip records that can't be decrypted with the current key
        }
      }),
  );
}

export async function getSecret(name: string): Promise<string | null> {
  if (!currentKey) return null;
  const record = await vaultStorage.getItem<EncryptedRecord>(name);
  if (!record) return null;
  try {
    return await decryptString(currentKey, record);
  } catch {
    return null;
  }
}

export async function setSecret(name: string, value: string): Promise<void> {
  if (!currentKey) throw new Error("vault: locked");
  if (!value) {
    await vaultStorage.removeItem(name);
    return;
  }
  const record = await encryptString(currentKey, value);
  await vaultStorage.setItem(name, record);
}

export async function deleteSecret(name: string): Promise<void> {
  await vaultStorage.removeItem(name);
}

export async function takePendingMigration(): Promise<PendingSecretMigration | null> {
  const raw = await vaultStorage.getItem<unknown>(PENDING_MIGRATION_KEY);
  const record = sanitizePendingSecretMigration(raw);
  if (raw) {
    await vaultStorage.removeItem(PENDING_MIGRATION_KEY);
  }
  return record;
}

/** Reset vault: erase every stored secret and the device key. Intended for the
 *  Settings -> reset flow. */
export async function resetVault(): Promise<void> {
  await vaultStorage.clear();
  await deleteDeviceKey();
  currentKey = null;
  currentMode = "device";
  bootPromise = null;
}
