import { tool } from "ai";
import { z } from "zod";
import type { WebSearchSettings } from "../../store/settings";
import {
  WEB_PAGE_MAX_CHARS,
  WEB_READER_MAX_URLS,
  WEB_SEARCH_MAX_RESULTS,
  SEARCH_SNIPPET_MAX_CHARS,
  TOOL_FETCH_TIMEOUT_MS,
  TOOL_MAX_CONCURRENCY,
  clampInt,
  fetchWithTimeout,
  formatHttpError,
  limitArray,
  mapWithConcurrency,
  normalizeHttpUrlList,
  normalizeToolQuery,
  safeErrorMessage,
  truncateText,
} from "./network-guard";

const TAVILY_API_URL = "https://api.tavily.com";
const FIRECRAWL_API_URL = "https://api.firecrawl.dev";

// ═══════════════════════════════ 工具定义 ═══════════════════════════════════

export const WEB_READER_TOOL = {
  web_reader: tool({
    description:
      "Read and extract the main content from one or more web pages. " +
      "Provide URLs to fetch their full text content.",
    inputSchema: z.object({
      urls: z.array(z.string()).describe("List of URLs to read"),
    }),
  }),
};

export const SEARCH_TOOLS = {
  web_search: tool({
    description:
      "Search the web for information using a query string. " +
      "Returns relevant results with titles, URLs, and content snippets. " +
      "Use this when you need up-to-date information from the internet.",
    inputSchema: z.object({
      query: z.string().describe("The search query"),
      max_results: z
        .number()
        .optional()
        .describe("Maximum number of results to return (default: 5)"),
    }),
  }),
  ...WEB_READER_TOOL,
};

// ═══════════════════════════════ Tavily API ═══════════════════════════════════

async function tavilySearch(
  settings: WebSearchSettings,
  query: string,
  maxResults: number = 5,
): Promise<string> {
  const checkedQuery = normalizeToolQuery(query);
  if (!checkedQuery.ok) {
    return JSON.stringify({ ok: false, error: checkedQuery.error });
  }
  const size = clampInt(maxResults, 5, 1, WEB_SEARCH_MAX_RESULTS);
  try {
    const res = await fetchWithTimeout(`${TAVILY_API_URL}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: settings.tavilyApiKey,
        query: checkedQuery.query,
        max_results: size,
        include_answer: true,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return JSON.stringify({
        ok: false,
        error: formatHttpError("Tavily search failed", res.status, text),
      });
    }
    const data = await res.json();
    const limited = limitArray(data.results ?? [], size);
    return JSON.stringify({
      ok: true,
      answer: data.answer ?? null,
      results: limited.items.map((r: any) => {
        const content = truncateText(r.content, SEARCH_SNIPPET_MAX_CHARS);
        return {
          title: r.title,
          url: r.url,
          content: content.text,
          contentTruncated: content.truncated,
        };
      }),
      meta: {
        engine: "tavily",
        maxResults: size,
        truncatedResults: limited.truncated,
      },
    });
  } catch (err) {
    return JSON.stringify({ ok: false, error: safeErrorMessage(err) });
  }
}

async function tavilyExtract(
  settings: WebSearchSettings,
  urls: string[],
): Promise<string> {
  const checkedUrls = normalizeHttpUrlList(urls, WEB_READER_MAX_URLS);
  if (!checkedUrls.ok) {
    return JSON.stringify({ ok: false, error: checkedUrls.error });
  }
  try {
    const res = await fetchWithTimeout(`${TAVILY_API_URL}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: settings.tavilyApiKey,
        urls: checkedUrls.urls,
      }),
    });
    if (!res.ok) {
      throw new Error(
        formatHttpError(
          "Tavily extract failed",
          res.status,
          await res.text(),
        ),
      );
    }
    const data = await res.json();
    const results = (data.results ?? []) as {
      url: string;
      raw_content: string;
    }[];
    if (results.length === 0) throw new Error("Tavily returned empty results");
    return JSON.stringify({
      ok: true,
      pages: results.map((r) => ({
        url: r.url,
        ok: true,
        ...formatPageContent(r.raw_content),
      })),
      meta: {
        engine: "tavily",
        urlLimit: WEB_READER_MAX_URLS,
        truncatedUrls: checkedUrls.truncated,
      },
    });
  } catch (err: any) {
    console.warn("Tavily extract failed, falling back to Jina:", err.message);
    return jinaFallback(urls);
  }
}

async function fetchSinglePageViaJina(url: string): Promise<{
  url: string;
  ok: boolean;
  content?: string;
  error?: string;
}> {
  try {
    const res = await fetchWithTimeout(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/plain" },
    });
    if (!res.ok) {
      return {
        url,
        ok: false,
        error: `Jina fetch failed (${res.status})`,
      };
    }
    return { url, ok: true, ...formatPageContent(await res.text()) };
  } catch (err: any) {
    return {
      url,
      ok: false,
      error: safeErrorMessage(err),
    };
  }
}

async function jinaFallback(urls: string[]): Promise<string> {
  const checkedUrls = normalizeHttpUrlList(urls, WEB_READER_MAX_URLS);
  if (!checkedUrls.ok) {
    return JSON.stringify({ ok: false, error: checkedUrls.error, pages: [] });
  }
  const pages = await mapWithConcurrency(
    checkedUrls.urls,
    TOOL_MAX_CONCURRENCY,
    fetchSinglePageViaJina,
  );
  return JSON.stringify({
    ok: pages.some((p) => p.ok),
    pages,
    meta: {
      engine: "jina",
      timeoutMs: TOOL_FETCH_TIMEOUT_MS,
      concurrency: TOOL_MAX_CONCURRENCY,
      urlLimit: WEB_READER_MAX_URLS,
      truncatedUrls: checkedUrls.truncated,
    },
  });
}

// ═══════════════════════════════ Firecrawl API ═══════════════════════════════════

async function firecrawlSearch(
  settings: WebSearchSettings,
  query: string,
  maxResults: number = 5,
): Promise<string> {
  const checkedQuery = normalizeToolQuery(query);
  if (!checkedQuery.ok) {
    return JSON.stringify({ ok: false, error: checkedQuery.error });
  }
  const size = clampInt(maxResults, 5, 1, WEB_SEARCH_MAX_RESULTS);
  try {
    const res = await fetchWithTimeout(`${FIRECRAWL_API_URL}/v2/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.firecrawlApiKey}`,
      },
      body: JSON.stringify({
        query: checkedQuery.query,
        limit: size,
        scrapeOptions: { formats: ["markdown"] },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return JSON.stringify({
        ok: false,
        error: formatHttpError("Firecrawl search failed", res.status, text),
      });
    }

    const data = await res.json();
    const limited = limitArray(data.data ?? [], size);
    return JSON.stringify({
      ok: true,
      answer: null,
      results: limited.items.map((r: any) => {
        const content = truncateText(
          r.markdown || r.content || "",
          SEARCH_SNIPPET_MAX_CHARS,
        );
        return {
          title: r.title || r.url,
          url: r.url,
          content: content.text,
          contentTruncated: content.truncated,
        };
      }),
      meta: {
        engine: "firecrawl",
        maxResults: size,
        truncatedResults: limited.truncated,
      },
    });
  } catch (err) {
    return JSON.stringify({ ok: false, error: safeErrorMessage(err) });
  }
}

async function firecrawlScrape(
  settings: WebSearchSettings,
  urls: string[],
): Promise<string> {
  const checkedUrls = normalizeHttpUrlList(urls, WEB_READER_MAX_URLS);
  if (!checkedUrls.ok) {
    return JSON.stringify({ ok: false, error: checkedUrls.error });
  }
  try {
    const res = await fetchWithTimeout(`${FIRECRAWL_API_URL}/v2/batch/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.firecrawlApiKey}`,
      },
      body: JSON.stringify({
        urls: checkedUrls.urls,
        formats: ["markdown"],
      }),
    });

    if (!res.ok) {
      throw new Error(
        formatHttpError("Firecrawl failed", res.status, await res.text()),
      );
    }

    const data = await res.json();
    return JSON.stringify({
      ok: true,
      pages: (data.data ?? []).map((r: any) => ({
        url: r.metadata?.sourceURL || r.url,
        ok: r.success ?? true,
        ...formatPageContent(r.markdown || r.content),
      })),
      meta: {
        engine: "firecrawl",
        urlLimit: WEB_READER_MAX_URLS,
        truncatedUrls: checkedUrls.truncated,
      },
    });
  } catch (err: any) {
    console.warn("Firecrawl scrape failed, falling back to Jina:", err?.message);
    return jinaFallback(urls);
  }
}

// ═══════════════════════════════ 工具处理器 ═══════════════════════════════════

export function createSearchToolHandler(
  settings: WebSearchSettings,
): (name: string, args: unknown) => Promise<string> {
  return async (name: string, args: unknown): Promise<string> => {
    const a = args as Record<string, any>;
    const engine = settings.engine;
    const query =
      name === "web_search" ? normalizeToolQuery(a?.query) : undefined;
    if (query && !query.ok) {
      return JSON.stringify({ ok: false, error: query.error });
    }
    const readerUrls =
      name === "web_reader"
        ? normalizeHttpUrlList(a?.urls, WEB_READER_MAX_URLS)
        : undefined;
    if (readerUrls && !readerUrls.ok) {
      return JSON.stringify({ ok: false, error: readerUrls.error });
    }

    if (engine === "tavily") {
      switch (name) {
        case "web_search":
          return tavilySearch(settings, query!.query, a.max_results);
        case "web_reader":
          return tavilyExtract(settings, readerUrls!.urls);
      }
    } else if (engine === "firecrawl") {
      switch (name) {
        case "web_search":
          return firecrawlSearch(settings, query!.query, a.max_results);
        case "web_reader":
          return firecrawlScrape(settings, readerUrls!.urls);
      }
    }

    return `Error: unknown tool "${name}" or engine "${engine}"`;
  };
}

// ═══════════════════════════════ Jina Reader ═══════════════════════════════════

/**
 * Create a handler that only supports web_reader via Jina Reader.
 * Used when engine is "builtin" (model handles search natively, but page reading still uses Jina).
 */
export function createJinaReaderHandler(): (
  name: string,
  args: unknown,
) => Promise<string> {
  return async (name: string, args: unknown): Promise<string> => {
    if (name === "web_reader") {
      const a = args as { urls: string[] };
      const readerUrls = normalizeHttpUrlList(a?.urls, WEB_READER_MAX_URLS);
      if (!readerUrls.ok) {
        return JSON.stringify({ ok: false, error: readerUrls.error });
      }
      return jinaFallback(readerUrls.urls);
    }
    return `Error: unknown tool "${name}"`;
  };
}

function formatPageContent(content: unknown): {
  content: string;
  contentTruncated: boolean;
  originalLength: number;
} {
  const truncated = truncateText(content, WEB_PAGE_MAX_CHARS);
  return {
    content: truncated.text,
    contentTruncated: truncated.truncated,
    originalLength: truncated.originalLength,
  };
}
