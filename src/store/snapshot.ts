import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import localforage from "localforage";
import { createPatch, applyPatch } from "diff";
import type { ProjectFiles, ProjectSnapshot } from "../types";
import { createLocalforageStorage } from "./utils/localforage-storage";

const snapshotStorage = createLocalforageStorage(
  localforage.createInstance({ name: "open-builder-snapshots" }),
);

interface SnapshotState {
  snapshots: Record<string, ProjectSnapshot[]>;
  _hasHydrated: boolean;

  createSnapshot: (
    conversationId: string,
    messageId: string,
    currentFiles: ProjectFiles,
  ) => void;

  getSnapshots: (conversationId: string) => ProjectSnapshot[];

  getSnapshotByMessageId: (
    conversationId: string,
    messageId: string,
  ) => ProjectSnapshot | undefined;

  reconstructFiles: (
    conversationId: string,
    snapshotId: string,
  ) => ProjectFiles;

  deleteSnapshotsForConversation: (conversationId: string) => void;

  /** Update the latest snapshot to include manual file edits */
  updateLatestSnapshot: (
    conversationId: string,
    currentFiles: ProjectFiles,
  ) => void;
}

/** Reconstruct full file state by replaying snapshots up to (and including) targetId */
function replaySnapshots(
  chain: ProjectSnapshot[],
  targetId: string,
): ProjectFiles {
  const files: ProjectFiles = {};
  for (const snap of chain) {
    // Apply added files
    for (const [path, content] of Object.entries(snap.addedFiles)) {
      files[path] = content;
    }
    // Apply patches (modified files)
    for (const [path, patch] of Object.entries(snap.patches)) {
      const old = files[path] ?? "";
      const result = applyPatch(old, patch);
      if (typeof result === "string") {
        files[path] = result;
      }
    }
    // Apply deletions
    for (const path of snap.deletedFiles) {
      delete files[path];
    }
    if (snap.id === targetId) break;
  }
  return files;
}

export const useSnapshotStore = create<SnapshotState>()(
  persist(
    (set, get) => ({
      snapshots: {},
      _hasHydrated: false,

      createSnapshot: (conversationId, messageId, currentFiles) => {
        const state = get();
        const chain = state.snapshots[conversationId] ?? [];

        // Deduplicate: if a snapshot for this messageId already exists, skip
        if (chain.some((s) => s.messageId === messageId)) return;

        // Reconstruct previous file state
        const prevFiles: ProjectFiles =
          chain.length > 0
            ? replaySnapshots(chain, chain[chain.length - 1].id)
            : {};

        const patches: Record<string, string> = {};
        const addedFiles: Record<string, string> = {};
        const deletedFiles: string[] = [];

        // Detect added and modified files
        for (const [path, content] of Object.entries(currentFiles)) {
          if (!(path in prevFiles)) {
            addedFiles[path] = content;
          } else if (prevFiles[path] !== content) {
            patches[path] = createPatch(path, prevFiles[path], content);
          }
        }

        // Detect deleted files
        for (const path of Object.keys(prevFiles)) {
          if (!(path in currentFiles)) {
            deletedFiles.push(path);
          }
        }

        // Skip if nothing changed
        if (
          Object.keys(patches).length === 0 &&
          Object.keys(addedFiles).length === 0 &&
          deletedFiles.length === 0
        ) {
          return;
        }

        const snapshot: ProjectSnapshot = {
          id: crypto.randomUUID(),
          conversationId,
          messageId,
          patches,
          addedFiles,
          deletedFiles,
          createdAt: Date.now(),
        };

        set((s) => ({
          snapshots: {
            ...s.snapshots,
            [conversationId]: [...(s.snapshots[conversationId] ?? []), snapshot],
          },
        }));
      },

      getSnapshots: (conversationId) => {
        return get().snapshots[conversationId] ?? [];
      },

      getSnapshotByMessageId: (conversationId, messageId) => {
        return (get().snapshots[conversationId] ?? []).find(
          (s) => s.messageId === messageId,
        );
      },

      reconstructFiles: (conversationId, snapshotId) => {
        const chain = get().snapshots[conversationId] ?? [];
        return replaySnapshots(chain, snapshotId);
      },

      updateLatestSnapshot: (conversationId, currentFiles) => {
        const state = get();
        const chain = state.snapshots[conversationId] ?? [];
        if (chain.length === 0) return;

        const latest = chain[chain.length - 1];

        // Reconstruct file state before the latest snapshot
        const prevFiles: ProjectFiles =
          chain.length > 1
            ? replaySnapshots(chain, chain[chain.length - 2].id)
            : {};

        const patches: Record<string, string> = {};
        const addedFiles: Record<string, string> = {};
        const deletedFiles: string[] = [];

        for (const [path, content] of Object.entries(currentFiles)) {
          if (!(path in prevFiles)) {
            addedFiles[path] = content;
          } else if (prevFiles[path] !== content) {
            patches[path] = createPatch(path, prevFiles[path], content);
          }
        }
        for (const path of Object.keys(prevFiles)) {
          if (!(path in currentFiles)) {
            deletedFiles.push(path);
          }
        }

        const updatedSnapshot: ProjectSnapshot = {
          ...latest,
          patches,
          addedFiles,
          deletedFiles,
        };

        set((s) => ({
          snapshots: {
            ...s.snapshots,
            [conversationId]: [...chain.slice(0, -1), updatedSnapshot],
          },
        }));
      },

      deleteSnapshotsForConversation: (conversationId) => {
        set((s) => {
          const { [conversationId]: _, ...rest } = s.snapshots;
          return { snapshots: rest };
        });
      },
    }),
    {
      name: "open-builder-snapshots",
      storage: createJSONStorage(() => snapshotStorage),
      partialize: (state) => ({
        snapshots: state.snapshots,
      }),
      onRehydrateStorage: () => () => {
        useSnapshotStore.setState({ _hasHydrated: true });
      },
    },
  ),
);
