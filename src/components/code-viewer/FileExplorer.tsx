import { useState, useEffect, useRef, useCallback } from "react";
import { File, Folder, FilePlus, FolderPlus } from "lucide-react";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { useT } from "../../i18n";
import type { ProjectFiles } from "@/types";
import { FileTreeNode } from "./file-explorer/FileTreeNode";
import { InlineInput } from "./file-explorer/InlineInput";
import { BASE_PAD, INDENT, buildFileTree } from "./file-explorer/types";
import type { FileNode } from "./file-explorer/types";

interface FileExplorerProps {
  files: ProjectFiles;
  currentFile: string;
  onFileSelect: (path: string) => void;
  onCreateFile: (path: string) => void;
  onCreateFolder: (path: string) => void;
  onRenameFile: (oldPath: string, newPath: string) => void;
  onDeleteFile: (path: string) => void;
  onMoveFile: (sourcePath: string, targetFolder: string) => void;
}

export function FileExplorer({
  files,
  currentFile,
  onFileSelect,
  onCreateFile,
  onCreateFolder,
  onRenameFile,
  onDeleteFile,
  onMoveFile,
}: FileExplorerProps) {
  const t = useT();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(["src"]),
  );
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  const [createState, setCreateState] = useState<{
    type: "file" | "folder";
    parent: string;
  } | null>(null);
  const [createName, setCreateName] = useState("");

  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");

  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const normalizedCurrentFile = currentFile.startsWith("/")
    ? currentFile.slice(1)
    : currentFile;
  const fileTree = buildFileTree(files);

  useEffect(() => {
    if (createState && createInputRef.current) {
      createInputRef.current.focus();
    }
  }, [createState]);

  useEffect(() => {
    if (renamingPath && renameInputRef.current) {
      renameInputRef.current.focus();
      const name = renameName;
      const dotIdx = name.lastIndexOf(".");
      if (dotIdx > 0) {
        renameInputRef.current.setSelectionRange(0, dotIdx);
      } else {
        renameInputRef.current.select();
      }
    }
  }, [renamingPath]);

  const toggleFolder = (path: string) => {
    setSelectedFolder(path);
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  const getCurrentDirectory = () => {
    const parts = normalizedCurrentFile.split("/");
    return parts.length === 1 ? "" : parts.slice(0, -1).join("/");
  };

  const startCreate = (type: "file" | "folder", parentDir: string) => {
    setRenamingPath(null);
    setCreateState({ type, parent: parentDir });
    setCreateName("");
    if (parentDir) setExpandedFolders((prev) => new Set(prev).add(parentDir));
  };

  const confirmCreate = () => {
    if (!createState || !createName.trim()) return;
    const fullPath = createState.parent
      ? `${createState.parent}/${createName}`
      : createName;
    if (createState.type === "file") onCreateFile(fullPath);
    else onCreateFolder(fullPath);
    setCreateState(null);
    setCreateName("");
  };

  const cancelCreate = () => {
    setCreateState(null);
    setCreateName("");
  };

  const handleCreateKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") confirmCreate();
    else if (e.key === "Escape") cancelCreate();
  };

  const startRename = (node: FileNode) => {
    setCreateState(null);
    setRenamingPath(node.path);
    setRenameName(node.name);
  };

  const confirmRename = useCallback(() => {
    if (!renamingPath || !renameName.trim()) return;
    const parts = renamingPath.split("/");
    parts[parts.length - 1] = renameName.trim();
    const newPath = parts.join("/");
    if (newPath !== renamingPath) {
      onRenameFile(renamingPath, newPath);
    }
    setRenamingPath(null);
    setRenameName("");
  }, [renamingPath, renameName, onRenameFile]);

  const cancelRename = useCallback(() => {
    setRenamingPath(null);
    setRenameName("");
  }, []);

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") confirmRename();
    else if (e.key === "Escape") cancelRename();
  };

  const handleDragStart = (e: React.DragEvent, node: FileNode) => {
    e.dataTransfer.setData("text/plain", node.path);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, folderPath: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverPath(folderPath);
  };

  const handleDragLeave = () => {
    setDragOverPath(null);
  };

  const handleDrop = (e: React.DragEvent, targetFolder: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPath(null);
    const sourcePath = e.dataTransfer.getData("text/plain");
    if (!sourcePath || sourcePath === targetFolder) return;
    if (targetFolder.startsWith(sourcePath + "/")) return;
    const sourceParent = sourcePath.includes("/")
      ? sourcePath.substring(0, sourcePath.lastIndexOf("/"))
      : "";
    if (sourceParent === targetFolder) return;
    onMoveFile(sourcePath, targetFolder);
  };

  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverPath(null);
    const sourcePath = e.dataTransfer.getData("text/plain");
    if (!sourcePath) return;
    const sourceParent = sourcePath.includes("/")
      ? sourcePath.substring(0, sourcePath.lastIndexOf("/"))
      : "";
    if (sourceParent === "") return;
    onMoveFile(sourcePath, "");
  };

  const handleRootDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const copyPath = (path: string) => {
    navigator.clipboard.writeText(path);
  };

  const downloadFile = (path: string) => {
    const normalized = path.startsWith("/") ? path.slice(1) : path;
    const content = files[normalized] ?? files[`/${normalized}`] ?? "";
    const blob = new Blob([content], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = path.split("/").pop()!;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadFolder = async (folderPath: string) => {
    const zip = new JSZip();
    const prefix = folderPath + "/";
    for (const [path, content] of Object.entries(files)) {
      const normalized = path.startsWith("/") ? path.slice(1) : path;
      if (normalized.startsWith(prefix) && !normalized.endsWith("/")) {
        zip.file(normalized.slice(prefix.length), content);
      }
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${folderPath.split("/").pop()}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const nodeProps = {
    expandedFolders,
    selectedFolder,
    dragOverPath,
    normalizedCurrentFile,
    createState,
    createName,
    setCreateName,
    createInputRef,
    confirmCreate,
    cancelCreate,
    handleCreateKeyDown,
    startCreate,
    renamingPath,
    renameName,
    setRenameName,
    renameInputRef,
    confirmRename,
    cancelRename,
    handleRenameKeyDown,
    startRename,
    toggleFolder,
    onFileSelect,
    onDeleteFile,
    copyPath,
    downloadFile,
    downloadFolder,
    setSelectedFolder,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="px-2 py-2 border-b flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase">
          {t.explorer.files}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => startCreate("file", getCurrentDirectory())}
            title={t.explorer.newFile}
          >
            <FilePlus size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => startCreate("folder", getCurrentDirectory())}
            title={t.explorer.newFolder}
          >
            <FolderPlus size={14} />
          </Button>
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto"
        style={{ scrollbarGutter: "stable" }}
        onDragOver={handleRootDragOver}
        onDrop={handleRootDrop}
      >
        {fileTree.map((node) => (
          <FileTreeNode key={node.path} node={node} level={0} {...nodeProps} />
        ))}

        {createState && createState.parent === "" && (
          <InlineInput
            ref={createInputRef}
            icon={
              createState.type === "file" ? (
                <File size={14} className="text-gray-400 shrink-0" />
              ) : (
                <Folder size={14} className="text-blue-500 shrink-0" />
              )
            }
            value={createName}
            onChange={setCreateName}
            onKeyDown={handleCreateKeyDown}
            onConfirm={confirmCreate}
            onCancel={cancelCreate}
            placeholder={
              createState.type === "file" ? "filename.tsx" : "folder-name"
            }
            paddingLeft={BASE_PAD + INDENT}
            paddingRight={BASE_PAD}
          />
        )}
      </div>
    </div>
  );
}
