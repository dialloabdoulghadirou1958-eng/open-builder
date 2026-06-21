import { useState, memo } from "react";
import { ChevronRight, Wrench, Check, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { FileTreeView } from "./FileTreeView";
import { useT } from "../../i18n";
import type { ToolBlock } from "../../types";
import { TOOL_METADATA } from "../../lib/ai/tool-metadata";

export const TOOL_CARD_LIMITS = {
  maxJsonParseChars: 200_000,
  maxResultDisplayChars: 120_000,
  maxConsoleLines: 1_000,
  maxConsoleIssues: 50,
  maxReaderUrls: 20,
} as const;

const TOOL_ICONS: Record<string, React.ReactNode> = Object.fromEntries(
  Object.entries(TOOL_METADATA).map(([name, meta]) => {
    const Icon = meta.iconComponent;
    return [name, <Icon size={14} className={meta.iconClass} />];
  }),
);

function truncateToolCardText(value: string): string {
  if (value.length <= TOOL_CARD_LIMITS.maxResultDisplayChars) return value;
  return (
    value.slice(0, TOOL_CARD_LIMITS.maxResultDisplayChars) +
    `\n\n[truncated in UI after ${TOOL_CARD_LIMITS.maxResultDisplayChars} chars]`
  );
}

function parseToolJson(result: string): any | null {
  if (result.length > TOOL_CARD_LIMITS.maxJsonParseChars) return null;
  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}

export function countSearchResults(result: string): {
  ok: boolean;
  count: number;
  error?: string;
} {
  const d = parseToolJson(result);
  if (!d) {
    return { ok: false, count: 0, error: truncateToolCardText(result) };
  }
  return { ok: d.ok, count: d.results?.length ?? 0, error: d.error };
}

export function countImageResults(result: string): {
  ok: boolean;
  count: number;
  error?: string;
} {
  const d = parseToolJson(result);
  if (!d) {
    return { ok: false, count: 0, error: truncateToolCardText(result) };
  }
  return { ok: d.ok, count: d.images?.length ?? 0, error: d.error };
}

export function parseNpmSearchResult(result: string): {
  success: boolean;
  count: number;
  error?: string;
} {
  const d = parseToolJson(result);
  if (!d) {
    return { success: false, count: 0, error: truncateToolCardText(result) };
  }
  return { success: d.success, count: d.data?.length ?? 0, error: d.error };
}

export function parseNpmDetailResult(result: string): {
  success: boolean;
  name?: string;
  error?: string;
} {
  const d = parseToolJson(result);
  if (!d) {
    return { success: false, error: truncateToolCardText(result) };
  }
  return { success: d.success, name: d.data?.name, error: d.error };
}

export function countWebReaderUrls(result: string): { url: string; ok: boolean }[] {
  const d = parseToolJson(result);
  if (!d) return [];
  return (d.pages ?? [])
    .slice(0, TOOL_CARD_LIMITS.maxReaderUrls)
    .map((p: any) => ({ url: p.url, ok: p.ok }));
}

export function parseConsoleIssues(
  result: string,
): { level: "error" | "warn"; text: string }[] {
  if (!result || result === "No console output yet.") return [];
  return result
    .split("\n")
    .slice(0, TOOL_CARD_LIMITS.maxConsoleLines)
    .filter((line) => line.startsWith("[ERROR]") || line.startsWith("[WARN]"))
    .slice(0, TOOL_CARD_LIMITS.maxConsoleIssues)
    .map((line) => ({
      level: line.startsWith("[ERROR]") ? "error" : "warn",
      text: line.replace(/^\[(ERROR|WARN)\]\s*/, ""),
    }));
}

type ToolCallCardProps = Omit<ToolBlock, "type" | "id">;

export const ToolCallCard = memo(function ToolCallCard({
  toolName,
  title,
  path,
  paths,
  result,
}: ToolCallCardProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const displayResult = result ? truncateToolCardText(result) : result;
  const isSuccess = result?.startsWith("OK") ?? false;
  const isError = result?.startsWith("Error") ?? false;

  const searchResultCount =
    toolName === "web_search" && result ? countSearchResults(result).count : 0;
  const imageResultCount =
    toolName === "image_search" && result ? countImageResults(result).count : 0;
  const npmSearchCount =
    toolName === "search_npm_packages" && result ? parseNpmSearchResult(result).count : 0;
  const npmDetailName =
    toolName === "get_npm_package_detail" && result ? parseNpmDetailResult(result).name : "";
  const readerUrls =
    toolName === "web_reader" && result ? countWebReaderUrls(result) : [];
  const consoleIssues =
    toolName === "get_console_logs" && result ? parseConsoleIssues(result) : [];
  const consoleErrorCount = consoleIssues.filter(
    (i) => i.level === "error",
  ).length;
  const consoleWarnCount = consoleIssues.filter(
    (i) => i.level === "warn",
  ).length;

  return (
    <div className="border border-border/60 rounded-lg overflow-hidden bg-muted/30">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex items-center shrink-0">
          {TOOL_ICONS[toolName] ?? (
            <Wrench size={14} className="text-muted-foreground" />
          )}
        </span>
        <span className="text-xs font-medium flex-1 text-foreground">
          {title}
        </span>
        {toolName === "web_search" && result ? (
          <Badge variant="secondary" className="text-xs font-mono h-5">
            {searchResultCount} {t.tool.results}
          </Badge>
        ) : toolName === "image_search" && result ? (
          <Badge variant="secondary" className="text-xs font-mono h-5">
            {imageResultCount} {t.tool.images}
          </Badge>
        ) : toolName === "search_npm_packages" && result ? (
          <Badge variant="secondary" className="text-xs font-mono h-5">
            {npmSearchCount} {t.tool.packages}
          </Badge>
        ) : toolName === "get_npm_package_detail" && result && npmDetailName ? (
          <Badge variant="secondary" className="text-xs font-mono h-5 max-w-35 truncate">
            {npmDetailName}
          </Badge>
        ) : toolName === "web_reader" && result ? (
          <Badge variant="secondary" className="text-xs font-mono h-5">
            {readerUrls.length} {t.tool.pages}
          </Badge>
        ) : toolName === "get_console_logs" && result ? (
          consoleErrorCount > 0 ? (
            <Badge variant="destructive" className="text-xs font-mono h-5">
              {consoleErrorCount} {t.tool.errors}
              {consoleWarnCount > 0 ? ` · ${consoleWarnCount} ${t.tool.warnings}` : ""}
            </Badge>
          ) : consoleWarnCount > 0 ? (
            <Badge
              variant="secondary"
              className="text-xs font-mono h-5 text-yellow-600"
            >
              {consoleWarnCount} {t.tool.warnings}
            </Badge>
          ) : null
        ) : paths && paths.length > 0 ? (
          <Badge variant="secondary" className="text-xs font-mono h-5">
            {paths.length} {t.tool.files}
          </Badge>
        ) : path ? (
          <Badge
            variant="secondary"
            className="text-xs font-mono h-5 max-w-35 truncate"
          >
            {path.split("/").pop()}
          </Badge>
        ) : null}
        {result ? (
          <div
            className={cn(
              "w-1.5 h-1.5 rounded-full shrink-0",
              toolName === "get_console_logs"
                ? consoleErrorCount > 0
                  ? "bg-red-500"
                  : consoleWarnCount > 0
                    ? "bg-yellow-400"
                    : "bg-green-500"
                : isSuccess && "bg-green-500",
              toolName !== "get_console_logs" && isError && "bg-red-500",
              toolName !== "get_console_logs" &&
                !isSuccess &&
                !isError &&
                "bg-green-500",
            )}
          />
        ) : (
          <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse shrink-0" />
        )}
        <ChevronRight
          size={13}
          className={cn(
            "text-muted-foreground transition-transform shrink-0",
            expanded && "rotate-90",
          )}
        />
      </button>

      {expanded && result && (
        <div className="px-3 py-2 border-t border-border/60 bg-muted/20">
          {toolName === "list_files" ? (
            <FileTreeView content={displayResult ?? ""} />
          ) : toolName === "read_files" ? (
            <FileTreeView content={(paths || []).join("\n")} />
          ) : toolName === "read_file" ? (
            <span className="text-xs text-muted-foreground italic">
              {t.tool.fileHidden}
            </span>
          ) : toolName === "get_console_logs" ? (
            consoleIssues.length === 0 ? (
              <p className="text-xs text-green-600">{t.tool.noIssues}</p>
            ) : (
              <div className="space-y-1">
                {consoleIssues.map((issue, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex items-start gap-1.5 text-xs font-mono whitespace-pre-wrap leading-relaxed",
                      issue.level === "error"
                        ? "text-red-500"
                        : "text-yellow-600",
                    )}
                  >
                    {issue.level === "error" ? (
                      <X size={12} className="mt-0.5 shrink-0" />
                    ) : (
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    )}
                    <span>{issue.text}</span>
                  </div>
                ))}
              </div>
            )
          ) : toolName === "web_search" ? (
            <p className="text-xs text-muted-foreground">
              {result.startsWith("Error")
                ? `${t.tool.failed}${result}`
                : `${t.tool.found}${searchResultCount} ${t.tool.searchResults}`}
            </p>
          ) : toolName === "image_search" ? (
            <p className="text-xs text-muted-foreground">
              {result.startsWith("Error")
                ? `${t.tool.failed}${result}`
                : `${t.tool.found}${imageResultCount} ${t.tool.imageResults}`}
            </p>
          ) : toolName === "search_npm_packages" ? (
            <p className="text-xs text-muted-foreground">
              {result.includes('"success":false')
                ? `${t.tool.failed}${parseNpmSearchResult(result).error}`
                : `${t.tool.found}${npmSearchCount} ${t.tool.npmPackages}`}
            </p>
          ) : toolName === "get_npm_package_detail" ? (
            <p className="text-xs text-muted-foreground">
              {result.includes('"success":false')
                ? `${t.tool.failed}${parseNpmDetailResult(result).error}`
                : `${t.tool.found}${npmDetailName}`}
            </p>
          ) : toolName === "web_reader" ? (
            <div className="space-y-0.5">
              {readerUrls.map(({ url, ok }) => (
                <div
                  key={url}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  {ok ? (
                    <Check size={12} className="text-green-500 shrink-0" />
                  ) : (
                    <X size={12} className="text-red-500 shrink-0" />
                  )}
                  <span className="truncate">{url}</span>
                </div>
              ))}
            </div>
          ) : (
            <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground leading-relaxed">
              {displayResult}
            </pre>
          )}
        </div>
      )}
    </div>
  );
});
