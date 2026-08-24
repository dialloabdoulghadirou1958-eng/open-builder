import { create } from "zustand";
import {
  bootVault,
  deleteSecret,
  downgradeToDevice,
  getMode,
  getSecret,
  isUnlocked,
  lock as vaultLock,
  resetVault,
  setSecret as vaultSetSecret,
  takePendingMigration,
  unlockWithPassphrase as vaultUnlockWithPassphrase,
  upgradeToPassphrase,
  removeLegacyAuthFromPendingMigration,
  type PendingSecretMigration,
} from "../lib/secrets/vault";
import { useSettingsStore } from "./settings";
import { takeStashedApiKey } from "./settings/migrations";

const LEGACY_AUTH_KEY = "open-builder-auth";
const LEGACY_SSO_SESSION_KEYS = ["sso_code_verifier", "sso_state"];
const LEGACY_AUTH_VAULT_KEYS = [
  "auth.accessToken",
  "auth.refreshToken",
  "auth.tokenExpiresAt",
];

export async function purgeLegacyAuthArtifacts(): Promise<void> {
  try {
    localStorage.removeItem(LEGACY_AUTH_KEY);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
  try {
    for (const key of LEGACY_SSO_SESSION_KEYS) sessionStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
  await Promise.all(LEGACY_AUTH_VAULT_KEYS.map((key) => deleteSecret(key)));
  await removeLegacyAuthFromPendingMigration();
}

export const VAULT_KEY_API_KEY = "ai.apiKey";

let runtimePendingSecrets: PendingSecretMigration | null = null;

interface SecretsState {
  mode: "device" | "passphrase";
  unlocked: boolean;
  booted: boolean;
  /** True when a passphrase prompt is needed because the vault hasn't unlocked. */
  needsUnlock: boolean;

  boot: () => Promise<void>;
  unlockWithPassphrase: (passphrase: string) => Promise<boolean>;
  lock: () => void;
  setApiKey: (value: string) => Promise<void>;
  upgradeToPassphrase: (passphrase: string) => Promise<void>;
  downgradeToDevice: () => Promise<void>;
  reset: () => Promise<void>;
}

async function flushPendingSecretsToVault(
  pending: PendingSecretMigration,
): Promise<void> {
  if ("apiKey" in pending) {
    if (pending.apiKey) {
      await vaultSetSecret(VAULT_KEY_API_KEY, pending.apiKey);
    } else {
      await deleteSecret(VAULT_KEY_API_KEY);
    }
  }
}

function stageRuntimePendingSecrets(data: PendingSecretMigration): void {
  runtimePendingSecrets = { ...(runtimePendingSecrets ?? {}), ...data };
}

async function flushRuntimePendingSecrets(): Promise<void> {
  if (!runtimePendingSecrets) return;
  const pending = runtimePendingSecrets;
  runtimePendingSecrets = null;
  await flushPendingSecretsToVault(pending);
}

async function flushMigratedApiKeySecrets(): Promise<void> {
  const stashedKey = takeStashedApiKey();
  if (stashedKey) {
    await vaultSetSecret(VAULT_KEY_API_KEY, stashedKey);
  }
  const pending = await takePendingMigration();
  if (pending) {
    await flushPendingSecretsToVault(pending);
  }
}

export const useSecretsStore = create<SecretsState>((set) => ({
  mode: "device",
  unlocked: false,
  booted: false,
  needsUnlock: false,

  boot: async () => {
    const result = await bootVault();
    await purgeLegacyAuthArtifacts();
    set({
      mode: result.mode,
      unlocked: result.unlocked,
      booted: true,
      needsUnlock: result.initialised && !result.unlocked,
    });

    // First-run secret migration. Settings v8->v9 stashed apiKey; move it into
    // the unlocked vault, then hydrate runtime state.
    if (result.unlocked) {
      await flushMigratedApiKeySecrets();
      await flushRuntimePendingSecrets();

      await hydrateSettingsFromVault();
    }
  },

  unlockWithPassphrase: async (passphrase) => {
    const ok = await vaultUnlockWithPassphrase(passphrase);
    if (ok) {
      set({ unlocked: true, needsUnlock: false });
      await flushMigratedApiKeySecrets();
      await flushRuntimePendingSecrets();
      await hydrateSettingsFromVault();
    }
    return ok;
  },

  lock: () => {
    vaultLock();
    set({ unlocked: isUnlocked(), needsUnlock: !isUnlocked() });
  },

  setApiKey: async (value) => {
    if (!isUnlocked()) {
      stageRuntimePendingSecrets({ apiKey: value || null });
      set({ needsUnlock: true, unlocked: false });
      return;
    }
    if (value) {
      await vaultSetSecret(VAULT_KEY_API_KEY, value);
    } else {
      await deleteSecret(VAULT_KEY_API_KEY);
    }
  },

  upgradeToPassphrase: async (passphrase) => {
    await upgradeToPassphrase(passphrase);
    set({ mode: getMode(), unlocked: isUnlocked() });
  },

  downgradeToDevice: async () => {
    await downgradeToDevice();
    set({ mode: getMode(), unlocked: isUnlocked() });
  },

  reset: async () => {
    await resetVault();
    runtimePendingSecrets = null;
    set({
      mode: "device",
      unlocked: false,
      booted: false,
      needsUnlock: false,
    });
  },
}));

async function hydrateSettingsFromVault(): Promise<void> {
  const apiKey = (await getSecret(VAULT_KEY_API_KEY)) ?? "";
  useSettingsStore.setState((s) => ({ ai: { ...s.ai, apiKey } }));
}
