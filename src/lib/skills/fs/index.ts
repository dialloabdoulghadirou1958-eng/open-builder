import { OPFSSkillFs } from "./opfs";
import { TauriSkillFs } from "./tauri";
import { detectRuntimePlatform } from "../../runtime/platform";

export interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

export interface SkillFs {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readDir(path: string): Promise<DirEntry[]>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isOpfsAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.storage &&
    typeof navigator.storage.getDirectory === "function"
  );
}

/** True if skills storage is available in this environment (Tauri FS or OPFS). */
export function isSkillsAvailable(): boolean {
  return isTauri() || isOpfsAvailable();
}

let skillFsInstance: SkillFs | null = null;

export async function createSkillFs(): Promise<SkillFs> {
  if (skillFsInstance) return skillFsInstance;

  // On mobile Tauri, prefer OPFS over native FS to avoid plugin-fs resolution issues.
  const platform = isTauri() ? await detectRuntimePlatform() : "web";

  if (platform === "desktop") {
    try {
      skillFsInstance = new TauriSkillFs();
      return skillFsInstance;
    } catch {
      // Fallback to OPFS if Tauri FS fails to load (e.g. plugin unavailable).
    }
  }

  if (!isOpfsAvailable()) {
    throw new Error(
      "Skills storage is not available in this environment (neither Tauri FS nor OPFS).",
    );
  }
  skillFsInstance = new OPFSSkillFs();
  return skillFsInstance;
}

/** Synchronous accessor for contexts that cannot await. */
export function getSkillFs(): SkillFs {
  if (!skillFsInstance) {
    throw new Error("SkillFs has not been initialized. Call createSkillFs() first.");
  }
  return skillFsInstance;
}
