# CLI 分发与启动流程优化 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 用 @clack/prompts 重写 agent-inbox CLI 启动流程，添加 PID 单例锁，并建立 GitHub Actions CI/CD 自动打包发布。

**Architecture:** 替换原有的 readline prompts 为 @clack/prompts；在 core paths 中新增 pidsDir；新建 pid-lock 模块实现文件锁单例；重写 cli.ts 和 setup.ts 适配新流程；新增 GitHub Actions 工作流实现多平台 SEA 构建。

**Tech Stack:** @clack/prompts, picocolors, Node.js SEA, GitHub Actions matrix build

---

### Task 1: 安装依赖

**Files:**
- Modify: `apps/agent-inbox/package.json`

**Step 1: 安装 @clack/prompts 和 picocolors**

Run:
```bash
cd /Users/doctorwu/Projects/Self/agent-im-relay && pnpm --filter agent-inbox add @clack/prompts picocolors
```

Expected: package.json dependencies 中出现 `@clack/prompts` 和 `picocolors`

**Step 2: 验证安装**

Run:
```bash
cd /Users/doctorwu/Projects/Self/agent-im-relay && pnpm --filter agent-inbox list @clack/prompts picocolors
```

Expected: 两个包都列出

**Step 3: Commit**

```bash
git add apps/agent-inbox/package.json pnpm-lock.yaml
git commit -m "chore: add @clack/prompts and picocolors dependencies"
```

---

### Task 2: 扩展 RelayPaths 添加 pidsDir

**Files:**
- Modify: `packages/core/src/paths.ts:5-12` (RelayPaths interface)
- Modify: `packages/core/src/paths.ts:45-56` (resolveRelayPaths function)

**Step 1: 修改 RelayPaths interface 添加 pidsDir**

在 `packages/core/src/paths.ts` 的 `RelayPaths` interface 中新增 `pidsDir`：

```typescript
export interface RelayPaths {
  homeDir: string;
  configFile: string;
  stateDir: string;
  stateFile: string;
  artifactsDir: string;
  logsDir: string;
  pidsDir: string;  // 新增
}
```

**Step 2: 在 resolveRelayPaths 中添加 pidsDir 赋值**

在 `resolveRelayPaths` 返回对象中添加：

```typescript
pidsDir: join(homeDir, 'pids'),
```

**Step 3: 构建 core 包验证**

Run:
```bash
cd /Users/doctorwu/Projects/Self/agent-im-relay && pnpm --filter @agent-im-relay/core build
```

Expected: 无报错

**Step 4: Commit**

```bash
git add packages/core/src/paths.ts
git commit -m "feat: add pidsDir to RelayPaths"
```

---

### Task 3: 创建 PID 文件锁模块

**Files:**
- Create: `apps/agent-inbox/src/pid-lock.ts`

**Step 1: 创建 pid-lock.ts**

```typescript
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function acquirePidLock(pidsDir: string, platform: string): Promise<boolean> {
  await mkdir(pidsDir, { recursive: true });
  const pidFile = join(pidsDir, `${platform}.pid`);

  try {
    const existingPid = Number.parseInt(await readFile(pidFile, 'utf-8'), 10);
    if (Number.isFinite(existingPid) && isProcessAlive(existingPid)) {
      return false;
    }
  } catch {
    // PID file doesn't exist or can't be read — fine, proceed
  }

  await writeFile(pidFile, String(process.pid), 'utf-8');
  return true;
}

export function registerPidCleanup(pidsDir: string, platform: string): void {
  const pidFile = join(pidsDir, `${platform}.pid`);

  const cleanup = () => {
    try {
      const { unlinkSync } = require('node:fs');
      unlinkSync(pidFile);
    } catch {
      // best-effort cleanup
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });
}

export async function releasePidLock(pidsDir: string, platform: string): Promise<void> {
  const pidFile = join(pidsDir, `${platform}.pid`);
  try {
    await unlink(pidFile);
  } catch {
    // already gone
  }
}
```

**Step 2: 验证 TypeScript 编译**

Run:
```bash
cd /Users/doctorwu/Projects/Self/agent-im-relay && npx tsc --noEmit -p apps/agent-inbox/tsconfig.json
```

Expected: 无报错（或仅有既有的非相关错误）

**Step 3: Commit**

```bash
git add apps/agent-inbox/src/pid-lock.ts
git commit -m "feat: add PID file lock module for singleton enforcement"
```

---

### Task 4: 用 @clack/prompts 重写 setup.ts

**Files:**
- Modify: `apps/agent-inbox/src/setup.ts` (完整重写)

**Step 1: 重写 setup.ts**

完整替换 `apps/agent-inbox/src/setup.ts`：

```typescript
import * as p from '@clack/prompts';
import type { RelayPaths } from '@agent-im-relay/core';
import type {
  AppConfigRecord,
  AvailableIm,
  DiscordImRecord,
  FeishuImRecord,
  LoadedAppConfig,
} from './config.js';
import { loadAppConfig, saveAppConfig, upsertRecord } from './config.js';

const ALL_PLATFORM_IDS = ['discord', 'feishu'] as const;
type PlatformId = typeof ALL_PLATFORM_IDS[number];

const PLATFORM_LABELS: Record<PlatformId, string> = {
  discord: 'Discord',
  feishu: 'Feishu (飞书)',
};

function getUnconfiguredPlatforms(availableIms: AvailableIm[]): PlatformId[] {
  const configured = new Set(availableIms.map(im => im.id));
  return ALL_PLATFORM_IDS.filter(id => !configured.has(id));
}

async function buildDiscordRecord(): Promise<DiscordImRecord> {
  const result = await p.group({
    token: () => p.text({ message: 'Discord bot token', validate: v => v.length === 0 ? 'Required' : undefined }),
    clientId: () => p.text({ message: 'Application client ID', validate: v => v.length === 0 ? 'Required' : undefined }),
    guildIds: () => p.text({ message: 'Guild IDs (comma-separated, optional)', placeholder: 'Leave empty for global', defaultValue: '' }),
  }, { onCancel: () => { p.cancel('Setup cancelled.'); process.exit(0); } });

  return {
    type: 'im',
    id: 'discord',
    enabled: true,
    note: 'Discord bot',
    config: {
      token: result.token,
      clientId: result.clientId,
      guildIds: result.guildIds
        ? result.guildIds.split(',').map(id => id.trim()).filter(Boolean)
        : undefined,
    },
  };
}

async function buildFeishuRecord(): Promise<FeishuImRecord> {
  const result = await p.group({
    appId: () => p.text({ message: 'Feishu app ID', validate: v => v.length === 0 ? 'Required' : undefined }),
    appSecret: () => p.text({ message: 'Feishu app secret', validate: v => v.length === 0 ? 'Required' : undefined }),
    verificationToken: () => p.text({ message: 'Verification token (optional)', defaultValue: '' }),
    encryptKey: () => p.text({ message: 'Encrypt key (optional)', defaultValue: '' }),
    port: () => p.text({ message: 'Local port', defaultValue: '3001' }),
  }, { onCancel: () => { p.cancel('Setup cancelled.'); process.exit(0); } });

  return {
    type: 'im',
    id: 'feishu',
    enabled: true,
    note: 'Feishu app',
    config: {
      appId: result.appId,
      appSecret: result.appSecret,
      verificationToken: result.verificationToken || undefined,
      encryptKey: result.encryptKey || undefined,
      port: result.port ? Number.parseInt(result.port, 10) : undefined,
    },
  };
}

export async function runSetup(
  paths: RelayPaths,
  unconfiguredPlatforms: PlatformId[],
): Promise<LoadedAppConfig> {
  let platformId: PlatformId;

  if (unconfiguredPlatforms.length === 1) {
    platformId = unconfiguredPlatforms[0]!;
    p.log.info(`Configuring ${PLATFORM_LABELS[platformId]}...`);
  } else {
    const selected = await p.select({
      message: 'Which platform to configure?',
      options: unconfiguredPlatforms.map(id => ({
        value: id,
        label: PLATFORM_LABELS[id],
      })),
    });

    if (p.isCancel(selected)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }

    platformId = selected;
  }

  const current = await loadAppConfig(paths);
  const nextRecord = platformId === 'discord'
    ? await buildDiscordRecord()
    : await buildFeishuRecord();

  const nextRecords = upsertRecord(current.records as AppConfigRecord[], nextRecord);
  await saveAppConfig(paths, nextRecords);

  p.log.success(`${PLATFORM_LABELS[platformId]} configured successfully!`);

  return loadAppConfig(paths);
}

export { getUnconfiguredPlatforms, ALL_PLATFORM_IDS, PLATFORM_LABELS };
export type { PlatformId };
```

**Step 2: 验证 TypeScript 无报错**

Run:
```bash
cd /Users/doctorwu/Projects/Self/agent-im-relay && npx tsc --noEmit -p apps/agent-inbox/tsconfig.json
```

Expected: 无报错

**Step 3: Commit**

```bash
git add apps/agent-inbox/src/setup.ts
git commit -m "feat: rewrite setup.ts with @clack/prompts"
```

---

### Task 5: 用 @clack/prompts 重写 cli.ts 和删除 prompts.ts

**Files:**
- Modify: `apps/agent-inbox/src/cli.ts` (完整重写)
- Delete: `apps/agent-inbox/src/prompts.ts`

**Step 1: 重写 cli.ts**

完整替换 `apps/agent-inbox/src/cli.ts`：

```typescript
import { mkdir } from 'node:fs/promises';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { resolveRelayPaths } from '@agent-im-relay/core';
import { loadAppConfig, type AvailableIm } from './config.js';
import { acquirePidLock, registerPidCleanup } from './pid-lock.js';
import { startSelectedIm } from './runtime.js';
import { runSetup, getUnconfiguredPlatforms, PLATFORM_LABELS } from './setup.js';

const CONFIGURE_NEW = '__configure_new__' as const;

export async function runCli(): Promise<void> {
  p.intro(pc.bgCyan(pc.black(' Agent Inbox ')));

  const paths = resolveRelayPaths();
  await Promise.all([
    mkdir(paths.homeDir, { recursive: true }),
    mkdir(paths.stateDir, { recursive: true }),
    mkdir(paths.artifactsDir, { recursive: true }),
    mkdir(paths.logsDir, { recursive: true }),
    mkdir(paths.pidsDir, { recursive: true }),
  ]);

  let loaded = await loadAppConfig(paths);

  // Loop: if no platforms or user chose "configure new", keep going
  while (true) {
    const unconfigured = getUnconfiguredPlatforms(loaded.availableIms);

    if (loaded.availableIms.length === 0) {
      if (unconfigured.length === 0) {
        p.log.error('No platforms available to configure.');
        p.outro('Exiting.');
        return;
      }

      p.log.info('No platforms configured yet. Let\'s set one up.');
      loaded = await runSetup(paths, unconfigured);
      continue;
    }

    // Build selection options
    const options: Array<{ value: string; label: string; hint?: string }> = loaded.availableIms.map(im => ({
      value: im.id,
      label: PLATFORM_LABELS[im.id] ?? im.id,
      hint: im.note ?? 'configured',
    }));

    if (unconfigured.length > 0) {
      options.push({
        value: CONFIGURE_NEW,
        label: 'Configure a new platform...',
      });
    }

    const selected = await p.select({
      message: 'Select a platform to start',
      options,
    });

    if (p.isCancel(selected)) {
      p.cancel('Cancelled.');
      return;
    }

    if (selected === CONFIGURE_NEW) {
      loaded = await runSetup(paths, unconfigured);
      continue;
    }

    const selectedIm = loaded.availableIms.find(im => im.id === selected)!;

    // PID lock check
    const acquired = await acquirePidLock(paths.pidsDir, selectedIm.id);
    if (!acquired) {
      p.log.error(`${PLATFORM_LABELS[selectedIm.id]} is already running. Only one instance per platform is allowed.`);
      p.outro('Exiting.');
      return;
    }

    registerPidCleanup(paths.pidsDir, selectedIm.id);

    const s = p.spinner();
    s.start(`Starting ${PLATFORM_LABELS[selectedIm.id]}...`);

    try {
      // applyRuntimeEnvironment is called inside startSelectedIm
      s.stop(`${PLATFORM_LABELS[selectedIm.id]} runtime started.`);
      await startSelectedIm(selectedIm, loaded.runtime, paths);
    } catch (error) {
      s.stop(`Failed to start ${PLATFORM_LABELS[selectedIm.id]}.`);
      throw error;
    }

    break;
  }
}
```

**Step 2: 删除 prompts.ts**

Run:
```bash
rm /Users/doctorwu/Projects/Self/agent-im-relay/apps/agent-inbox/src/prompts.ts
```

**Step 3: 确认无其他文件引用 prompts.ts**

Run:
```bash
cd /Users/doctorwu/Projects/Self/agent-im-relay && grep -r "from.*prompts" apps/agent-inbox/src/ --include="*.ts"
```

Expected: 仅 `@clack/prompts` 的引用，不再有 `./prompts.js` 引用

**Step 4: 更新 index.ts 入口（移除 streams 参数）**

`apps/agent-inbox/src/index.ts` 替换为：

```typescript
#!/usr/bin/env node

import { runCli } from './cli.js';

void runCli().catch((error) => {
  console.error('[agent-inbox] failed to start:', error);
  process.exitCode = 1;
});
```

这个文件应该和现有内容一致（无需改动），仅需确认 `runCli()` 不再传 streams 参数。

**Step 5: 构建验证**

Run:
```bash
cd /Users/doctorwu/Projects/Self/agent-im-relay && pnpm --filter agent-inbox build
```

注意：此处不需要 SEA 打包成功（CI 环境做），仅需 tsdown 编译成功。如果 build 脚本包含 SEA 步骤且失败，需要将 build 脚本拆分（见 Task 6）。

**Step 6: Commit**

```bash
git add -A apps/agent-inbox/src/
git commit -m "feat: rewrite CLI with @clack/prompts, add PID lock, remove readline prompts"
```

---

### Task 6: 拆分 build 脚本，分离 JS 构建与 SEA 打包

**Files:**
- Modify: `apps/agent-inbox/package.json`

**Step 1: 拆分 scripts**

将 `apps/agent-inbox/package.json` 的 scripts 改为：

```json
{
  "scripts": {
    "build": "pnpm --filter @agent-im-relay/core build && pnpm --filter @agent-im-relay/discord build && pnpm --filter @agent-im-relay/feishu build && tsdown",
    "build:sea": "node ./scripts/build-executable.mjs",
    "build:all": "pnpm run build && pnpm run build:sea",
    "start": "node dist/index.mjs",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

这样 `build` 只做 JS 打包（快速、跨平台），`build:sea` 单独做 SEA 打包，`build:all` 做全量。

**Step 2: 验证 build 脚本正常**

Run:
```bash
cd /Users/doctorwu/Projects/Self/agent-im-relay && pnpm --filter agent-inbox build
```

Expected: 编译成功，生成 `dist/index.mjs`

**Step 3: Commit**

```bash
git add apps/agent-inbox/package.json
git commit -m "chore: split build scripts to separate JS bundle from SEA packaging"
```

---

### Task 7: 创建 GitHub Actions 工作流

**Files:**
- Create: `.github/workflows/release.yml`

**Step 1: 创建工作流文件**

```yaml
name: Build & Release

on:
  push:
    branches: [main]
    tags: ['v*.*.*']

permissions:
  contents: write

jobs:
  build-bundle:
    name: Build JS Bundle
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r build
      - name: Package bundle
        run: tar -czf agent-inbox-bundle.tar.gz -C apps/agent-inbox/dist .
      - uses: actions/upload-artifact@v4
        with:
          name: agent-inbox-bundle
          path: agent-inbox-bundle.tar.gz

  build-sea:
    name: Build SEA (${{ matrix.os }}-${{ matrix.arch }})
    strategy:
      matrix:
        include:
          - os: darwin
            arch: x64
            runner: macos-13
          - os: darwin
            arch: arm64
            runner: macos-14
          - os: linux
            arch: x64
            runner: ubuntu-latest
          - os: linux
            arch: arm64
            runner: ubuntu-24.04-arm
    runs-on: ${{ matrix.runner }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r build
      - name: Build SEA executable
        working-directory: apps/agent-inbox
        run: node scripts/build-executable.mjs
      - name: Rename executable
        run: mv apps/agent-inbox/dist/agent-inbox apps/agent-inbox/dist/agent-inbox-${{ matrix.os }}-${{ matrix.arch }}
      - uses: actions/upload-artifact@v4
        with:
          name: agent-inbox-${{ matrix.os }}-${{ matrix.arch }}
          path: apps/agent-inbox/dist/agent-inbox-${{ matrix.os }}-${{ matrix.arch }}

  release:
    name: Create GitHub Release
    if: startsWith(github.ref, 'refs/tags/v')
    needs: [build-bundle, build-sea]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: artifacts
          merge-multiple: true
      - name: List artifacts
        run: ls -la artifacts/
      - uses: softprops/action-gh-release@v2
        with:
          files: artifacts/*
          generate_release_notes: true
```

**Step 2: 验证 YAML 格式正确**

Run:
```bash
cd /Users/doctorwu/Projects/Self/agent-im-relay && python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))" 2>/dev/null || node -e "const fs=require('fs'); console.log('file exists:', fs.existsSync('.github/workflows/release.yml'))"
```

Expected: 文件存在且 YAML 格式正确

**Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add GitHub Actions workflow for SEA build and release"
```

---

### Task 8: 端到端验证

**Step 1: 完整构建**

Run:
```bash
cd /Users/doctorwu/Projects/Self/agent-im-relay && pnpm -r build
```

Expected: 所有包构建成功

**Step 2: 运行测试**

Run:
```bash
cd /Users/doctorwu/Projects/Self/agent-im-relay && pnpm -r test
```

Expected: 所有测试通过

**Step 3: 手动验证 CLI 启动**

Run:
```bash
cd /Users/doctorwu/Projects/Self/agent-im-relay && node apps/agent-inbox/dist/index.mjs
```

Expected: 看到 `Agent Inbox` 标题和平台选择界面（@clack/prompts 风格），Ctrl+C 可正常退出

**Step 4: 最终 Commit（如有额外修复）**

```bash
git add -A
git commit -m "fix: address issues found during e2e verification"
```
