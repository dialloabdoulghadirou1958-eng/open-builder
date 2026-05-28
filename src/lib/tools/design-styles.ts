import { tool } from "ai";
import { z } from "zod";
import type { ProjectFiles, FileChange } from "../ai/generator-types";

const RAW_BASE =
  "https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md";

// Brand design-system slugs available in VoltAgent/awesome-design-md
// (each lives at design-md/<slug>/DESIGN.md). Single source of truth —
// keep in sync with the upstream repo directory.
export const DESIGN_STYLE_SLUGS = [
  "airbnb", "airtable", "apple", "binance", "bmw", "bmw-m", "bugatti", "cal",
  "claude", "clay", "clickhouse", "cohere", "coinbase", "composio", "cursor",
  "elevenlabs", "expo", "ferrari", "figma", "framer", "hashicorp", "ibm",
  "intercom", "kraken", "lamborghini", "linear.app", "lovable", "mastercard",
  "meta", "minimax", "mintlify", "miro", "mistral.ai", "mongodb", "nike",
  "notion", "nvidia", "ollama", "opencode.ai", "pinterest", "playstation",
  "posthog", "raycast", "renault", "replicate", "resend", "revolut", "runwayml",
  "sanity", "sentry", "shopify", "slack", "spacex", "spotify", "starbucks",
  "stripe", "supabase", "superhuman", "tesla", "theverge", "together.ai",
  "uber", "vercel", "vodafone", "voltagent", "warp", "webflow", "wired", "wise",
  "x.ai", "zapier",
] as const;

export const APPLY_DESIGN_STYLE_TOOL = {
  apply_design_style: tool({
    description:
      "Adopt a well-known brand's design language for the project. " +
      "Call this BEFORE writing UI code when the user asks for a specific brand's look " +
      "(e.g. 'a Stripe-style landing page') or wants a polished, brand-grade visual identity " +
      "and no design spec exists yet. It fetches that brand's design-system analysis " +
      "(colors, typography, spacing, components, do's & don'ts) from the awesome-design-md " +
      "collection, writes it to the project root as DESIGN.md (a binding design spec that governs " +
      "all subsequent generation), and returns the full spec so you can follow it immediately this turn. " +
      "Typically set one active design style per project. " +
      "The full set of ~70 supported brands is enumerated in the 'style' parameter.",
    inputSchema: z.object({
      style: z
        .enum(DESIGN_STYLE_SLUGS)
        .describe(
          "Brand design language to adopt, by slug. " +
            "Examples: stripe, apple, linear.app, vercel, notion, tesla, figma, spotify.",
        ),
    }),
  }),
};

export interface ApplyDesignStyleDeps {
  getFiles: () => ProjectFiles;
  onFilesChanged: (newFiles: ProjectFiles, changes: FileChange[]) => void;
}

interface ApplyDesignStyleArgs {
  style: string;
}

/** Find an existing root-level design.md (case-insensitive) or default to DESIGN.md. */
function findRootDesignPath(files: ProjectFiles): string {
  const existing = Object.keys(files).find(
    (p) => !p.includes("/") && p.toLowerCase() === "design.md",
  );
  return existing ?? "DESIGN.md";
}

export function createApplyDesignStyleHandler(deps: ApplyDesignStyleDeps) {
  return async (_name: string, args: unknown): Promise<string> => {
    const parsed = args as ApplyDesignStyleArgs;
    const requested =
      typeof parsed?.style === "string" ? parsed.style.trim().toLowerCase() : "";
    const slug = (DESIGN_STYLE_SLUGS as readonly string[]).includes(requested)
      ? requested
      : "";
    if (!slug) {
      return JSON.stringify({
        ok: false,
        error: `unknown design style "${parsed?.style ?? ""}"`,
        available: DESIGN_STYLE_SLUGS,
      });
    }

    const url = `${RAW_BASE}/${slug}/DESIGN.md`;
    let spec: string;
    try {
      const res = await fetch(url, { headers: { Accept: "text/plain" } });
      if (!res.ok) {
        return JSON.stringify({ ok: false, error: `HTTP ${res.status} fetching ${url}` });
      }
      spec = await res.text();
    } catch (err: any) {
      return JSON.stringify({
        ok: false,
        error: `fetch failed for ${url}: ${err?.message ?? "unknown error"}`,
      });
    }

    if (!spec || !spec.trim()) {
      return JSON.stringify({ ok: false, error: `empty design spec at ${url}` });
    }

    const content = `<!-- Design system sourced from VoltAgent/awesome-design-md: ${url} -->\n\n${spec}`;

    const files = deps.getFiles();
    const path = findRootDesignPath(files);
    const action: FileChange["action"] = path in files ? "modified" : "created";
    const newFiles: ProjectFiles = { ...files, [path]: content };
    deps.onFilesChanged(newFiles, [{ path, action }]);

    return JSON.stringify({
      ok: true,
      style: slug,
      path,
      persisted: true,
      note:
        `Wrote the "${slug}" design system to ${path} as a binding project guideline; ` +
        `it now governs all subsequent UI generation. Follow the colors, typography, spacing, ` +
        `border-radius and component rules in the spec below for every component you build this turn.`,
      spec: content,
    });
  };
}
