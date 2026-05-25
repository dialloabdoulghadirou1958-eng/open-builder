import { createSkillFs, isSkillsAvailable } from "./fs";
import { SkillRegistry } from "./registry";
import { useSkillsStore } from "../../store/skills";

let registryPromise: Promise<SkillRegistry> | null = null;
let initialized = false;

async function waitForStoreHydration(): Promise<void> {
  if (useSkillsStore.getState()._hasHydrated) return;
  await new Promise<void>((resolve) => {
    const unsub = useSkillsStore.subscribe((state) => {
      if (state._hasHydrated) {
        unsub();
        resolve();
      }
    });
  });
}

export function getSkillRegistry(): Promise<SkillRegistry> {
  if (registryPromise) return registryPromise;
  registryPromise = (async () => {
    if (!isSkillsAvailable()) {
      throw new Error(
        "Skills storage is not available in this environment (neither Tauri FS nor OPFS).",
      );
    }
    await waitForStoreHydration();
    const fs = createSkillFs();
    const registry = new SkillRegistry(fs, useSkillsStore.getState());
    if (!initialized) {
      await registry.initialize();
      initialized = true;
    }
    return registry;
  })();
  return registryPromise;
}

export function resetSkillRegistryForTesting(): void {
  registryPromise = null;
  initialized = false;
}
