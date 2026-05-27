import { useCallback, useMemo, useState } from "react";
import {
  Plus,
  PanelLeftClose,
  UserCircle,
  LogOut,
  LogIn,
  Loader2,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConversationStore, DEFAULT_TITLE } from "../../store/conversation";
import { useSettingsStore } from "../../store/settings";
import { useAuthStore } from "../../store/auth";
import { initiateLogin } from "../../lib/services/sso";
import { generateSmartTitle } from "../../lib/utils/smart-title";
import { useT } from "../../i18n";
import type { Conversation } from "../../types";
import { SessionItem } from "./session-list/SessionItem";
import { SessionGroup } from "./session-list/SessionGroup";

interface SessionListProps {
  onClose: () => void;
}

export function SessionList({ onClose }: SessionListProps) {
  const t = useT();
  const conversations = useConversationStore((s) => s.conversations);
  const activeId = useConversationStore((s) => s.activeId);
  const switchConversation = useConversationStore((s) => s.switchConversation);
  const createConversation = useConversationStore((s) => s.createConversation);
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

  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [normalOpen, setNormalOpen] = useState(true);
  const [archivedOpen, setArchivedOpen] = useState(false);

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

  const sorted = useMemo(
    () =>
      Object.values(conversations)
        .filter(matchesQuery)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations, matchesQuery],
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

  const hasGroups = pinned.length > 0 || archived.length > 0;
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

  const handleSmartRename = useCallback(
    async (convId: string) => {
      const conv = useConversationStore.getState().conversations[convId];
      if (!conv || conv.messages.length === 0) return;

      const ai = useSettingsStore.getState().ai;
      if (!ai.apiKey || !ai.apiBaseUrl || !ai.model) return;

      setRenamingId(convId);
      try {
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

  const displayTitle = useCallback(
    (conv: Conversation) =>
      conv.title === DEFAULT_TITLE ? t.chat.newApp : conv.title,
    [t.chat.newApp],
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
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleNew}
        >
          <Plus size={18} />
        </Button>
      </div>
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
    </div>
  );
}
