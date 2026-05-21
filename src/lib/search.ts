import { tool } from "ai";
import { z } from "zod";
import { type WebSearchSettings, SERVER_ENGINE } from "../store/settings";
import { serverWebSearch } from "./mohua-api";
import { toolResult } from "./toolResult";

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
  const baseUrl = settings.tavilyApiUrl || "https://api.tavily.com";
  const res = await fetch(`${baseUrl}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: settings.tavilyApiKey,
      query,
      max_results: maxResults,
      include_answer: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    return JSON.stringify({
      ok: false,
      error: `Tavily search failed (${res.status}): ${text}`,
    });
  }
  const data = await res.json();
  return JSON.stringify({
    ok: true,
    answer: data.answer ?? null,
    results: (data.results ?? []).map((r: any) => ({
      title: r.title,
      url: r.url,
      content: r.content,
    })),
  });
}

async function tavilyExtract(
  settings: WebSearchSettings,
  urls: string[],
): Promise<string> {
  const baseUrl = settings.tavilyApiUrl || "https://api.tavily.com";
  try {
    const res = await fetch(`${baseUrl}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: settings.tavilyApiKey,
        urls,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `Tavily extract failed (${res.status}): ${await res.text()}`,
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
        content: r.raw_content,
      })),
    });
  } catch (err: any) {
    console.warn("Tavily extract failed, falling back to Jina:", err.message);
    return jinaFallback(urls);
  }
}

async function jinaFallback(urls: string[]): Promise<string> {
  const pages: {
    url: string;
    ok: boolean;
    content?: string;
    error?: string;
  }[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(`https://r.jina.ai/${url}`, {
        headers: { Accept: "text/plain" },
      });
      if (!res.ok) {
        pages.push({
          url,
          ok: false,
          error: `Jina fetch failed (${res.status})`,
        });
        continue;
      }
      pages.push({ url, ok: true, content: await res.text() });
    } catch (err: any) {
      pages.push({ url, ok: false, error: err.message });
    }
  }
  return JSON.stringify({ ok: pages.some((p) => p.ok), pages });
}

// ═══════════════════════════════ Firecrawl API ═══════════════════════════════════

async function firecrawlSearch(
  settings: WebSearchSettings,
  query: string,
  maxResults: number = 5,
): Promise<string> {
  const baseUrl = settings.firecrawlApiUrl || "https://api.firecrawl.dev";
  const res = await fetch(`${baseUrl}/v2/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.firecrawlApiKey}`,
    },
    body: JSON.stringify({
      query,
      limit: maxResults,
      scrapeOptions: { formats: ["markdown"] },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return JSON.stringify({
      ok: false,
      error: `Firecrawl search failed (${res.status}): ${text}`,
    });
  }

  const data = await res.json();
  return JSON.stringify({
    ok: true,
    answer: null,
    results: (data.data ?? []).map((r: any) => ({
      title: r.title || r.url,
      url: r.url,
      content: r.markdown || r.content || "",
    })),
  });
}

async function firecrawlScrape(
  settings: WebSearchSettings,
  urls: string[],
): Promise<string> {
  const baseUrl = settings.firecrawlApiUrl || "https://api.firecrawl.dev";
  const res = await fetch(`${baseUrl}/v2/batch/scrape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.firecrawlApiKey}`,
    },
    body: JSON.stringify({
      urls,
      formats: ["markdown"],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return JSON.stringify({
      ok: false,
      pages: urls.map((url) => ({
        url,
        ok: false,
        error: `Firecrawl failed (${res.status}): ${text}`,
      })),
    });
  }

  const data = await res.json();
  return JSON.stringify({
    ok: true,
    pages: (data.data ?? []).map((r: any) => ({
      url: r.metadata?.sourceURL || r.url,
      ok: r.success ?? true,
      content: r.markdown || r.content,
    })),
  });
}

// ═══════════════════════════════ 工具处理器 ═══════════════════════════════════

export function createSearchToolHandler(
  settings: WebSearchSettings,
): (name: string, args: unknown) => Promise<string> {
  return async (name: string, args: unknown): Promise<string> => {
    const a = args as Record<string, any>;
    const engine = settings.engine;

    if (engine === "tavily") {
      switch (name) {
        case "web_search":
          return tavilySearch(settings, a.query, a.max_results);
        case "web_reader":
          return tavilyExtract(settings, a.urls);
      }
    } else if (engine === "firecrawl") {
      switch (name) {
        case "web_search":
          return firecrawlSearch(settings, a.query, a.max_results);
        case "web_reader":
          return firecrawlScrape(settings, a.urls);
      }
    } else if (engine === SERVER_ENGINE) {
      switch (name) {
        case "web_search":
          return toolResult(
            serverWebSearch({
              query: a.query,
              providerId: settings.backendProvider,
              maxResults: a.max_results,
            }),
            (results) => ({ results }),
          );
        case "web_reader":
          // The server doesn't support batch web_reader yet, so fallback to Jina reader directly
          return jinaFallback(a.urls);
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
      return jinaFallback(a.urls);
    }
    return `Error: unknown tool "${name}"`;
  };
}
