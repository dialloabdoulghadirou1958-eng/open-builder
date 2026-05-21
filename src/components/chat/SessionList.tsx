import { useState, useRef, useEffect, useMemo } from "react";
import {
  Plus,
  Trash2,
  PanelLeftClose,
  Pencil,
  Check,
  X,
  ChevronRight,
  EllipsisVertical,
  Pin,
  Archive,
  Sparkles,
  UserCircle,
  LogOut,
  LogIn,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { useConversationStore, DEFAULT_TITLE } from "../../store/conversation";
import { useSettingsStore } from "../../store/settings";
import { useAuthStore } from "../../store/auth";
import { initiateLogin } from "../../lib/sso";
import { generateSmartTitle } from "../../lib/smartTitle";
import { cn } from "@/lib/utils";
import { useT } from "../../i18n";
import type { Conversation } from "../../types";

interface SessionListProps {
  onToggleSessionList: () => void;
  onClose: () => void;
}

export function SessionList({
  onToggleSessionList,
  onClose,
}: SessionListProps) {
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
    initiateLogin().catch(err => {
      console.error("Login failed:", err);
      useAuthStore.getState().setLoggingIn(false);
    });
  };

  const handleLogout = () => {
    useAuthStore.getState().clearAuth();
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [normalOpen, setNormalOpen] = useState(true);
  const [archivedOpen, setArchivedOpen] = useState(false);

  const sorted = useMemo(
    () =>
      Object.values(conversations).sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations],
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

  useEffect(() => {
    if (editingId) inputRef.current?.focus();
  }, [editingId]);

  const handleNew = () => {
    createConversation();
    onClose();
  };

  const handleSelect = (id: string) => {
    if (editingId === id) return;
    switchConversation(id);
    onClose();
  };

  const startEdit = (id: string, title: string) => {
    setEditingId(id);
    setEditingTitle(title === DEFAULT_TITLE ? "" : title);
  };

  const commitEdit = () => {
    if (editingId && editingTitle.trim()) {
      renameConversation(editingId, editingTitle.trim());
    }
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") cancelEdit();
  };

  const handleSmartRename = async (convId: string) => {
    const conv = conversations[convId];
    if (!conv || conv.messages.length === 0) return;

    const ai = useSettingsStore.getState().ai;
    if (!ai.apiKey || !ai.apiBaseUrl || !ai.model) return;

    setRenamingId(convId);
    try {
      const title = await generateSmartTitle(
        conv.messages,
        ai.apiType,
        ai.apiBaseUrl,
        ai.apiKey,
        ai.model,
      );
      if (title) {
        renameConversation(convId, title);
      }
    } finally {
      setRenamingId(null);
    }
  };

  const displayTitle = (conv: Conversation) =>
    conv.title === DEFAULT_TITLE ? t.chat.newApp : conv.title;

  const renderItem = (conv: Conversation) => (
    <div
      key={conv.id}
      className={cn(
        "flex items-center h-14 gap-2 px-3 cursor-pointer hover:bg-muted/50 group",
        conv.id === activeId && "bg-muted",
      )}
      onClick={() => handleSelect(conv.id)}
    >
      {editingId === conv.id ? (
        <input
          ref={inputRef}
          className="text-sm flex-1 bg-transparent border-b border-primary outline-none min-w-0"
          value={editingTitle}
          onChange={(e) => setEditingTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className={cn(
            "text-sm truncate flex-1",
            renamingId === conv.id && "animate-pulse",
          )}
        >
          {displayTitle(conv)}
        </span>
      )}

      {editingId === conv.id ? (
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              commitEdit();
            }}
          >
            <Check size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              cancelEdit();
            }}
          >
            <X size={12} />
          </Button>
        </div>
      ) : (
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <EllipsisVertical size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {conv.pinned ? (
                <DropdownMenuItem onSelect={() => unpinConversation(conv.id)}>
                  <Pin size={14} className="rotate-45" />
                  {t.sessions.unpin}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => pinConversation(conv.id)}>
                  <Pin size={14} />
                  {t.sessions.pin}
                </DropdownMenuItem>
              )}
              {conv.archived ? (
                <DropdownMenuItem
                  onSelect={() => unarchiveConversation(conv.id)}
                >
                  <Archive size={14} />
                  {t.sessions.unarchive}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => archiveConversation(conv.id)}>
                  <Archive size={14} />
                  {t.sessions.archive}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => startEdit(conv.id, conv.title)}>
                <Pencil size={14} />
                {t.sessions.rename}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => handleSmartRename(conv.id)}
                disabled={conv.messages.length === 0}
              >
                <Sparkles size={14} />
                {t.sessions.smartRename}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => deleteConversation(conv.id)}
                disabled={sorted.length <= 1}
              >
                <Trash2 size={14} />
                {t.sessions.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );

  const renderGroup = (
    label: string,
    items: Conversation[],
    open: boolean,
    onOpenChange: (v: boolean) => void,
  ) => {
    if (items.length === 0) return null;
    return (
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-1.5 px-3 py-1.5 w-full text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
            <ChevronRight
              size={12}
              className={cn("transition-transform", open && "rotate-90")}
            />
            <span className="font-medium">{label}</span>
            <span className="ml-auto text-muted-foreground/60">
              {items.length}
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>{items.map(renderItem)}</CollapsibleContent>
      </Collapsible>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <div className="px-3 py-2.5 border-b flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleSessionList}
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
      <div className="flex-1 overflow-y-auto">
        {hasGroups ? (
          <>
            {renderGroup(t.sessions.pinned, pinned, pinnedOpen, setPinnedOpen)}
            {renderGroup(t.sessions.normal, normal, normalOpen, setNormalOpen)}
            {renderGroup(
              t.sessions.archived,
              archived,
              archivedOpen,
              setArchivedOpen,
            )}
          </>
        ) : (
          sorted.map(renderItem)
        )}
      </div>

      <div className="mt-auto p-3 border-t">
        {isAuth && profile ? (
          <div className="flex items-center gap-2 mb-3 px-2 py-1.5 rounded-lg border bg-card text-card-foreground shadow-sm">
            {profile.picture ? (
              <img src={profile.picture} alt="Avatar" className="w-8 h-8 rounded-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <UserCircle className="w-8 h-8 text-muted-foreground" />
            )}
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium truncate">{profile.name}</p>
              <p className="text-xs text-muted-foreground truncate">{profile.email}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={handleLogout} className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted" title={t.auth.logout}>
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
