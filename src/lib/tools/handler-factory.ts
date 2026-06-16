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
import { useSecurityAuditStore } from "../../store/security-audit";
import {
  INSTALL_COMPONENT_TOOL,
  createInstallComponentHandler,
} from "./install-component";
import {
  SCREENSHOT_TO_CODE_TOOL,
  createScreenshotToCodeHandler,
} from "./screenshot-to-code";
import {
  APPLY_DESIGN_STYLE_TOOL,
  createApplyDesignStyleHandler,
} from "./design-styles";
import {
  PROJECT_HEALTH_CHECK_TOOL,
  createProjectHealthCheckHandler,
} from "./project-health";
import { getBuiltinSearchConfig } from "../ai/provider";
import type { ApiType } from "../ai/provider";
import type {
  WebSearchSettings,
  AssetSearchSettings,
  ProjectFiles,
} from "../../types";
import type { FileChange } from "../ai/generator-types";

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

/** Read/write bridge for tools that fetch or mutate project files asynchronously
 *  (install_component, screenshot_to_code). When absent these tools are not
 *  registered, so the model never sees a tool it cannot actually run. */
export interface ProjectFilesBridge {
  getFiles: () => ProjectFiles;
  onFilesChanged: (newFiles: ProjectFiles, changes: FileChange[]) => void;
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
  filesBridge?: ProjectFilesBridge;
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
    filesBridge,
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
  const installComponentHandler = filesBridge
    ? createInstallComponentHandler(filesBridge)
    : null;
  const screenshotToCodeHandler = filesBridge
    ? createScreenshotToCodeHandler({ apiConfig, ...filesBridge })
    : null;
  const applyDesignStyleHandler = filesBridge
    ? createApplyDesignStyleHandler(filesBridge)
    : null;
  const projectHealthCheckHandler = filesBridge
    ? createProjectHealthCheckHandler({
        getFiles: filesBridge.getFiles,
        getConsoleLogs,
      })
    : null;
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
        onScriptExecuted: ({
          skill,
          scriptPath,
          args,
          startedAt,
          finishedAt,
          result,
        }) => {
          useSecurityAuditStore.getState().recordSkillScriptExecution({
            skillId: skill.id,
            skillName: skill.name,
            scriptPath,
            args,
            startedAt,
            finishedAt,
            exitCode: result?.exitCode ?? null,
            status: result && result.exitCode === 0 ? "success" : "failed",
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
    if (name === "install_component" && installComponentHandler) {
      return installComponentHandler(name, handlerArgs);
    }
    if (name === "screenshot_to_code" && screenshotToCodeHandler) {
      return screenshotToCodeHandler(name, handlerArgs);
    }
    if (name === "apply_design_style" && applyDesignStyleHandler) {
      return applyDesignStyleHandler(name, handlerArgs);
    }
    if (name === "project_health_check" && projectHealthCheckHandler) {
      return projectHealthCheckHandler(name, handlerArgs);
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
    ...(filesBridge
      ? {
          ...INSTALL_COMPONENT_TOOL,
          ...SCREENSHOT_TO_CODE_TOOL,
          ...APPLY_DESIGN_STYLE_TOOL,
          ...PROJECT_HEALTH_CHECK_TOOL,
        }
      : {}),
    ...(skillsAvailable ? SKILL_TOOLS : {}),
  };

  return { customToolSet, combinedToolHandler, providerToolNames };
}
