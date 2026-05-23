import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { WebAppGenerator } from "../lib/ai/generator";
import type { ProjectFiles } from "../types";

interface UseFileOperationsArgs {
  setFiles: Dispatch<SetStateAction<ProjectFiles>>;
  generatorRef: MutableRefObject<WebAppGenerator | null>;
}

/**
 * File system operations that keep the React `files` state and the in-memory
 * generator's `files` map in sync. The generator may be null (no generation
 * has started yet); operations still apply to React state.
 */
export function useFileOperations({
  setFiles,
  generatorRef,
}: UseFileOperationsArgs) {
  const updateFiles = useCallback(
    (path: string, content: string) => {
      setFiles((prev) => {
        const next = { ...prev, [path]: content };
        generatorRef.current?.setFiles(next);
        return next;
      });
    },
    [setFiles, generatorRef],
  );

  const deleteFile = useCallback(
    (path: string) => {
      setFiles((prev) => {
        const next = { ...prev };
        const prefix = path + "/";
        for (const key of Object.keys(next)) {
          if (key === path || key.startsWith(prefix)) {
            delete next[key];
          }
        }
        generatorRef.current?.setFiles(next);
        return next;
      });
    },
    [setFiles, generatorRef],
  );

  const renameFile = useCallback(
    (oldPath: string, newPath: string) => {
      setFiles((prev) => {
        const next: ProjectFiles = {};
        const prefix = oldPath + "/";
        for (const [key, value] of Object.entries(prev)) {
          if (key === oldPath) {
            next[newPath] = value;
          } else if (key.startsWith(prefix)) {
            next[newPath + key.slice(oldPath.length)] = value;
          } else {
            next[key] = value;
          }
        }
        generatorRef.current?.setFiles(next);
        return next;
      });
    },
    [setFiles, generatorRef],
  );

  const moveFile = useCallback(
    (sourcePath: string, targetFolder: string) => {
      const fileName = sourcePath.split("/").pop()!;
      const newPath = targetFolder ? `${targetFolder}/${fileName}` : fileName;
      renameFile(sourcePath, newPath);
    },
    [renameFile],
  );

  return { updateFiles, deleteFile, renameFile, moveFile };
}
