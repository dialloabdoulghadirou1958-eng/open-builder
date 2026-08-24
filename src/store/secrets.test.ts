import { afterEach, describe, expect, it, vi } from "vitest";
import { purgeLegacyAuthArtifacts } from "./secrets";

const mocks = vi.hoisted(() => ({
  deleteSecret: vi.fn(async () => {}),
  removeLegacyAuthFromPendingMigration: vi.fn(async () => {}),
}));

vi.mock("../lib/secrets/vault", () => ({
  bootVault: vi.fn(),
  deleteSecret: mocks.deleteSecret,
  downgradeToDevice: vi.fn(),
  getMode: vi.fn(() => "device"),
  getSecret: vi.fn(),
  isUnlocked: vi.fn(() => false),
  lock: vi.fn(),
  removeLegacyAuthFromPendingMigration:
    mocks.removeLegacyAuthFromPendingMigration,
  resetVault: vi.fn(),
  setSecret: vi.fn(),
  takePendingMigration: vi.fn(),
  unlockWithPassphrase: vi.fn(),
  upgradeToPassphrase: vi.fn(),
}));

vi.mock("./settings", () => ({
  useSettingsStore: { setState: vi.fn() },
}));

vi.mock("./settings/migrations", () => ({
  takeStashedApiKey: vi.fn(),
}));

describe("legacy authentication cleanup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("removes legacy browser, vault, and pending migration records", async () => {
    const localRemoveItem = vi.fn();
    const sessionRemoveItem = vi.fn();
    vi.stubGlobal("localStorage", { removeItem: localRemoveItem });
    vi.stubGlobal("sessionStorage", { removeItem: sessionRemoveItem });

    await purgeLegacyAuthArtifacts();

    expect(localRemoveItem).toHaveBeenCalledWith("open-builder-auth");
    expect(sessionRemoveItem.mock.calls).toEqual([
      ["sso_code_verifier"],
      ["sso_state"],
    ]);
    expect(mocks.deleteSecret.mock.calls).toEqual([
      ["auth.accessToken"],
      ["auth.refreshToken"],
      ["auth.tokenExpiresAt"],
    ]);
    expect(
      mocks.removeLegacyAuthFromPendingMigration,
    ).toHaveBeenCalledOnce();
  });
});
