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
  mergePendingSecretMigration,
  type PendingSecretMigration,
} from "../lib/secrets/vault";
import { useSettingsStore } from "./settings";
import { useAuthStore } from "./auth";
import { takeStashedApiKey } from "./settings/migrations";

const LEGACY_AUTH_KEY = "open-builder-auth";

interface LegacyAuthPayload {
  state?: {
    accessToken?: string | null;
    refreshToken?: string | null;
    tokenExpiresAt?: number | null;
    user?: unknown;
  };
  version?: number;
}

function drainLegacyAuthTokens(): {
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
} | null {
  try {
    const raw = localStorage.getItem(LEGACY_AUTH_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw) as LegacyAuthPayload;
    const s = payload.state;
    if (!s) return null;
    const out: {
      accessToken?: string;
      refreshToken?: string;
      tokenExpiresAt?: number;
    } = {};
    if (s.accessToken) out.accessToken = s.accessToken;
    if (s.refreshToken) out.refreshToken = s.refreshToken;
    if (s.tokenExpiresAt) out.tokenExpiresAt = s.tokenExpiresAt;
    if (!out.accessToken && !out.refreshToken) return null;
    // Rewrite localStorage without the sensitive fields. The auth store's
    // partialize will also enforce this going forward.
    const cleaned: LegacyAuthPayload = {
      ...payload,
      state: { user: s.user },
    };
    localStorage.setItem(LEGACY_AUTH_KEY, JSON.stringify(cleaned));
    return out;
  } catch {
    return null;
  }
}

export const VAULT_KEY_API_KEY = "ai.apiKey";
export const VAULT_KEY_ACCESS_TOKEN = "auth.accessToken";
export const VAULT_KEY_REFRESH_TOKEN = "auth.refreshToken";
export const VAULT_KEY_TOKEN_EXPIRES_AT = "auth.tokenExpiresAt";

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
  setAuthTokens: (tokens: {
    accessToken: string | null;
    refreshToken: string | null;
    tokenExpiresAt: number | null;
  }) => Promise<void>;
  upgradeToPassphrase: (passphrase: string) => Promise<void>;
  downgradeToDevice: () => Promise<void>;
  reset: () => Promise<void>;
}

async function flushTokensToVault(t: {
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiresAt?: number | null;
}): Promise<void> {
  if ("accessToken" in t) {
    if (t.accessToken) {
      await vaultSetSecret(VAULT_KEY_ACCESS_TOKEN, t.accessToken);
    } else {
      await deleteSecret(VAULT_KEY_ACCESS_TOKEN);
    }
  }
  if ("refreshToken" in t) {
    if (t.refreshToken) {
      await vaultSetSecret(VAULT_KEY_REFRESH_TOKEN, t.refreshToken);
    } else {
      await deleteSecret(VAULT_KEY_REFRESH_TOKEN);
    }
  }
  if ("tokenExpiresAt" in t) {
    if (t.tokenExpiresAt) {
      await vaultSetSecret(VAULT_KEY_TOKEN_EXPIRES_AT, String(t.tokenExpiresAt));
    } else {
      await deleteSecret(VAULT_KEY_TOKEN_EXPIRES_AT);
    }
  }
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
  await flushTokensToVault(pending);
}

function stageRuntimePendingSecrets(data: PendingSecretMigration): void {
  runtimePendingSecrets = mergePendingSecretMigration(runtimePendingSecrets, data);
}

async function flushRuntimePendingSecrets(): Promise<void> {
  if (!runtimePendingSecrets) return;
  const pending = runtimePendingSecrets;
  runtimePendingSecrets = null;
  await flushPendingSecretsToVault(pending);
}

export const useSecretsStore = create<SecretsState>((set) => ({
  mode: "device",
  unlocked: false,
  booted: false,
  needsUnlock: false,

  boot: async () => {
    const result = await bootVault();
    set({
      mode: result.mode,
      unlocked: result.unlocked,
      booted: true,
      needsUnlock: result.initialised && !result.unlocked,
    });

    // First-run secret migration. Settings v8->v9 stashed apiKey; the legacy
    // auth-store payload may still contain tokens in localStorage. Move both
    // into the unlocked vault, then hydrate runtime state.
    if (result.unlocked) {
      const stashedKey = takeStashedApiKey();
      if (stashedKey) {
        await vaultSetSecret(VAULT_KEY_API_KEY, stashedKey);
      }
      const legacy = drainLegacyAuthTokens();
      if (legacy) await flushTokensToVault(legacy);
      // Drain any pending migration record left by an aborted previous run.
      const pending = await takePendingMigration();
      if (pending) {
        await flushPendingSecretsToVault(pending);
      }
      await flushRuntimePendingSecrets();

      await Promise.all([hydrateSettingsFromVault(), hydrateAuthFromVault()]);
    }
  },

  unlockWithPassphrase: async (passphrase) => {
    const ok = await vaultUnlockWithPassphrase(passphrase);
    if (ok) {
      set({ unlocked: true, needsUnlock: false });
      await flushRuntimePendingSecrets();
      await Promise.all([hydrateSettingsFromVault(), hydrateAuthFromVault()]);
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

  setAuthTokens: async ({ accessToken, refreshToken, tokenExpiresAt }) => {
    if (!isUnlocked()) {
      stageRuntimePendingSecrets({
        accessToken,
        refreshToken,
        tokenExpiresAt,
      });
      set({ needsUnlock: true, unlocked: false });
      return;
    }
    const writeOrDelete = (key: string, value: string | null) =>
      value ? vaultSetSecret(key, value) : deleteSecret(key);
    await Promise.all([
      writeOrDelete(VAULT_KEY_ACCESS_TOKEN, accessToken),
      writeOrDelete(VAULT_KEY_REFRESH_TOKEN, refreshToken),
      writeOrDelete(
        VAULT_KEY_TOKEN_EXPIRES_AT,
        tokenExpiresAt ? String(tokenExpiresAt) : null,
      ),
    ]);
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

async function hydrateAuthFromVault(): Promise<void> {
  const [accessToken, refreshToken, expiresRaw] = await Promise.all([
    getSecret(VAULT_KEY_ACCESS_TOKEN),
    getSecret(VAULT_KEY_REFRESH_TOKEN),
    getSecret(VAULT_KEY_TOKEN_EXPIRES_AT),
  ]);
  const parsedExpiresAt = expiresRaw ? Number(expiresRaw) : NaN;
  const tokenExpiresAt = Number.isFinite(parsedExpiresAt)
    ? parsedExpiresAt
    : null;
  const authState = useAuthStore.getState();
  if (
    authState.accessToken !== accessToken ||
    authState.refreshToken !== refreshToken ||
    authState.tokenExpiresAt !== tokenExpiresAt
  ) {
    useAuthStore.setState({
      accessToken: accessToken ?? null,
      refreshToken: refreshToken ?? null,
      tokenExpiresAt,
    });
  }
}
