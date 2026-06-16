import { useCallback, useMemo, useRef, useState } from "react";
import {
  Plus,
  PanelLeftClose,
  UserCircle,
  LogOut,
  LogIn,
  Loader2,
  Search,
  Upload,
  Library,
} from "lucide-react";
import { saveAs } from "file-saver";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConversationStore, DEFAULT_TITLE } from "../../store/conversation";
import { useProjectTemplateStore } from "../../store/project-templates";
import { useSettingsStore } from "../../store/settings";
import { useAuthStore } from "../../store/auth";
import { useSnapshotStore } from "../../store/snapshot";
import { initiateLogin } from "../../lib/services/sso";
import {
  cloneImportedConversation,
  cloneImportedSnapshots,
  createConversationExport,
  exportFileName,
  parseConversationExport,
} from "../../lib/utils/conversation-export";
import {
  createConversationFromProjectTemplate,
  createProjectTemplateFromConversation,
} from "../../lib/utils/project-templates";
import { useT } from "../../i18n";
import type { Conversation } from "../../types";
import {
  ProjectTemplateDialog,
  type ProjectTemplateSaveInput,
} from "./ProjectTemplateDialog";
import { SessionItem } from "./session-list/SessionItem";
import { SessionGroup } from "./session-list/SessionGroup";

interface SessionListProps {
  onClose: () => void;
}

type SessionFilter = "all" | "pinned" | "archived" | "project" | "error";

export function SessionList({ onClose }: SessionListProps) {
  const t = useT();
  const conversations = useConversationStore((s) => s.conversations);
  const activeId = useConversationStore((s) => s.activeId);
  const switchConversation = useConversationStore((s) => s.switchConversation);
  const createConversation = useConversationStore((s) => s.createConversation);
  const importConversation = useConversationStore((s) => s.importConversation);
  const deleteConversation = useConversationStore((s) => s.deleteConversation);
  const renameConversation = useConversationStore((s) => s.renameConversation);
  const pinConversation = useConversationStore((s) => s.pinConversation);
  const unpinConversation = useConversationStore((s) => s.unpinConversation);
  const archiveConversation = useConversationStore(
    (s) => s.archiveConversation,
  );
  const unarchiveConversation = useConversationStore(
    (s) => s.unarchiveConversation,
  );
  const templateRecord = useProjectTemplateStore((s) => s.templates);
  const addTemplate = useProjectTemplateStore((s) => s.addTemplate);
  const deleteTemplate = useProjectTemplateStore((s) => s.deleteTemplate);
  const importSnapshotsForConversation = useSnapshotStore(
    (s) => s.importSnapshotsForConversation,
  );

  const isAuth = useAuthStore((s) => s.isLoggedIn());
  const profile = useAuthStore((s) => s.user);
  const isLoggingIn = useAuthStore((s) => s.isLoggingIn);

  const handleLogin = () => {
    useAuthStore.getState().setLoggingIn(true);
    initiateLogin().catch((err) => {
      console.error("Login failed:", err);
      useAuthStore.getState().setLoggingIn(false);
    });
  };

  const handleLogout = () => {
    useAuthStore.getState().clearAuth();
  };

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SessionFilter>("all");
  const [importMessage, setImportMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [normalOpen, setNormalOpen] = useState(true);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateSourceId, setTemplateSourceId] = useState<string | null>(null);

  const matchesQuery = useCallback(
    (conv: Conversation) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      const title = (
        conv.title === DEFAULT_TITLE ? t.chat.newApp : conv.title
      ).toLowerCase();
      return title.includes(q);
    },
    [query, t.chat.newApp],
  );

  const hasProject = useCallback(
    (conv: Conversation) =>
      conv.isProjectInitialized || Object.keys(conv.files).length > 0,
    [],
  );

  const hasError = useCallback(
    (conv: Conversation) =>
      conv.messages.some(
        (m) =>
          m.isError ||
          (m.role === "assistant" &&
            typeof m.content === "string" &&
            m.content.startsWith("⚠️")),
      ),
    [],
  );

  const matchesFilter = useCallback(
    (conv: Conversation) => {
      switch (filter) {
        case "pinned":
          return !!conv.pinned && !conv.archived;
        case "archived":
          return !!conv.archived;
        case "project":
          return hasProject(conv);
        case "error":
          return hasError(conv);
        case "all":
        default:
          return true;
      }
    },
    [filter, hasError, hasProject],
  );

  const sorted = useMemo(
    () =>
      Object.values(conversations)
        .filter(matchesQuery)
        .filter(matchesFilter)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations, matchesQuery, matchesFilter],
  );

  const pinned = useMemo(
    () => sorted.filter((c) => c.pinned && !c.archived),
    [sorted],
  );
  const normal = useMemo(
    () => sorted.filter((c) => !c.pinned && !c.archived),
    [sorted],
  );
  const archived = useMemo(() => sorted.filter((c) => c.archived), [sorted]);
  const templates = useMemo(
    () => Object.values(templateRecord).sort((a, b) => b.updatedAt - a.updatedAt),
    [templateRecord],
  );

  const hasGroups = filter === "all" && (pinned.length > 0 || archived.length > 0);
  const deleteDisabled = Object.keys(conversations).length <= 1;

  const handleNew = () => {
    createConversation();
    onClose();
  };

  const handleSelect = useCallback(
    (id: string) => {
      switchConversation(id);
      onClose();
    },
    [switchConversation, onClose],
  );

  const displayTitle = useCallback(
    (conv: Conversation) =>
      conv.title === DEFAULT_TITLE ? t.chat.newApp : conv.title,
    [t.chat.newApp],
  );

  const openTemplates = useCallback(
    (sourceId?: string) => {
      setTemplateSourceId(sourceId ?? activeId);
      setTemplatesOpen(true);
    },
    [activeId],
  );

  const templateSourceConversation = useMemo(() => {
    const sourceId = templateSourceId ?? activeId;
    return sourceId ? conversations[sourceId] ?? null : null;
  }, [activeId, conversations, templateSourceId]);

  const templateSourceTitle = templateSourceConversation
    ? displayTitle(templateSourceConversation)
    : t.chat.newApp;

  const handleSaveCurrentTemplate = useCallback(
    (input: ProjectTemplateSaveInput) => {
      const sourceId = templateSourceId ?? activeId;
      const conversation = sourceId
        ? useConversationStore.getState().conversations[sourceId]
        : null;
      if (!conversation) return;

      addTemplate(
        createProjectTemplateFromConversation(conversation, {
          id: crypto.randomUUID(),
          name: input.name,
          description: input.description,
          tags: input.tags,
          now: Date.now(),
        }),
      );
    },
    [activeId, addTemplate, templateSourceId],
  );

  const handleCreateFromTemplate = useCallback(
    (templateId: string) => {
      const template = useProjectTemplateStore.getState().templates[templateId];
      if (!template) return;
      const conversation = createConversationFromProjectTemplate(template, {
        id: crypto.randomUUID(),
        now: Date.now(),
      });
      importConversation(conversation);
      setFilter("all");
      setQuery("");
      setTemplatesOpen(false);
      onClose();
    },
    [importConversation, onClose],
  );

  const handleExport = useCallback(
    (convId: string) => {
      const conv = useConversationStore.getState().conversations[convId];
      if (!conv) return;
      const snapshots =
        useSnapshotStore.getState().snapshots[convId] ?? [];
      const payload = createConversationExport(conv, snapshots);
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      saveAs(blob, exportFileName(displayTitle(conv)));
    },
    [displayTitle],
  );

  const handleImportFile = useCallback(
    async (file: File) => {
      setImportMessage(null);
      try {
        const parsed = parseConversationExport(await file.text());
        const now = Date.now();
        const conversation = cloneImportedConversation(
          parsed.conversation,
          crypto.randomUUID(),
          now,
        );
        const snapshots = cloneImportedSnapshots(
          parsed.snapshots,
          conversation.id,
          now,
        );
        const id = importConversation(conversation);
        importSnapshotsForConversation(id, snapshots);
        switchConversation(id);
        setFilter("all");
        setQuery("");
        setImportMessage({ type: "success", text: t.sessions.importSuccess });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setImportMessage({
          type: "error",
          text: t.sessions.importFailed.replace("{message}", message),
        });
      } finally {
        if (importInputRef.current) importInputRef.current.value = "";
      }
    },
    [
      importConversation,
      importSnapshotsForConversation,
      switchConversation,
      t.sessions.importFailed,
      t.sessions.importSuccess,
    ],
  );

  const filterOptions: Array<{ value: SessionFilter; label: string }> = [
    { value: "all", label: t.sessions.filters.all },
    { value: "pinned", label: t.sessions.filters.pinned },
    { value: "archived", label: t.sessions.filters.archived },
    { value: "project", label: t.sessions.filters.project },
    { value: "error", label: t.sessions.filters.error },
  ];

  const handleSmartRename = useCallback(
    async (convId: string) => {
      const conv = useConversationStore.getState().conversations[convId];
      if (!conv || conv.messages.length === 0) return;

      const ai = useSettingsStore.getState().ai;
      if (!ai.apiKey || !ai.apiBaseUrl || !ai.model) return;

      setRenamingId(convId);
      try {
        const { generateSmartTitle } = await import(
          "../../lib/utils/smart-title"
        );
        const title = await generateSmartTitle(conv.messages, {
          apiType: ai.apiType,
          apiBaseUrl: ai.apiBaseUrl,
          apiKey: ai.apiKey,
          model: ai.model,
        });
        if (title) {
          renameConversation(convId, title);
        }
      } finally {
        setRenamingId(null);
      }
    },
    [renameConversation],
  );

  const renderItem = (conv: Conversation) => (
    <SessionItem
      key={conv.id}
      conv={conv}
      isActive={conv.id === activeId}
      isSmartRenaming={renamingId === conv.id}
      defaultEditValue={conv.title === DEFAULT_TITLE ? "" : conv.title}
      displayTitle={displayTitle}
      onSelect={handleSelect}
      onRename={renameConversation}
      onSmartRename={handleSmartRename}
      onExport={handleExport}
      onSaveAsTemplate={openTemplates}
      canSaveAsTemplate={Object.keys(conv.files).length > 0}
      pin={pinConversation}
      unpin={unpinConversation}
      archive={archiveConversation}
      unarchive={unarchiveConversation}
      onDelete={deleteConversation}
      deleteDisabled={deleteDisabled}
    />
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <div className="px-3 py-2.5 border-b flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          title={t.header.sessions}
          className="h-8 w-8"
        >
          <PanelLeftClose size={18} />
        </Button>
        <span className="text-sm font-medium">{t.sessions.title}</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => openTemplates()}
            title={t.sessions.templates.title}
          >
            <Library size={17} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => importInputRef.current?.click()}
            title={t.sessions.import}
          >
            <Upload size={17} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleNew}
          >
            <Plus size={18} />
          </Button>
        </div>
      </div>
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json,.open-builder.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImportFile(file);
        }}
      />
      <div className="px-3 py-2 border-b">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.sessions.searchPlaceholder}
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>
      <div className="px-3 py-2 border-b">
        <div className="flex gap-1 overflow-x-auto">
          {filterOptions.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant={filter === option.value ? "secondary" : "ghost"}
              size="sm"
              className="h-7 shrink-0 px-2 text-xs"
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
      {importMessage && (
        <p
          className={`border-b px-3 py-2 text-xs ${
            importMessage.type === "error"
              ? "text-destructive"
              : "text-muted-foreground"
          }`}
        >
          {importMessage.text}
        </p>
      )}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground text-center">
            {t.sessions.emptySearch}
          </p>
        ) : hasGroups ? (
          <>
            <SessionGroup
              label={t.sessions.pinned}
              count={pinned.length}
              open={pinnedOpen}
              onOpenChange={setPinnedOpen}
            >
              {pinned.map(renderItem)}
            </SessionGroup>
            <SessionGroup
              label={t.sessions.normal}
              count={normal.length}
              open={normalOpen}
              onOpenChange={setNormalOpen}
            >
              {normal.map(renderItem)}
            </SessionGroup>
            <SessionGroup
              label={t.sessions.archived}
              count={archived.length}
              open={archivedOpen}
              onOpenChange={setArchivedOpen}
            >
              {archived.map(renderItem)}
            </SessionGroup>
          </>
        ) : (
          sorted.map(renderItem)
        )}
      </div>

      <div className="mt-auto p-3 border-t">
        {isAuth && profile ? (
          <div className="flex items-center gap-2 mb-3 px-2 py-1.5 rounded-lg border bg-card text-card-foreground shadow-sm">
            {profile.picture ? (
              <img
                src={profile.picture}
                alt="Avatar"
                className="w-8 h-8 rounded-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <UserCircle className="w-8 h-8 text-muted-foreground" />
            )}
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium truncate">{profile.name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {profile.email}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted"
              title={t.auth.logout}
            >
              <LogOut size={16} />
            </Button>
          </div>
        ) : (
          <Button
            variant="default"
            className="w-full gap-2"
            onClick={handleLogin}
            disabled={isLoggingIn}
          >
            {isLoggingIn ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <LogIn size={16} />
            )}
            {isLoggingIn ? t.auth.loggingIn : t.auth.login}
          </Button>
        )}
      </div>
      {templatesOpen && (
        <ProjectTemplateDialog
          sourceConversation={templateSourceConversation}
          sourceTitle={templateSourceTitle}
          templates={templates}
          onClose={() => setTemplatesOpen(false)}
          onSaveCurrent={handleSaveCurrentTemplate}
          onCreateFromTemplate={handleCreateFromTemplate}
          onDeleteTemplate={deleteTemplate}
        />
      )}
    </div>
  );
}
