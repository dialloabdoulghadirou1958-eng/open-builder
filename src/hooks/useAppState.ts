import { useState, useCallback } from "react";
import { useSettingsStore } from "../store/settings";
import { useAuthStore } from "../store/auth";
import { useConversationStore } from "../store/conversation";
import type { Message, ProjectFiles } from "../types";

// Stable default references to avoid infinite re-render with useSyncExternalStore
const EMPTY_FILES: ProjectFiles = {};
const EMPTY_MESSAGES: Message[] = [];
const DEFAULT_TEMPLATE = "vite-react-ts";

export function useAppState() {
  // ── Conversation state from zustand ──
  const activeConv = useConversationStore((s) =>
    s.activeId ? (s.conversations[s.activeId] ?? null) : null,
  );
  const files = activeConv?.files ?? EMPTY_FILES;
  const messages = activeConv?.messages ?? EMPTY_MESSAGES;
  const template = activeConv?.template ?? DEFAULT_TEMPLATE;
  const isProjectInitialized = activeConv?.isProjectInitialized ?? false;

  const setMessages = useConversationStore((s) => s.setMessages);
  const setFiles = useConversationStore((s) => s.setFiles);
  const setTemplate = useConversationStore((s) => s.setTemplate);
  const setIsProjectInitialized = useConversationStore(
    (s) => s.setIsProjectInitialized,
  );

  // ── Settings state from zustand ──
  const settings = useSettingsStore((s) => s.ai);
  const webSearchSettings = useSettingsStore((s) => s.webSearch);
  const assetSearchSettings = useSettingsStore((s) => s.assetSearch);
  const systemSettings = useSettingsStore((s) => s.system);
  const serverServiceSettings = useSettingsStore((s) => s.serverService);
  const setAI = useSettingsStore((s) => s.setAI);
  const setWebSearch = useSettingsStore((s) => s.setWebSearch);
  const setAssetSearch = useSettingsStore((s) => s.setAssetSearch);
  const setSystem = useSettingsStore((s) => s.setSystem);
  const setServerService = useSettingsStore((s) => s.setServerService);
  const isAIValid = useSettingsStore((s) => s.isAIValid);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn());
  const serverModel = useSettingsStore((s) => s.serverService.selectedModel);

  const hasValidSettings = isLoggedIn ? !!serverModel : isAIValid();

  const handleSaveSettings = setAI;
  const handleSaveWebSearchSettings = setWebSearch;
  const handleSaveAssetSearchSettings = setAssetSearch;
  const handleSaveSystemSettings = setSystem;
  const handleSaveServerServiceSettings = setServerService;

  // ── Ephemeral UI state ──
  const [currentFile, setCurrentFile] = useState("src/App.tsx");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [sandpackKey, setSandpackKey] = useState(0);

  const restartSandpack = useCallback(() => {
    setSandpackKey((k) => k + 1);
  }, []);

  return {
    files,
    setFiles,
    currentFile,
    setCurrentFile,
    messages,
    setMessages,
    isGenerating,
    setIsGenerating,
    settings,
    hasValidSettings,
    isSettingsOpen,
    setIsSettingsOpen,
    handleSaveSettings,
    webSearchSettings,
    handleSaveWebSearchSettings,
    assetSearchSettings,
    handleSaveAssetSearchSettings,
    systemSettings,
    handleSaveSystemSettings,
    serverServiceSettings,
    handleSaveServerServiceSettings,
    template,
    setTemplate,
    sandpackKey,
    restartSandpack,
    isProjectInitialized,
    setIsProjectInitialized,
  };
}
