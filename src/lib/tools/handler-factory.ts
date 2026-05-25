import type { ToolSet } from "ai";
import {
  SEARCH_TOOLS,
  WEB_READER_TOOL,
  createSearchToolHandler,
  createJinaReaderHandler,
} from "./search";
import {
  ASSET_SEARCH_TOOLS,
  createAssetSearchToolHandler,
} from "./asset-search";
import {
  NPM_SEARCH_TOOLS,
  createNpmSearchToolHandler,
} from "./npm-search";
import {
  MEMORY_TOOLS,
  MEMORY_TOOL_NAME,
  createMemoryToolHandler,
  type MemoryDeps,
} from "./memory";
import { DISPATCH_SUBAGENT_TOOL } from "./subagent-tool";
import { SKILL_TOOLS, SKILL_TOOL_NAME_SET } from "../skills/tools";
import { createSkillToolHandler } from "../skills/tool-handler";
import { getSkillRegistry } from "../skills/instance";
import { scriptExecutor } from "../skills/script-executor";
import { isSkillsAvailable } from "../skills/fs";
import { skillActiveContext } from "../skills/active-context";
import { getBuiltinSearchConfig } from "../ai/provider";
import type { ApiType } from "../ai/provider";
import type {
  WebSearchSettings,
  AssetSearchSettings,
} from "../../types";

interface ConsoleLog {
  method: string;
  data: any[];
}

export interface ToolFeatures {
  auth: boolean;
  builtinSearch: boolean;
  webSearch: boolean;
  assetSearch: boolean;
}

export interface BuildToolHandlersArgs {
  features: ToolFeatures;
  effectiveWebSearchSettings: WebSearchSettings;
  effectiveAssetSearchSettings: AssetSearchSettings;
  apiConfig: {
    apiType: ApiType;
    apiBaseUrl: string;
    apiKey: string;
    model: string;
  };
  getConsoleLogs: () => ConsoleLog[];
  memoryDeps: MemoryDeps;
}

export interface BuiltToolHandlers {
  customToolSet: ToolSet;
  combinedToolHandler: (name: string, args: unknown) => Promise<string>;
  providerToolNames: string[];
}

export function buildToolHandlers(
  args: BuildToolHandlersArgs,
): BuiltToolHandlers {
  const {
    features,
    effectiveWebSearchSettings,
    effectiveAssetSearchSettings,
    apiConfig,
    getConsoleLogs,
    memoryDeps,
  } = args;

  let builtinSearchTools: Record<string, unknown> = {};
  let providerToolNames: string[] = [];
  if (features.builtinSearch) {
    const builtinConfig = getBuiltinSearchConfig(apiConfig);
    if (builtinConfig) {
      builtinSearchTools = builtinConfig.tools || {};
      providerToolNames = builtinConfig.providerToolNames;
    }
  }

  const searchHandler = features.webSearch
    ? createSearchToolHandler(effectiveWebSearchSettings)
    : undefined;
  const jinaReaderHandler =
    features.builtinSearch || features.auth
      ? createJinaReaderHandler()
      : undefined;
  const assetSearchHandler = features.assetSearch
    ? createAssetSearchToolHandler(effectiveAssetSearchSettings)
    : undefined;
  const memoryHandler = createMemoryToolHandler(memoryDeps);
  const npmSearchHandler = createNpmSearchToolHandler();
  const skillsAvailable = isSkillsAvailable();
  const skillToolHandler = skillsAvailable
    ? createSkillToolHandler({
        getRegistry: () => getSkillRegistry(),
        getExecutor: async () => scriptExecutor,
        onActivate: (skill) => {
          if (!skill.allowedTools || skill.allowedTools.length === 0) return;
          skillActiveContext.activate({
            skillId: skill.id,
            skillName: skill.name,
            allowedTools: skill.allowedTools,
            activatedAt: Date.now(),
          });
        },
      })
    : null;
  const combinedToolHandler = async (
    name: string,
    handlerArgs: unknown,
  ): Promise<string> => {
    if (name === "get_console_logs") {
      const consoleLogs = getConsoleLogs();
      if (consoleLogs.length === 0) return "No console output yet.";
      return consoleLogs
        .map((log) => {
          const data = log.data
            .map((d) => (typeof d === "string" ? d : JSON.stringify(d)))
            .join(" ");
          return `[${log.method.toUpperCase()}] ${data}`;
        })
        .join("\n");
    }
    if (name === MEMORY_TOOL_NAME) {
      return memoryHandler(name, handlerArgs);
    }
    if (skillToolHandler && SKILL_TOOL_NAME_SET.has(name)) {
      return skillToolHandler(name, handlerArgs);
    }
    if (name === "search_npm_packages" || name === "get_npm_package_detail") {
      return npmSearchHandler(name, handlerArgs);
    }
    if (name === "image_search" && assetSearchHandler) {
      return assetSearchHandler(name, handlerArgs);
    }
    if (name === "web_reader" && jinaReaderHandler) {
      return jinaReaderHandler(name, handlerArgs);
    }
    if (searchHandler) return searchHandler(name, handlerArgs);
    return `Error: unknown tool "${name}"`;
  };

  const customToolSet: ToolSet = {
    ...(features.webSearch ? SEARCH_TOOLS : {}),
    ...builtinSearchTools,
    ...(features.builtinSearch || features.auth ? WEB_READER_TOOL : {}),
    ...(features.assetSearch ? ASSET_SEARCH_TOOLS : {}),
    ...NPM_SEARCH_TOOLS,
    ...MEMORY_TOOLS,
    ...DISPATCH_SUBAGENT_TOOL,
    ...(skillsAvailable ? SKILL_TOOLS : {}),
  };

  return { customToolSet, combinedToolHandler, providerToolNames };
}
