import localforage from "localforage";
import { generateDeviceKey } from "./crypto";

/**
 * Device key storage. The CryptoKey is non-extractable but IndexedDB can
 * structured-clone it, so we hand it to localforage directly. It never leaves
 * SubtleCrypto in raw form.
 */
const deviceKeyStore = localforage.createInstance({
  name: "open-builder-vault-key",
});

const DEVICE_KEY_RECORD = "device-key";

export async function loadOrCreateDeviceKey(): Promise<CryptoKey> {
  const existing = await deviceKeyStore.getItem<CryptoKey>(DEVICE_KEY_RECORD);
  if (existing) return existing;
  const fresh = await generateDeviceKey();
  await deviceKeyStore.setItem(DEVICE_KEY_RECORD, fresh);
  return fresh;
}

export async function deleteDeviceKey(): Promise<void> {
  await deviceKeyStore.removeItem(DEVICE_KEY_RECORD);
}
