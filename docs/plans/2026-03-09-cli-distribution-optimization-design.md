# CLI 分发与启动流程优化设计

## 目标

1. 优化 agent-inbox CLI 的交互体验，使用 `@clack/prompts` 替换原生 readline
2. 重新设计启动流程：已配置平台列表 + 新增入口，单平台全局单例限制
3. 建立 GitHub Actions CI/CD，合入 main 时上传 artifact，打 tag 时创建 Release
4. 提供 SEA 可执行文件（主要）+ JS bundle（备用）两种分发形式

## CLI 启动流程

### 交互体验

使用 `@clack/prompts` 提供类似 `create-astro` 风格的美观 CLI：

```
┌  Agent Inbox
│
◇  Select a platform to start
│  ● Discord - My Discord Bot
│  ○ Feishu - 飞书应用
│  ○ Configure a new platform...
│
◇  Starting Discord...
│
●  Discord runtime is running
└
```

### 流程逻辑

```
启动 → 加载 config.jsonl
  ├─ 有已配置平台 → 展示列表
  │    ├─ 未全部配置 → 列表末尾追加"配置新平台"选项
  │    ├─ 选中已配置平台 → PID 锁检查
  │    │    ├─ 已在运行 → 提示已有实例运行，退出
  │    │    └─ 未运行 → 写 PID 文件 → 启动运行时
  │    └─ 选中"配置新平台" → 进入配置流程（仅展示未配置平台）
  │         └─ 配置完成 → 回到平台选择
  └─ 无已配置平台 → 直接进入配置流程
         └─ 配置完成 → 回到平台选择
```

### 配置新平台

- 仅展示尚未配置的平台选项
- 全部平台都已配置时，主菜单不再出现"配置新平台"入口
- 使用 `@clack/prompts` 的 text/password/select 组件做分组输入

## PID 单例机制

- PID 文件路径：`~/.agent-inbox/pids/{platform}.pid`
- 启动前检查 PID 文件是否存在 + 进程是否存活（`process.kill(pid, 0)`）
- 启动时写入当前进程 PID
- 正常退出或 SIGINT/SIGTERM 时清理 PID 文件
- 进程已死但 PID 文件残留 → 自动清理并允许启动

## GitHub Actions CI/CD

### 工作流文件

`.github/workflows/release.yml`

### 触发条件

- `push` to `main` → 构建 + 上传 Artifact
- `push` tags `v*.*.*` → 构建 + 创建 GitHub Release

### 构建矩阵

| 平台 | 架构 | runner |
|------|------|--------|
| macOS | x64 | `macos-13` |
| macOS | ARM64 | `macos-14` |
| Linux | x64 | `ubuntu-latest` |
| Linux | ARM64 | `ubuntu-24.04-arm` |

### 产物

SEA 可执行文件（主要分发形式）：
- `agent-inbox-darwin-x64`
- `agent-inbox-darwin-arm64`
- `agent-inbox-linux-x64`
- `agent-inbox-linux-arm64`

JS bundle（备用）：
- `agent-inbox-bundle.tar.gz`

### 工作流步骤

1. checkout 代码
2. 安装 pnpm + Node.js 20
3. pnpm install
4. pnpm -r build（构建所有包）
5. 运行 build-executable.mjs（SEA 打包）
6. 上传 artifact（每个矩阵任务）
7. [仅 tag 触发] 汇总所有 artifact → 创建 GitHub Release

## 代码变更范围

| 文件 | 变更 |
|------|------|
| `apps/agent-inbox/src/prompts.ts` | **删除**，由 `@clack/prompts` 替代 |
| `apps/agent-inbox/src/cli.ts` | **重写**，新的启动流程逻辑 |
| `apps/agent-inbox/src/setup.ts` | **重写**，用 clack 组件做配置向导 |
| `apps/agent-inbox/src/pid-lock.ts` | **新增**，PID 文件锁模块 |
| `apps/agent-inbox/package.json` | 新增 `@clack/prompts`、`picocolors` 依赖 |
| `.github/workflows/release.yml` | **新增**，CI/CD 工作流 |
| `packages/core/src/paths.ts` | 新增 `pidsDir` 路径 |

## 依赖新增

- `@clack/prompts` — 美观的 CLI 交互组件
- `picocolors` — 轻量终端颜色库
