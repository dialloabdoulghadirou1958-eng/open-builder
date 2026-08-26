<div align="center">

# Open Builder

**基于 AI 的 Web 应用生成器 —— 用自然语言描述，即刻生成可运行的完整项目**

[![License](https://img.shields.io/badge/license-GPLv3-blue.svg)](LICENSE)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8.x-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.x-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-FFC131?logo=tauri&logoColor=white)](https://tauri.app)

[部署指南](#部署) · [快速开始](#快速开始) · [功能特性](#功能特性) · [技术架构](#技术架构) · [更新日志](CHANGELOG.md) · [项目审计](docs/PROJECT_AUDIT.zh-CN.md) · [贡献指南](CONTRIBUTING.md)

[English](README.md) | 简体中文

</div>

---

## 简介

Open Builder 是一个桌面优先、同时提供浏览器界面的 AI Web 应用生成器。你只需用自然语言描述想要构建的应用，AI 就会通过工具调用（Tool Call）循环，在内存文件系统中自动创建、修改、删除文件，并通过 [Sandpack](https://sandpack.codesandbox.io/) 实时预览运行结果。

Open Builder 本身不依赖托管的应用后端。Web 端会直接连接你配置的模型服务和已批准的远程工具；服务商配置与 API Key 保存在浏览器本地存储中，并且只在相应已配置服务需要时发送。

Tauri 桌面版（macOS / Windows / Linux）提供 stdio MCP 等本机运行能力；Web 与实验性移动版明确不提供本机进程和 Skill 脚本执行。

> 内置 OpenAI Responses、Anthropic、Google 原生适配器，同时支持 Ollama 等 OpenAI 兼容接口。

---

## 演示

![screenshot](public/images/screenshot.jpg)

[演示网站](https://builder.u14.app)

---

## 功能特性

### 核心能力

- **自然语言生成代码** — 描述你的想法，AI 自动规划并生成完整项目结构
- **实时预览** — 基于 Sandpack 的浏览器内沙箱，代码变更即时渲染
- **多框架支持** — 支持 React、Vue、Svelte、Angular、SolidJS、Astro 等 20+ 模板
- **智能文件操作** — AI 通过 `patch_file` 精确修改文件，避免不必要的全量重写
- **依赖管理** — AI 可自动修改 `package.json` 并触发依赖重装
- **构建加速工具** — 通过专用工具安装 shadcn 组件、将截图转换为组件、应用设计规范，并管理类型安全的环境变量 schema
- **项目规范** — 可读取根目录的 `AGENTS.md`、`CLAUDE.md` 和 `DESIGN.md` 作为生成参考，同时将其视为不能覆盖工具与安全策略的不可信项目数据
- **项目快照** — 支持查看快照历史、命名快照、查看变更、导出 patch 并回滚到历史版本
- **项目健康检查** — `/health` 可检查结构、依赖、运行日志、可访问性与响应式风险；隔离的自动 QA 只执行受限项目检查，不访问 MCP 或预览控制台
- **上下文压缩** — 通过 `/compact` 或命令面板总结长对话，降低 Token 消耗
- **Plan Mode** — 支持先探索代码并提交方案，用户批准后再写入文件
- **子代理协作** — 内置代码浏览、代码审查、依赖建议、Bug 调查、UI 审查等只读子代理
- **内置搜索** — 支持启用模型内置的搜索服务
- **桌面 API 代理** — Tauri 可转发经允许的 HTTP/HTTPS 模型请求，处理浏览器 CORS 限制；静态 Web 部署仍依赖服务商允许跨域访问

### 交互体验

- **多会话管理** — 会话列表侧边栏支持创建、切换、删除，历史记录持久化保存
- **会话整理** — 支持会话搜索、置顶、归档、复制与智能重命名
- **项目模板** — 可将生成项目保存为本地模板，并从模板快速新建会话
- **智能会话命名** — 根据对话内容自动生成会话标题，无需手动命名
- **Slash 指令** — 输入框支持 `/new`、`/fork`、`/clear`、`/reset`、`/compact`、`/health`、`/review`、`/continue`、`/retry`
- **命令面板与快捷键** — 可通过 `Cmd/Ctrl+K` 打开命令面板，并使用键盘新建会话、打开设置、聚焦输入框或停止生成
- **图片与文件输入** — 支持上传截图、文本文件或 PDF；支持 PDF 的模型会收到原生 PDF 文件输入，本地不抽取 PDF 文本
- **技能系统** — 支持 metadata 匹配和手动指定；导入的 Skill 默认停用，桌面脚本还必须开启开发者开关并在每次调用时确认
- **本地设置** — 服务商配置和 API Key 会持久化到浏览器本地存储
- **存储治理** — 可查看本地数据占用，并安全清理归档会话、空会话和旧快照
- **流式输出** — 实时展示 AI 思考过程和代码生成进度
- **扩展思考** — 支持 Extended Thinking / Reasoning 模式（DeepSeek-R1、Claude 4.6 等）
- **一键下载** — 将生成的项目打包为 ZIP 文件下载到本地
- **工作区工具** — 支持代码/预览切换、文件搜索与管理、Sandpack 控制台，以及桌面/平板/手机预览宽度、自适应和缩放
- **自适应布局** — 桌面端使用横向可调分栏，平板端使用工作区在上、对话在下的纵向可调分栏，手机端使用对话优先并内嵌预览的布局
- **语言与主题** — 提供英文、简体中文界面，以及跟随系统、浅色和深色主题

### 指令与快捷键

| 指令        | 行为                               |
| ----------- | ---------------------------------- |
| `/new`      | 新建会话                           |
| `/fork`     | 复制当前会话与项目                 |
| `/clear`    | 清除对话上下文，但保留当前项目文件 |
| `/reset`    | 经确认后重置当前会话和项目         |
| `/compact`  | 压缩当前对话上下文                 |
| `/health`   | 执行项目健康检查                   |
| `/review`   | 让 AI 审查当前项目                 |
| `/continue` | 继续被中断或尚未完成的任务         |
| `/retry`    | 重试最近一次生成                   |

| 快捷键       | 操作                           |
| ------------ | ------------------------------ |
| `Cmd/Ctrl+K` | 打开或关闭命令面板             |
| `Cmd/Ctrl+N` | 新建会话                       |
| `Cmd/Ctrl+,` | 打开设置                       |
| `Cmd/Ctrl+/` | 聚焦对话输入框                 |
| `Esc`        | 优先关闭命令面板，否则停止生成 |

### MCP 与平台能力（可选）

- 可配置使用 Streamable HTTP 或 SSE 的远程 HTTPS MCP 服务，并支持静态 Header、OAuth 授权码与 OAuth 客户端凭据；桌面版还支持 stdio 服务。
- 支持从 JSON 导入服务定义、分别启停服务与工具，并在工具定义发生漂移后重新审查能力。
- Plan Mode 与子代理只能使用显式批准可在对应模式运行的只读 MCP 工具。

| 运行环境     | 远程 HTTPS MCP | stdio MCP | Skill 脚本                |
| ------------ | -------------- | --------- | ------------------------- |
| Web          | 支持           | 不支持    | 不支持                    |
| 桌面端       | 支持           | 支持      | 开发者开关 + 每次调用批准 |
| 实验性移动端 | 支持           | 不支持    | 不支持                    |

### 联网搜索（可选）

- 集成 [Tavily](https://tavily.com)、[Firecrawl](https://www.firecrawl.dev) API，AI 可实时搜索网页获取最新信息
- 支持网页内容读取，自动降级到 [Jina Reader](https://jina.ai/reader/) 作为备用方案

---

## 快速开始

### 前置要求

- Node.js 24 LTS
- pnpm 11
- 受支持的模型服务地址，以及该服务需要时使用的 API Key

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/Amery2010/open-builder.git
cd open-builder

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev
```

打开浏览器访问 `http://localhost:5173`，点击右上角设置图标配置你的 API Key 即可开始使用。

### 桌面/移动应用（Tauri）

需要额外安装 [Rust](https://www.rust-lang.org/tools/install) 和 Tauri 的[平台依赖](https://tauri.app/start/prerequisites/)。

```bash
# 桌面端开发
pnpm tauri:dev

# 桌面端构建
pnpm tauri:build

# iOS 开发/构建
pnpm tauri ios init # 仅首次初始化
pnpm tauri:ios:dev
pnpm tauri:ios:build

# Android 开发/构建
pnpm tauri android init # 仅首次初始化
pnpm tauri:android:dev
pnpm tauri:android:build
```

### 配置说明

点击界面右上角的设置按钮，填写以下信息：

| 配置项       | 说明                                      | 示例                                |
| ------------ | ----------------------------------------- | ----------------------------------- |
| API 类型     | 服务商协议适配器                          | OpenAI、Anthropic、Google、兼容接口 |
| API Key      | 服务商需要时使用的凭据                    | `sk-...`                            |
| API Base URL | 服务商域名或基础路径                      | `https://api.openai.com`            |
| 模型名称     | 模型 ID；受支持的服务商可动态读取模型列表 | `gpt-5.3-codex`、`deepseek-chat`    |
| 联网搜索     | 可选的 Tavily 或 Firecrawl 凭据           | `tvly-...`                          |
| 图片搜索     | 可选的 Pixabay 或 Unsplash 凭据           | 对应服务商 API Key                  |

> 设置和 API Key 都保存在浏览器本地存储中。请将当前浏览器配置文件和设备视为凭据安全边界的一部分。

MCP 服务与 Skills 可从对话工具栏管理；只有原生运行时报告具备对应能力时，界面才会显示桌面专属选项。

---

## 技术架构

### 核心引擎：WebAppGenerator

[src/lib/ai/generator.ts](src/lib/ai/generator.ts) 是整个项目的核心，实现了完整的 AI Tool Call 循环引擎：

```
用户消息 → AI 规划 → 工具调用 → 执行工具 → 返回结果 → AI 继续/结束
                                    ↓
                              内存文件系统
                                    ↓
                           Sandpack 实时预览
```

内置工具列表：

| 工具                             | 描述                                                               |
| -------------------------------- | ------------------------------------------------------------------ |
| `init_project`                   | 初始化 Sandpack 项目模板                                           |
| `manage_dependencies`            | 修改 package.json 管理依赖                                         |
| `list_files`                     | 列出所有项目文件                                                   |
| `read_files`                     | 批量读取文件内容                                                   |
| `write_file`                     | 创建或覆写文件                                                     |
| `patch_file`                     | 精确搜索替换补丁（推荐用于小改动）                                 |
| `delete_file`                    | 删除文件                                                           |
| `rename_file` / `move_file`      | 重命名或移动文件，并自动更新相对路径引用                           |
| `search_in_files`                | 全局搜索文件内容                                                   |
| `get_console_logs`               | 读取 Sandpack 预览控制台输出                                       |
| `compact_context`                | 压缩长对话上下文                                                   |
| `ask_user_question`              | 在关键需求不明确时向用户提问                                       |
| `exit_plan_mode`                 | 提交实施方案并等待用户批准                                         |
| `dispatch_subagent`              | 调用只读子代理进行探索、审查或诊断                                 |
| `project_health_check`           | 检查项目结构、依赖文件、环境变量、控制台日志、可访问性和响应式风险 |
| `web_search`                     | 联网搜索（支持模型内置、Tavily、Firecrawl）                        |
| `web_reader`                     | 读取网页内容                                                       |
| `image_search`                   | 图片搜索（支持 Pixabay、Unsplash）                                 |
| `search_npm_packages`            | NPM 包搜索                                                         |
| `get_npm_package_detail`         | 获取 NPM 包的详细信息                                              |
| `install_component`              | 安装经允许的 shadcn registry 组件及其依赖                          |
| `screenshot_to_code`             | 根据提供的 UI 图片生成并写入组件                                   |
| `apply_design_style`             | 为项目写入选定的设计规范                                           |
| `list_skills` / `read_skill`     | 发现并加载自动匹配或强制指定的技能                                 |
| `execute_skill_script`           | 仅在桌面端运行已激活技能的脚本                                     |
| `read_env_schema` / `manage_env` | 安全读取与管理环境变量文件                                         |

启用的 MCP 工具会在服务发现并获批后动态注入，并根据当前平台以及 Chat、Plan、自动 QA 或子代理运行策略进行过滤。

### 技术栈

| 类别          | 技术                              |
| ------------- | --------------------------------- |
| 框架          | React 19 + TypeScript 6           |
| 构建工具      | Vite 8                            |
| 样式          | Tailwind CSS v4                   |
| UI 组件       | shadcn/ui + Radix UI              |
| 代码沙箱      | Sandpack (CodeSandbox)            |
| 状态管理      | Zustand 5                         |
| 本地存储      | localforage                       |
| 图标          | Lucide React                      |
| Markdown 渲染 | react-markdown + rehype-highlight |
| 桌面/移动端   | Tauri 2                           |

---

## 支持的 API 协议

Open Builder 会根据 API 类型选择对应的 AI SDK 原生适配器，并可从受支持的服务端点动态读取模型列表。

| API 类型        | 协议/适配器             | 默认 Base URL                               | 典型用途              |
| --------------- | ----------------------- | ------------------------------------------- | --------------------- |
| OpenAI 兼容接口 | OpenAI 兼容 Chat API    | `http://localhost:11434`                    | Ollama 与其他兼容网关 |
| OpenAI          | Responses API           | `https://api.openai.com`                    | OpenAI                |
| Anthropic       | Messages API            | `https://api.anthropic.com`                 | Anthropic             |
| Google          | Generative Language API | `https://generativelanguage.googleapis.com` | Google Gemini         |

> 推荐使用支持 Function Calling 的强力模型以获得最佳效果。

---

## 部署

静态 Web 部署不包含 Tauri API 代理、stdio MCP 或 Skill 脚本执行能力。浏览器直接访问的模型和搜索服务必须通过 CORS 允许当前部署来源。

### 构建生产版本

```bash
pnpm build
# 产物输出到 dist/ 目录
```

### 部署到 GitHub Pages

GitHub Actions 会在 `main` 更新或手动触发时构建并部署 Pages。工作流会自动设置 Vite 仓库子路径，并包含静态 MCP OAuth 回调入口。`v*` tag 只会在全部质量门禁通过后创建一个桌面版 draft release，不会部署 Pages。

详见 [.github/workflows/deploy.yml](.github/workflows/deploy.yml)。

### 部署到 Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FAmery2010%2Fopen-builder)

或手动部署：导入 GitHub 仓库，框架预设选择 `Vite`，构建命令 `pnpm run build`，输出目录 `dist`，无需额外配置。

### 部署到 Cloudflare Worker

[![Deploy to Cloudflare Worker](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Amery2010/open-builder)

或手动部署：

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) → Workers & Pages → Create → Worker → Connect to Git
2. 选择 `open-builder` 仓库，构建配置如下：

| 配置项       | 值               |
| ------------ | ---------------- |
| 构建命令     | `pnpm run build` |
| 输出目录     | `dist`           |
| Node.js 版本 | `24`             |

### 部署到 Netlify

直接导入仓库，构建命令 `pnpm run build`，输出目录 `dist`，无需任何额外配置。

---

## 贡献

欢迎提交 Issue 和 Pull Request！请先阅读 [贡献指南](CONTRIBUTING.md)。

---

## 许可证

[GPLv3 License](LICENSE) © 2026 Open Builder Contributors
