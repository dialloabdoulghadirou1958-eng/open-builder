<div align="center">

# Open Builder

**基于 AI 的 Web 应用生成器 —— 用自然语言描述，即刻生成可运行的完整项目**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8.x-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.x-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-FFC131?logo=tauri&logoColor=white)](https://tauri.app)

[部署指南](#部署) · [快速开始](#快速开始) · [功能特性](#功能特性) · [技术架构](#技术架构) · [项目审计](docs/PROJECT_AUDIT.zh-CN.md) · [贡献指南](CONTRIBUTING.md)

[English](README.md) | 简体中文

</div>

---

## 简介

Open Builder 是一个完全运行在浏览器中的 AI 驱动 Web 应用生成器。你只需用自然语言描述想要构建的应用，AI 就会通过工具调用（Tool Call）循环，在内存文件系统中自动创建、修改、删除文件，并通过 [Sandpack](https://sandpack.codesandbox.io/) 实时预览运行结果。

整个过程无需后端服务器，所有计算均可在浏览器端完成。模型服务配置和 API Key 会保存在浏览器本地存储中，API Key 仅发送给你配置的服务商。

同时支持通过 [Tauri](https://tauri.app) 构建为桌面应用（macOS / Windows / Linux）和移动应用（iOS / Android），享受原生应用体验。

> 兼容任何多种主流模型的 API 服务，比如 OpenAI、Anthropic、Google、Ollama 等服务。

---

## 演示

![screenshot](/public/images/screenshot.jpg)

[演示网站](https://builder.u14.app)

---

## 功能特性

### 核心能力

- **自然语言生成代码** — 描述你的想法，AI 自动规划并生成完整项目结构
- **实时预览** — 基于 Sandpack 的浏览器内沙箱，代码变更即时渲染
- **多框架支持** — 支持 React、Vue、Svelte、Angular、SolidJS、Astro 等 20+ 模板
- **智能文件操作** — AI 通过 `patch_file` 精确修改文件，避免不必要的全量重写
- **依赖管理** — AI 可自动修改 `package.json` 并触发依赖重装
- **项目快照** — 支持查看快照历史、命名快照、查看变更、导出 patch 并回滚到历史版本
- **项目健康检查** — 支持 `/health` 和自动 QA，检查结构、依赖、运行日志、可访问性和响应式风险
- **上下文压缩** — 自动压缩长对话上下文，有效降低 Token 消耗
- **Plan Mode** — 支持先探索代码并提交方案，用户批准后再写入文件
- **子代理协作** — 内置代码浏览、代码审查、依赖建议、Bug 调查、UI 审查等只读子代理
- **内置搜索** — 支持启用模型内置的搜索服务
- **CORS 解决方案** — 客户端版本支持 API 反向代理转发，有效解决跨域问题

### 交互体验

- **多会话管理** — 会话列表侧边栏支持创建、切换、删除，历史记录持久化保存
- **会话整理** — 支持会话搜索、置顶、归档、复制与智能重命名
- **项目模板** — 可将生成项目保存为本地模板，并从模板快速新建会话
- **智能会话命名** — 根据对话内容自动生成会话标题，无需手动命名
- **Slash 指令** — 输入框支持 `/compact`、`/review` 等斜杠快捷命令
- **图片与文件输入** — 支持上传截图、设计稿或文件作为上下文输入
- **技能系统** — 支持导入、启用、搜索、筛选和检查本地技能，可查看来源、权限、脚本和风险摘要
- **本地设置** — 服务商配置和 API Key 会持久化到浏览器本地存储
- **存储治理** — 可查看本地数据占用，并安全清理归档会话、空会话和旧快照
- **流式输出** — 实时展示 AI 思考过程和代码生成进度
- **扩展思考** — 支持 Extended Thinking / Reasoning 模式（DeepSeek-R1、Claude 4.6 等）
- **一键下载** — 将生成的项目打包为 ZIP 文件下载到本地
- **灵活布局** — 支持手动拖拽调整对话区域和编辑器区域宽度
- **多语言与主题** — 支持多种界面语言和外观主题切换
- **移动端适配** — 响应式布局，移动端可内嵌预览生成的应用

### 联网搜索（可选）

- 集成 [Tavily](https://tavily.com)、[Firecrawl](https://www.firecrawl.dev) API，AI 可实时搜索网页获取最新信息
- 支持网页内容读取，自动降级到 [Jina Reader](https://jina.ai/reader/) 作为备用方案

---

## 快速开始

### 前置要求

- Node.js 24 LTS
- pnpm 11
- 任意 OpenAI 兼容 API 的 Key

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
pnpm tauri:ios:dev
pnpm tauri:ios:build

# Android 开发/构建
pnpm tauri:android:dev
pnpm tauri:android:build
```

### 配置说明

点击界面右上角的设置按钮，填写以下信息：

| 配置项         | 说明                  | 示例                                         |
| -------------- | --------------------- | -------------------------------------------- |
| API Key        | 你的 AI 服务 API 密钥 | `sk-...`                                     |
| API URL        | OpenAI 兼容的接口地址 | `https://api.openai.com/v1/chat/completions` |
| 模型名称       | 使用的模型 ID         | `gpt-5.3-codex`、`deepseek-chat`             |
| Tavily API Key | （可选）联网搜索功能  | `tvly-...`                                   |

> 设置和 API Key 都保存在浏览器本地存储中。请将当前浏览器配置文件和设备视为凭据安全边界的一部分。

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

| 工具                     | 描述                                        |
| ------------------------ | ------------------------------------------- |
| `init_project`           | 初始化 Sandpack 项目模板                    |
| `manage_dependencies`    | 修改 package.json 管理依赖                  |
| `list_files`             | 列出所有项目文件                            |
| `read_files`             | 批量读取文件内容                            |
| `write_file`             | 创建或覆写文件                              |
| `patch_file`             | 精确搜索替换补丁（推荐用于小改动）          |
| `delete_file`            | 删除文件                                    |
| `rename_file` / `move_file` | 重命名或移动文件，并自动更新相对路径引用 |
| `search_in_files`        | 全局搜索文件内容                            |
| `get_console_logs`       | 读取 Sandpack 预览控制台输出               |
| `compact_context`        | 压缩长对话上下文                            |
| `ask_user_question`      | 在关键需求不明确时向用户提问                |
| `exit_plan_mode`         | 提交实施方案并等待用户批准                  |
| `dispatch_subagent`      | 调用只读子代理进行探索、审查或诊断          |
| `project_health_check`   | 检查项目结构、依赖文件、环境变量、控制台日志、可访问性和响应式风险 |
| `web_search`             | 联网搜索（支持模型内置、Tavily、Firecrawl） |
| `web_reader`             | 读取网页内容                                |
| `image_search`           | 图片搜索（支持 Pixabay、Unsplash）          |
| `search_npm_packages`    | NPM 包搜索                                  |
| `get_npm_package_detail` | 获取 NPM 包的详细信息                       |
| `list_skills` / `read_skill` / `execute_skill_script` | 管理与使用本地技能 |
| `read_env_schema` / `manage_env` | 安全读取与管理环境变量文件           |

### 技术栈

| 类别          | 技术                              |
| ------------- | --------------------------------- |
| 框架          | React 19 + TypeScript 7           |
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

## 支持的模型

Open Builder 兼容主流大模型的 API 格式：

| 服务商    | 推荐模型                             | API URL                                                              |
| --------- | ------------------------------------ | -------------------------------------------------------------------- |
| OpenAI    | `gpt-5.3-codex`、`gpt-5.2`           | `https://api.openai.com/v1/responses`                                |
| Anthropic | `claude-4.6-sonnet`、`claude-opus-4` | `https://api.anthropic.com/v1/messages`                              |
| Google    | `gemini-2.0-flash-exp`               | `https://generativelanguage.googleapis.com/v1beta/models`            |
| DeepSeek  | `deepseek-chat`、`deepseek-reasoner` | `https://api.deepseek.com/v1/chat/completions`                       |
| 通义千问  | `qwen-3.5`、`qwen3-coder-plus`       | `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` |
| 月之暗面  | `kimi-k2.5`                          | `https://api.moonshot.cn/v1/chat/completions`                        |
| 智谱 AI   | `glm-5`                              | `https://open.bigmodel.cn/api/paas/v4/chat/completions`              |
| Ollama    | `gpt-oss:120b`、`qwen3:8b`           | `http://localhost:11434/v1/chat/completions`                         |

> 推荐使用支持 Function Calling 的强力模型以获得最佳效果。

---

## 部署

### 构建生产版本

```bash
pnpm build
# 产物输出到 dist/ 目录
```

### 部署到 GitHub Pages

本项目配置了 GitHub Actions，推送版本 tag 即可自动构建并部署：

```bash
git tag v1.0.0
git push origin v1.0.0
```

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
