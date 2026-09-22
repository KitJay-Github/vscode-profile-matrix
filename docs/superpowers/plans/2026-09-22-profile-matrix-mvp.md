# Profile Matrix 第一期 MVP 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出一个 VS Code 扩展，以矩阵形式展示「扩展 × 配置文件」的完整对应关系，并把配置文件切换、原生扩展面板跳转接到矩阵上。

**Architecture:** 数据层（`src/core/`）是纯函数 + 文件读取，不依赖 vscode API，用 node:test 单测覆盖；UI 层（`src/panel/` + `media/`）是一个 Webview 面板，宿主与页面之间用类型化的 postMessage 协议通信。配置文件数据来自 `storage.json`、`extensions.json` 与 `state.vscdb` 三处，其中 SQLite 用 Node 内置的 `node:sqlite`（零依赖）。

**Tech Stack:** TypeScript · esbuild · node:sqlite · 原生 HTML/CSS/JS Webview · node:test

**设计依据：** `docs/superpowers/specs/2026-09-22-vscode-profile-matrix-design.md`

**提交信息格式：** 本项目沿用既有项目（Translation For VS Code）的双语风格——中文标题，空行，英文翻译。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `package.json` | 扩展清单、依赖、脚本 |
| `tsconfig.json` | 类型检查配置 |
| `esbuild.js` | 构建扩展与测试两份产物 |
| `src/extension.ts` | 插件入口，注册命令 |
| `src/core/types.ts` | 全部共享类型与常量 |
| `src/core/paths.ts` | 定位用户数据目录与扩展目录（跨平台，可注入依赖便于测试） |
| `src/core/profileStore.ts` | 解析 `storage.json` → 配置文件列表 |
| `src/core/sqlite.ts` | 读 `state.vscdb` 的禁用列表 |
| `src/core/extensionStore.ts` | 读 `extensions.json` 与扩展的 `package.json`（取显示名） |
| `src/core/matrix.ts` | **核心纯函数**：把三方数据拼成矩阵行 |
| `src/panel/protocol.ts` | 宿主 ↔ Webview 消息类型 |
| `src/panel/matrixPanel.ts` | Webview 面板生命周期与消息路由 |
| `media/main.js` | 矩阵渲染与交互 |
| `media/styles.css` | 样式（用 VS Code 主题变量） |
| `test/*.test.ts` | core 层单测 |

---

## Task 1: 项目脚手架与构建流程

**Files:**
- Create: `package.json`, `tsconfig.json`, `esbuild.js`, `.gitignore`, `.vscodeignore`
- Create: `src/extension.ts`（最小可激活版本）

- [ ] **Step 1: 初始化 git 仓库**

```bash
cd "E:/project/VSCode/Pack_Config_For_VS Code"
git init
```

预期：`Initialized empty Git repository in ...`

- [ ] **Step 2: 写 `.gitignore` 与 `.vscodeignore`**

`.gitignore`：

```gitignore
node_modules/
out/
out-test/
*.vsix
.spike/write-test/
.spike/iso-data/
```

> 探针的源文件与结论（`.spike/probe-extension/`、`.spike/RESULT.md`）要提交，隔离实例运行时生成的数据不提交。

`.vscodeignore`：

```
.vscode/**
.github/**
.spike/**
test/**
out-test/**
src/**
docs/**
**/*.map
**/*.ts
tsconfig.json
esbuild.js
```

- [ ] **Step 3: 写 `package.json`**

```json
{
  "name": "vscode-profile-matrix",
  "displayName": "Profile Matrix",
  "description": "矩阵式管理 VS Code 配置文件与扩展的对应关系",
  "version": "0.0.1",
  "publisher": "local-dev",
  "license": "MIT",
  "engines": {
    "vscode": "^1.128.0"
  },
  "categories": [
    "Other"
  ],
  "keywords": [
    "profile",
    "extension",
    "配置文件",
    "扩展管理"
  ],
  "main": "./out/extension.js",
  "activationEvents": [
    "onStartupFinished"
  ],
  "contributes": {
    "commands": [
      {
        "command": "profileMatrix.openPanel",
        "title": "打开扩展矩阵",
        "category": "Profile Matrix"
      }
    ]
  },
  "scripts": {
    "build": "node esbuild.js --production",
    "watch": "node esbuild.js --watch",
    "check": "tsc --noEmit",
    "test": "node esbuild.js && node --test out-test/"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/vscode": "^1.128.0",
    "esbuild": "^0.24.2",
    "typescript": "^5.7.2"
  }
}
```

- [ ] **Step 4: 写 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "Node16",
    "moduleResolution": "Node16",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "out",
    "sourceMap": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "skipLibCheck": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 5: 写 `esbuild.js`**

```js
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

async function main() {
  const targets = [
    { ...common, entryPoints: ['src/extension.ts'], outfile: 'out/extension.js' },
    { ...common, entryPoints: ['test/**/*.test.ts'], outdir: 'out-test', minify: false },
  ];

  if (watch) {
    for (const options of targets) {
      const ctx = await esbuild.context(options);
      await ctx.watch();
    }
    return;
  }
  for (const options of targets) {
    await esbuild.build(options);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 6: 写最小 `src/extension.ts`**

```ts
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('profileMatrix.openPanel', () => {
      void vscode.window.showInformationMessage('Profile Matrix 已激活');
    }),
  );
}

export function deactivate(): void {
  // 无需要清理的资源
}
```

- [ ] **Step 7: 安装依赖并构建**

```bash
npm install
npm run build
```

预期：`out/extension.js` 生成，无报错。

- [ ] **Step 8: 类型检查**

```bash
npm run check
```

预期：无输出（无类型错误）。

- [ ] **Step 9: 提交**

```bash
git add package.json tsconfig.json esbuild.js .gitignore .vscodeignore src/extension.ts
git commit -m "搭建扩展骨架与构建流程

Scaffold the extension skeleton and build pipeline"
```

---

## Task 2: 写入链路 Spike（决定写侧能不能做）

> 这是设计文档 §8 要求的验证。**必须在实现写侧之前完成**，结论决定「应用」按钮的实现方式。

**Files:**
- Create: `.spike/probe-extension/package.json`
- Create: `.spike/probe-extension/extension.js`
- Create: `.spike/RESULT.md`（记录结论）

- [ ] **Step 1: 写探针扩展的 `package.json`**

```json
{
  "name": "profile-matrix-probe",
  "publisher": "spike",
  "version": "1.0.0",
  "engines": {
    "vscode": "^1.128.0"
  },
  "main": "./extension.js",
  "activationEvents": [
    "*"
  ]
}
```

- [ ] **Step 2: 写探针 `extension.js`**

```js
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'probe-result.json');

function activate() {
  const enabled = vscode.extensions.all.map((e) => e.id).sort();
  fs.writeFileSync(
    OUT,
    JSON.stringify({ enabledCount: enabled.length, enabled }, null, 2),
    'utf8',
  );
}

module.exports = { activate };
```

- [ ] **Step 3: 生成三个最小扩展（自带对照组，结论才无歧义）**

环境里放三个自制扩展，一次启动同时拿到实验组与对照组：

| 扩展 id | 作用 |
|---|---|
| `spike.profile-matrix-probe` | 探针，激活时把可见扩展列表写进文件 |
| `spike.target-disabled` | 实验组，稍后写进禁用列表 |
| `spike.target-control` | 对照组，全程保持启用 |

```bash
cd "E:/project/VSCode/Pack_Config_For_VS Code"
node -e "
const fs=require('fs'), path=require('path');
const EXT='.spike/write-test/ext';

const probeDir=path.join(EXT,'spike.profile-matrix-probe-1.0.0');
fs.mkdirSync(probeDir,{recursive:true});
fs.copyFileSync('.spike/probe-extension/package.json', path.join(probeDir,'package.json'));
fs.copyFileSync('.spike/probe-extension/extension.js', path.join(probeDir,'extension.js'));

const stub='exports.activate = function () {};';
for (const id of ['spike.target-disabled','spike.target-control']) {
  const [publisher,name]=id.split('.');
  const dir=path.join(EXT, id+'-1.0.0');
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'package.json'), JSON.stringify({
    name, publisher, version:'1.0.0',
    engines:{ vscode:'^1.128.0' },
    main:'./extension.js', activationEvents:['*'],
  },null,2));
  fs.writeFileSync(path.join(dir,'extension.js'), stub);
}
console.log('已生成 3 个扩展于', EXT);
"
```

- [ ] **Step 4: 写扩展清单，并在禁用列表里只放实验组**

```bash
node -e "
const fs=require('fs'), path=require('path');
const ROOT=path.resolve('.spike/write-test');
const EXT=path.join(ROOT,'ext');
const ids=['spike.profile-matrix-probe','spike.target-disabled','spike.target-control'];

// Windows 盘符转成 VS Code 的 URI path 形式（/e:/... 小写盘符）
const toUriPath=(p)=>{
  const s=path.resolve(p).replace(/\\\\/g,'/');
  return '/'+s.charAt(0).toLowerCase()+s.slice(1);
};

fs.writeFileSync(path.join(EXT,'extensions.json'), JSON.stringify(ids.map(id=>({
  identifier:{ id, uuid:'00000000-0000-0000-0000-000000000000' },
  version:'1.0.0',
  location:{ '\$mid':1, path:toUriPath(path.join(EXT, id+'-1.0.0')), scheme:'file' },
  relativeLocation:id+'-1.0.0',
  metadata:{ isApplicationScoped:false, isMachineScoped:false, isBuiltin:false, source:'vsix' },
})),null,4));

const gs=path.join(ROOT,'data','User','globalStorage');
fs.mkdirSync(gs,{recursive:true});
const sqlite=require('node:sqlite');
const dbPath=path.join(gs,'state.vscdb');
fs.rmSync(dbPath,{force:true});
const db=new sqlite.DatabaseSync(dbPath);
db.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);');
db.prepare('INSERT INTO ItemTable (key,value) VALUES (?,?)').run(
  'extensionsIdentifiers/disabled',
  Buffer.from(JSON.stringify([{ id:'spike.target-disabled' }]),'utf8'));
db.close();
console.log('清单 3 个扩展；禁用列表仅含 spike.target-disabled');
"
```

- [ ] **Step 5: 启动隔离实例，等它完成激活**

```powershell
$code = "C:\Users\22859\AppData\Local\Programs\Microsoft VS Code\bin\code.cmd"
$root = "E:\project\VSCode\Pack_Config_For_VS Code\.spike\write-test"
& $code --user-data-dir "$root\data" --extensions-dir "$root\ext"
```

窗口出现后等待约 15 秒（等扩展宿主跑完激活），然后**关掉这个新窗口**——不要关掉你正在用的主窗口。

- [ ] **Step 6: 读探针结果并判定**

```bash
node -e "
const fs=require('fs');
const p='.spike/write-test/ext/spike.profile-matrix-probe-1.0.0/probe-result.json';
if(!fs.existsSync(p)){ console.log('探针没写出结果——确认窗口真的开过且等够了时间'); process.exit(1); }
const r=JSON.parse(fs.readFileSync(p,'utf8'));
const visible=(id)=>r.enabled.some(x=>x===id);
console.log('可见扩展:', r.enabled.join(', ')||'(空)');
console.log('  实验组 spike.target-disabled 可见:', visible('spike.target-disabled'));
console.log('  对照组 spike.target-control  可见:', visible('spike.target-control'));
console.log('  探针   spike.profile-matrix-probe 可见:', visible('spike.profile-matrix-probe'));
"
```

**判读（三者须同时成立）**：
- 探针可见 → 环境真的跑起来了
- 对照组可见 → 清单本身没问题
- **实验组不可见 → 改 `state.vscdb` 确实能禁用扩展** ✅

若实验组**也可见**，说明改文件不足以禁用扩展，写侧降级为「跳转原生面板 + 安装/卸载命令」，并回到设计文档更新 §3.2。

- [ ] **Step 7: 把结论写进 `.spike/RESULT.md` 并提交**

```markdown
# 写入链路 Spike 结论

日期：2026-09-22
VS Code 版本：
隔离环境：.spike/write-test
探针输出：.spike/write-test/ext/spike.profile-matrix-probe-1.0.0/probe-result.json

## 结果
- 靶子扩展是否仍可见：
- 结论：（可写 / 降级）
- 观察到的额外现象：
```

```bash
git add .spike/probe-extension .spike/RESULT.md
git commit -m "验证写入链路：改 SQLite 能否真正禁用扩展

Verify the write path: whether editing the SQLite store really disables an extension"
```

---

## Task 3: 类型定义与路径解析

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/paths.ts`
- Test: `test/paths.test.ts`

- [ ] **Step 1: 写 `src/core/types.ts`**

```ts
/** 默认配置文件的固定 id（VS Code 内部常量） */
export const DEFAULT_PROFILE_LOCATION = '__default__profile__';

/** 一个配置文件 */
export interface ProfileInfo {
  /** 相对 User/profiles 的目录名；默认配置为 __default__profile__ */
  location: string;
  /** 显示名 */
  name: string;
  /** 图标 id */
  icon?: string;
  /** 是否为默认配置 */
  isDefault: boolean;
  /** 是否为 VS Code 内置配置（如 Agents） */
  isBuiltin: boolean;
}

/** 扩展在某个配置文件里的状态 */
export type CellState =
  /** 已装且启用 */
  | 'enabled'
  /** 已装但禁用 */
  | 'disabled'
  /** 该配置未装 */
  | 'absent'
  /** 全局共享，不归任何配置管 */
  | 'global';

/** 扩展所属分组 */
export type RowGroup = 'managed' | 'global' | 'orphan';

/** 矩阵中的一行 */
export interface MatrixRow {
  /** 扩展 id，如 candycium.keil-assistant-new */
  id: string;
  /** 展示用名称 */
  name: string;
  /** 发布者 */
  publisher: string;
  /** 分组 */
  group: RowGroup;
  /** profileLocation -> 状态 */
  cells: Record<string, CellState>;
}

/** 扩展清单条目（来自 extensions.json） */
export interface ExtensionEntry {
  identifier: { id: string; uuid?: string };
  version?: string;
  location?: { path?: string };
  relativeLocation?: string;
  metadata?: {
    isApplicationScoped?: boolean;
    isBuiltin?: boolean;
  } & Record<string, unknown>;
}

/** 被禁用的扩展条目 */
export interface DisabledEntry {
  id: string;
  uuid?: string;
}
```

- [ ] **Step 2: 写失败测试 `test/paths.test.ts`**

```ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  candidateUserDataRoots,
  EXT_DIR_BY_PRODUCT,
  resolveUserDataPaths,
} from '../src/core/paths';

test('Windows 候选目录来自 APPDATA', () => {
  const roots = candidateUserDataRoots('win32', { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }, 'C:\\Users\\x');
  assert.ok(roots.length > 0);
  assert.ok(roots[0].includes('AppData'));
  assert.ok(roots[0].includes('Code'));
});

test('Windows 缺少 APPDATA 时返回空数组', () => {
  assert.deepEqual(candidateUserDataRoots('win32', {}, 'C:\\Users\\x'), []);
});

test('macOS 候选目录位于 Library/Application Support', () => {
  const roots = candidateUserDataRoots('darwin', {}, '/Users/x');
  assert.ok(roots.some((r) => r.includes('Library/Application Support')));
});

test('Linux 候选目录遵循 XDG_CONFIG_HOME', () => {
  const roots = candidateUserDataRoots('linux', { XDG_CONFIG_HOME: '/etc/xdg' }, '/home/x');
  assert.ok(roots.every((r) => r.startsWith('/etc/xdg')));
});

test('Linux 无 XDG_CONFIG_HOME 时回落到 ~/.config', () => {
  const roots = candidateUserDataRoots('linux', {}, '/home/x');
  assert.ok(roots.every((r) => r.startsWith('/home/x/.config')));
});

test('resolveUserDataPaths 选中第一个含 storage.json 的目录', () => {
  const existing = new Set(['/home/x/.config/Code/User/globalStorage/storage.json']);
  const paths = resolveUserDataPaths('linux', {}, '/home/x', (p) => existing.has(p));
  assert.ok(paths);
  assert.equal(paths.userDir, '/home/x/.config/Code/User');
  assert.equal(paths.storageJson, '/home/x/.config/Code/User/globalStorage/storage.json');
  assert.equal(paths.profilesDir, '/home/x/.config/Code/User/profiles');
  assert.equal(paths.extensionsDir, '/home/x/.vscode/extensions');
});

test('resolveUserDataPaths 找不到时返回 undefined', () => {
  assert.equal(resolveUserDataPaths('linux', {}, '/home/x', () => false), undefined);
});

test('扩展目录按发行版区分', () => {
  assert.equal(EXT_DIR_BY_PRODUCT['Code'], '.vscode');
  assert.equal(EXT_DIR_BY_PRODUCT['Code - Insiders'], '.vscode-insiders');
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
npm test
```

预期：FAIL —— 找不到模块 `../src/core/paths`。

- [ ] **Step 4: 实现 `src/core/paths.ts`**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** VS Code 各发行版的用户数据目录名 */
export const PRODUCT_DIR_NAMES = ['Code', 'Code - Insiders', 'VSCodium', 'Cursor'];

/** 发行版 -> 扩展目录的隐藏目录名 */
export const EXT_DIR_BY_PRODUCT: Record<string, string> = {
  Code: '.vscode',
  'Code - Insiders': '.vscode-insiders',
  VSCodium: '.vscode-oss',
  Cursor: '.cursor',
};

export interface UserDataPaths {
  /** 发行版名，如 Code */
  productName: string;
  /** <用户数据根>/User */
  userDir: string;
  /** <用户数据根>/User/globalStorage/storage.json */
  storageJson: string;
  /** <用户数据根>/User/profiles */
  profilesDir: string;
  /** 扩展安装目录，如 ~/.vscode/extensions */
  extensionsDir: string;
}

/**
 * 按平台列出用户数据根目录的候选路径。
 * 纯函数：平台、环境变量、家目录都从参数注入，便于测试。
 */
export function candidateUserDataRoots(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string,
): string[] {
  if (platform === 'win32') {
    const appData = env.APPDATA;
    if (!appData) {
      return [];
    }
    return PRODUCT_DIR_NAMES.map((n) => path.join(appData, n));
  }
  if (platform === 'darwin') {
    return PRODUCT_DIR_NAMES.map((n) => path.join(home, 'Library', 'Application Support', n));
  }
  const configHome = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return PRODUCT_DIR_NAMES.map((n) => path.join(configHome, n));
}

/**
 * 找到真实存在的那份用户数据目录。
 * exists 可注入，便于测试。
 */
export function resolveUserDataPaths(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
  exists: (p: string) => boolean = fs.existsSync,
): UserDataPaths | undefined {
  for (const productName of PRODUCT_DIR_NAMES) {
    const root = candidateUserDataRoots(platform, env, home).find((r) =>
      r.endsWith(productName),
    );
    if (!root) {
      continue;
    }
    const userDir = path.join(root, 'User');
    const storageJson = path.join(userDir, 'globalStorage', 'storage.json');
    if (!exists(storageJson)) {
      continue;
    }
    return {
      productName,
      userDir,
      storageJson,
      profilesDir: path.join(userDir, 'profiles'),
      extensionsDir: path.join(home, EXT_DIR_BY_PRODUCT[productName] ?? '.vscode', 'extensions'),
    };
  }
  return undefined;
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
npm test
```

预期：全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add src/core/types.ts src/core/paths.ts test/paths.test.ts
git commit -m "实现跨平台用户数据目录解析

Resolve the user data directory across platforms"
```

---

## Task 4: 解析配置文件注册表

**Files:**
- Create: `src/core/profileStore.ts`
- Test: `test/profileStore.test.ts`

- [ ] **Step 1: 写失败测试 `test/profileStore.test.ts`**

```ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DEFAULT_PROFILE_LOCATION } from '../src/core/types';
import { parseProfiles } from '../src/core/profileStore';

test('默认配置恒在列表首位', () => {
  const profiles = parseProfiles('{}');
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].location, DEFAULT_PROFILE_LOCATION);
  assert.equal(profiles[0].isDefault, true);
});

test('解析真实形状的注册表', () => {
  const text = JSON.stringify({
    telemetry: { machineId: 'x' },
    userDataProfiles: [
      { location: '-19496b3a', name: 'STM32', icon: 'chip', useDefaultFlags: {} },
      { location: '-740a190f', name: 'ESP32', icon: 'copilot' },
      { location: 'builtin/agents', name: 'Agents', useDefaultFlags: { settings: true } },
    ],
  });
  const profiles = parseProfiles(text);
  assert.equal(profiles.length, 4);
  assert.deepEqual(
    profiles.map((p) => p.name),
    ['默认', 'STM32', 'ESP32', 'Agents'],
  );
  const agents = profiles.find((p) => p.name === 'Agents');
  assert.equal(agents?.isBuiltin, true);
  const stm32 = profiles.find((p) => p.name === 'STM32');
  assert.equal(stm32?.icon, 'chip');
  assert.equal(stm32?.isBuiltin, false);
});

test('非法 JSON 只返回默认配置', () => {
  const profiles = parseProfiles('{ 这不是 JSON');
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].isDefault, true);
});

test('缺少 location 的条目被丢弃', () => {
  const text = JSON.stringify({
    userDataProfiles: [{ name: '坏数据' }, { location: '-ok1', name: '正常' }],
  });
  const profiles = parseProfiles(text);
  assert.deepEqual(
    profiles.map((p) => p.name),
    ['默认', '正常'],
  );
});

test('缺少 name 时用 location 兜底', () => {
  const text = JSON.stringify({ userDataProfiles: [{ location: '-abc123' }] });
  const profiles = parseProfiles(text);
  assert.equal(profiles[1].name, '-abc123');
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test
```

预期：FAIL —— 找不到 `../src/core/profileStore`。

- [ ] **Step 3: 实现 `src/core/profileStore.ts`**

```ts
import * as fs from 'fs';
import { DEFAULT_PROFILE_LOCATION, type ProfileInfo } from './types';

interface RawProfile {
  location?: unknown;
  name?: unknown;
  icon?: unknown;
}

interface RawStorage {
  userDataProfiles?: unknown;
}

/** 默认配置的展示名 */
const DEFAULT_PROFILE_NAME = '默认';

/** 把 storage.json 的文本解析成配置文件列表（纯函数） */
export function parseProfiles(storageJsonText: string): ProfileInfo[] {
  const fallback: ProfileInfo[] = [
    { location: DEFAULT_PROFILE_LOCATION, name: DEFAULT_PROFILE_NAME, isDefault: true, isBuiltin: false },
  ];

  let raw: RawStorage;
  try {
    raw = JSON.parse(storageJsonText) as RawStorage;
  } catch {
    return fallback;
  }

  if (!Array.isArray(raw.userDataProfiles)) {
    return fallback;
  }

  const rest = (raw.userDataProfiles as RawProfile[])
    .filter((p): p is RawProfile & { location: string } =>
      typeof p?.location === 'string' && p.location.length > 0,
    )
    .map((p) => ({
      location: p.location,
      name: typeof p.name === 'string' && p.name.length > 0 ? p.name : p.location,
      icon: typeof p.icon === 'string' ? p.icon : undefined,
      isDefault: false,
      isBuiltin: p.location.startsWith('builtin/'),
    }));

  return [...fallback, ...rest];
}

/** 从磁盘读并解析；读失败时退化为只有默认配置 */
export function readProfiles(storageJsonPath: string): ProfileInfo[] {
  try {
    return parseProfiles(fs.readFileSync(storageJsonPath, 'utf8'));
  } catch {
    return parseProfiles('{}');
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test
```

预期：全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/core/profileStore.ts test/profileStore.test.ts
git commit -m "解析配置文件注册表

Parse the profile registry"
```

---

## Task 5: 读取禁用状态（node:sqlite）

**Files:**
- Create: `src/core/sqlite.ts`
- Test: `test/sqlite.test.ts`

- [ ] **Step 1: 写失败测试 `test/sqlite.test.ts`**

```ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DISABLED_KEY, parseDisabledValue, readDisabledEntries } from '../src/core/sqlite';

test('解析 Buffer 形式的禁用列表', () => {
  const buf = Buffer.from('[{"id":"github.copilot-chat"}]', 'utf8');
  assert.deepEqual(parseDisabledValue(buf), [{ id: 'github.copilot-chat' }]);
});

test('解析字符串形式的禁用列表并保留 uuid', () => {
  const text = '[{"id":"platformio.platformio-ide","uuid":"9d96b65c"}]';
  assert.deepEqual(parseDisabledValue(text), [
    { id: 'platformio.platformio-ide', uuid: '9d96b65c' },
  ]);
});

test('空值与非数组返回空列表', () => {
  assert.deepEqual(parseDisabledValue(undefined), []);
  assert.deepEqual(parseDisabledValue(null), []);
  assert.deepEqual(parseDisabledValue('{"not":"array"}'), []);
});

test('损坏的 JSON 返回空列表而不抛异常', () => {
  assert.deepEqual(parseDisabledValue('[{坏数据'), []);
});

test('缺少 id 的条目被过滤', () => {
  assert.deepEqual(parseDisabledValue('[{"uuid":"x"},{"id":"ok.ext"}]'), [{ id: 'ok.ext' }]);
});

test('从真实 SQLite 文件读取禁用列表', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'));
  const dbPath = path.join(dir, 'state.vscdb');
  const sqlite = require('node:sqlite');
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);');
  db.prepare('INSERT INTO ItemTable (key,value) VALUES (?,?)').run(
    DISABLED_KEY,
    Buffer.from(JSON.stringify([{ id: 'cl.eide' }]), 'utf8'),
  );
  db.close();

  assert.deepEqual(readDisabledEntries(dbPath), [{ id: 'cl.eide' }]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('文件不存在时返回空列表', () => {
  assert.deepEqual(readDisabledEntries(path.join(os.tmpdir(), '不存在的-db-xyz.vscdb')), []);
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test
```

预期：FAIL —— 找不到 `../src/core/sqlite`。

- [ ] **Step 3: 实现 `src/core/sqlite.ts`**

```ts
import type { DisabledEntry } from './types';

/** state.vscdb 中记录被禁用扩展的 key */
export const DISABLED_KEY = 'extensionsIdentifiers/disabled';

/** node:sqlite 的最小类型描述（避免依赖 @types/node 的版本可用性） */
interface SqliteStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

interface SqliteModule {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqliteDatabase;
}

let cached: SqliteModule | null | undefined;

/** 加载内置 SQLite；不可用时返回 undefined（老版本 VS Code 会走到这里） */
export function loadSqlite(): SqliteModule | undefined {
  if (cached === undefined) {
    try {
      cached = require('node:sqlite') as SqliteModule;
    } catch {
      cached = null;
    }
  }
  return cached ?? undefined;
}

/** 当前运行时是否支持内置 SQLite */
export function isSqliteAvailable(): boolean {
  return loadSqlite() !== undefined;
}

/** 把数据库里存的值（BLOB 或 TEXT）解析成禁用条目（纯函数） */
export function parseDisabledValue(value: unknown): DisabledEntry[] {
  if (value === undefined || value === null) {
    return [];
  }
  const text =
    typeof value === 'string'
      ? value
      : value instanceof Uint8Array
        ? Buffer.from(value).toString('utf8')
        : String(value);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(
    (e): e is DisabledEntry =>
      !!e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string',
  );
}

/** 只读打开一个 state.vscdb，读出被禁用的扩展列表 */
export function readDisabledEntries(dbPath: string): DisabledEntry[] {
  const sqlite = loadSqlite();
  if (!sqlite) {
    return [];
  }
  let db: SqliteDatabase;
  try {
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return [];
  }
  try {
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(DISABLED_KEY) as
      | { value?: unknown }
      | undefined;
    return parseDisabledValue(row?.value);
  } catch {
    return [];
  } finally {
    try {
      db.close();
    } catch {
      // 关闭失败无需处理
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test
```

预期：全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/core/sqlite.ts test/sqlite.test.ts
git commit -m "用内置 SQLite 读取扩展禁用状态

Read extension disablement via the built-in SQLite module"
```

---

## Task 6: 扩展清单读取与矩阵构建

**Files:**
- Create: `src/core/extensionStore.ts`
- Create: `src/core/matrix.ts`
- Test: `test/matrix.test.ts`

- [ ] **Step 1: 写失败测试 `test/matrix.test.ts`**

```ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildMatrix, hasDifference } from '../src/core/matrix';
import { parseExtensionList, uriPathToLocal } from '../src/core/extensionStore';
import type { ProfileInfo } from '../src/core/types';

const PROFILES: ProfileInfo[] = [
  { location: '__default__profile__', name: '默认', isDefault: true, isBuiltin: false },
  { location: '-aaa', name: 'STM32', isDefault: false, isBuiltin: false },
  { location: '-bbb', name: 'ESP32', isDefault: false, isBuiltin: false },
];

const entry = (id: string, appScoped = false) => ({
  identifier: { id },
  metadata: { isApplicationScoped: appScoped },
});

test('parseExtensionList 过滤掉形状不对的条目', () => {
  const list = parseExtensionList(
    JSON.stringify([{ identifier: { id: 'a.b' } }, { identifier: {} }, null, 'x']),
  );
  assert.deepEqual(
    list.map((e) => e.identifier.id),
    ['a.b'],
  );
});

test('parseExtensionList 对非法 JSON 返回空数组', () => {
  assert.deepEqual(parseExtensionList('不是一个数组'), []);
});

test('uriPathToLocal 去掉 Windows 盘符前的斜杠', () => {
  assert.equal(uriPathToLocal('/c:/Users/x/ext'), 'c:/Users/x/ext');
  assert.equal(uriPathToLocal('/home/x/ext'), '/home/x/ext');
});

test('全局共享的扩展在所有列都是 global，且归入 global 组', () => {
  const rows = buildMatrix({
    profiles: PROFILES,
    installedByProfile: new Map([
      ['-aaa', [entry('a.one'), entry('ms-vscode.cpptools', true)]],
    ]),
    disabledByProfile: new Map(),
    allExtensions: [entry('a.one'), entry('ms-vscode.cpptools', true)],
  });
  const shared = rows.find((r) => r.id === 'ms-vscode.cpptools');
  assert.equal(shared?.group, 'global');
  assert.deepEqual(shared?.cells, {
    __default__profile__: 'global',
    '-aaa': 'global',
    '-bbb': 'global',
  });
});

test('装了但禁用与已启用能区分', () => {
  const rows = buildMatrix({
    profiles: PROFILES,
    installedByProfile: new Map([['-aaa', [entry('cl.eide'), entry('pio.pio')]]]),
    disabledByProfile: new Map([['-aaa', new Set(['pio.pio'])]]),
    allExtensions: [entry('cl.eide'), entry('pio.pio')],
  });
  const eide = rows.find((r) => r.id === 'cl.eide');
  const pio = rows.find((r) => r.id === 'pio.pio');
  assert.equal(eide?.cells['-aaa'], 'enabled');
  assert.equal(pio?.cells['-aaa'], 'disabled');
  assert.equal(eide?.cells['-bbb'], 'absent');
});

test('不属于任何配置的扩展归入 orphan 组', () => {
  const rows = buildMatrix({
    profiles: PROFILES,
    installedByProfile: new Map([['-aaa', [entry('cl.eide')]]]),
    disabledByProfile: new Map(),
    allExtensions: [entry('cl.eide'), entry('dbaeumer.vscode-eslint')],
  });
  const orphan = rows.find((r) => r.id === 'dbaeumer.vscode-eslint');
  assert.equal(orphan?.group, 'orphan');
});

test('排序为 managed → global → orphan', () => {
  const rows = buildMatrix({
    profiles: PROFILES,
    installedByProfile: new Map([['-aaa', [entry('z.managed')]]]),
    disabledByProfile: new Map(),
    allExtensions: [entry('o.orphan'), entry('g.global', true), entry('z.managed')],
  });
  assert.deepEqual(
    rows.map((r) => r.group),
    ['managed', 'global', 'orphan'],
  );
});

test('显示名优先取传入的映射，否则从 id 推导', () => {
  const rows = buildMatrix({
    profiles: PROFILES,
    installedByProfile: new Map([['-aaa', [entry('candycium.keil-assistant-new')]]]),
    disabledByProfile: new Map(),
    allExtensions: [entry('candycium.keil-assistant-new')],
    displayNames: new Map([['candycium.keil-assistant-new', 'Keil Assistant']]),
  });
  assert.equal(rows[0].name, 'Keil Assistant');
  assert.equal(rows[0].publisher, 'candycium');
});

test('hasDifference 只在受管格子状态不一致时为真', () => {
  const rows = buildMatrix({
    profiles: PROFILES,
    installedByProfile: new Map([
      ['-aaa', [entry('a.same'), entry('a.diff')]],
      ['-bbb', [entry('a.same')]],
    ]),
    disabledByProfile: new Map(),
    allExtensions: [entry('a.same'), entry('a.diff'), entry('a.g', true)],
  });
  assert.equal(hasDifference(rows.find((r) => r.id === 'a.same')!), false);
  assert.equal(hasDifference(rows.find((r) => r.id === 'a.diff')!), true);
  assert.equal(hasDifference(rows.find((r) => r.id === 'a.g')!), false);
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test
```

预期：FAIL —— 找不到 `../src/core/matrix`。

- [ ] **Step 3: 实现 `src/core/extensionStore.ts`**

```ts
import * as fs from 'fs';
import * as path from 'path';
import type { ExtensionEntry } from './types';

/** 解析某个配置的 extensions.json（纯函数） */
export function parseExtensionList(jsonText: string): ExtensionEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(
    (e): e is ExtensionEntry =>
      !!e &&
      typeof e === 'object' &&
      typeof (e as { identifier?: { id?: unknown } }).identifier?.id === 'string',
  );
}

/** 从磁盘读某个配置的扩展清单 */
export function readExtensionList(jsonPath: string): ExtensionEntry[] {
  try {
    return parseExtensionList(fs.readFileSync(jsonPath, 'utf8'));
  } catch {
    return [];
  }
}

/** 把 file:// URI 的 path 转成本地路径（Windows 上是 /c:/x → c:/x） */
export function uriPathToLocal(p: string): string {
  return /^\/[a-zA-Z]:\//.test(p) ? p.slice(1) : p;
}

/** 读扩展自己的 package.json 取 displayName */
export function readDisplayName(extensionDir: string | undefined): string | undefined {
  if (!extensionDir) {
    return undefined;
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(extensionDir, 'package.json'), 'utf8')) as {
      displayName?: unknown;
    };
    return typeof pkg.displayName === 'string' && pkg.displayName.length > 0
      ? pkg.displayName
      : undefined;
  } catch {
    return undefined;
  }
}

/** 批量取显示名，失败静默跳过 */
export function collectDisplayNames(entries: ExtensionEntry[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const e of entries) {
    const dir = e.location?.path ? uriPathToLocal(e.location.path) : undefined;
    const name = readDisplayName(dir);
    if (name) {
      names.set(e.identifier.id, name);
    }
  }
  return names;
}
```

- [ ] **Step 4: 实现 `src/core/matrix.ts`**

```ts
import type { CellState, ExtensionEntry, MatrixRow, ProfileInfo, RowGroup } from './types';

export interface MatrixInput {
  profiles: ProfileInfo[];
  /** profileLocation -> 该配置清单里的扩展 */
  installedByProfile: Map<string, ExtensionEntry[]>;
  /** profileLocation -> 被禁用的扩展 id */
  disabledByProfile: Map<string, Set<string>>;
  /** 全局已下载的扩展（用于找出「装了但没用上」的） */
  allExtensions: ExtensionEntry[];
  /** 扩展 id -> 展示名 */
  displayNames?: Map<string, string>;
}

const GROUP_ORDER: Record<RowGroup, number> = { managed: 0, global: 1, orphan: 2 };

/** 把三方数据拼成矩阵行（纯函数） */
export function buildMatrix(input: MatrixInput): MatrixRow[] {
  const { profiles, installedByProfile, disabledByProfile, allExtensions, displayNames } = input;

  const known = new Map<string, ExtensionEntry>();
  const globalIds = new Set<string>();
  const collect = (e: ExtensionEntry) => {
    if (!known.has(e.identifier.id)) {
      known.set(e.identifier.id, e);
    }
    if (e.metadata?.isApplicationScoped === true) {
      globalIds.add(e.identifier.id);
    }
  };
  allExtensions.forEach(collect);
  for (const entries of installedByProfile.values()) {
    entries.forEach(collect);
  }

  const rows: MatrixRow[] = [];
  for (const id of known.keys()) {
    const isGlobal = globalIds.has(id);
    const cells: Record<string, CellState> = {};
    let installedAnywhere = false;

    for (const profile of profiles) {
      if (isGlobal) {
        cells[profile.location] = 'global';
        continue;
      }
      const installed = (installedByProfile.get(profile.location) ?? []).some(
        (e) => e.identifier.id === id,
      );
      if (!installed) {
        cells[profile.location] = 'absent';
        continue;
      }
      installedAnywhere = true;
      cells[profile.location] = disabledByProfile.get(profile.location)?.has(id)
        ? 'disabled'
        : 'enabled';
    }

    const group: RowGroup = isGlobal ? 'global' : installedAnywhere ? 'managed' : 'orphan';
    const [publisher = '', ...rest] = id.split('.');
    const fallbackName = rest.length > 0 ? rest.join('.') : id;
    rows.push({
      id,
      name: displayNames?.get(id) ?? fallbackName,
      publisher,
      group,
      cells,
    });
  }

  rows.sort(
    (a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || a.name.localeCompare(b.name),
  );
  return rows;
}

/** 各配置之间的状态是否不一致（全局共享的格子不参与比较） */
export function hasDifference(row: MatrixRow): boolean {
  const states = Object.values(row.cells).filter((s) => s !== 'global');
  if (states.length < 2) {
    return false;
  }
  return new Set(states).size > 1;
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
npm test
```

预期：全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add src/core/extensionStore.ts src/core/matrix.ts test/matrix.test.ts
git commit -m "构建扩展与配置文件的对应矩阵

Build the extension-by-profile matrix"
```

---

## Task 7: Webview 面板与消息协议

**Files:**
- Create: `src/panel/protocol.ts`
- Create: `src/panel/matrixPanel.ts`
- Create: `src/core/snapshot.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: 写 `src/panel/protocol.ts`**

```ts
import type { MatrixRow, ProfileInfo } from '../core/types';

/** 宿主推给 Webview 的完整快照 */
export interface MatrixPayload {
  profiles: ProfileInfo[];
  rows: MatrixRow[];
  /** 当前所在配置；无法判定时为 undefined */
  currentProfileLocation?: string;
  /** 内置 SQLite 是否可用（不可用时降级为不含禁用态的只读矩阵） */
  sqliteAvailable: boolean;
  /** 数据源路径，便于排错 */
  sourcePath: string;
}

export type HostToWebviewMessage =
  | { type: 'matrix'; payload: MatrixPayload }
  | { type: 'error'; message: string };

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'switchProfile'; location: string }
  | { type: 'openNativeExtensions'; extensionId: string };
```

- [ ] **Step 2: 写 `src/core/snapshot.ts`（把读取流程串起来）**

```ts
import * as path from 'path';
import { collectDisplayNames, readExtensionList } from './extensionStore';
import { buildMatrix } from './matrix';
import { resolveUserDataPaths, type UserDataPaths } from './paths';
import { readProfiles } from './profileStore';
import { isSqliteAvailable, readDisabledEntries } from './sqlite';
import { DEFAULT_PROFILE_LOCATION, type ExtensionEntry, type MatrixRow, type ProfileInfo } from './types';
import type { MatrixPayload } from '../panel/protocol';

export interface Snapshot {
  payload: MatrixPayload;
}

/** 一个配置的禁用状态库所在路径 */
export function disabledDbPath(paths: UserDataPaths, profile: ProfileInfo): string {
  return profile.isDefault
    ? path.join(paths.userDir, 'globalStorage', 'state.vscdb')
    : path.join(paths.profilesDir, profile.location, 'globalStorage', 'state.vscdb');
}

/** 一个配置的扩展清单路径 */
export function extensionListPath(paths: UserDataPaths, profile: ProfileInfo): string {
  if (profile.isDefault) {
    return path.join(paths.extensionsDir, 'extensions.json');
  }
  if (profile.isBuiltin) {
    // 内置配置（如 Agents）没有自己的清单，直接沿用默认配置的
    return path.join(paths.extensionsDir, 'extensions.json');
  }
  return path.join(paths.profilesDir, profile.location, 'extensions.json');
}

/** 读取一次完整快照 */
export function loadSnapshot(
  paths: UserDataPaths | undefined = resolveUserDataPaths(),
): Snapshot {
  if (!paths) {
    return {
      payload: {
        profiles: [],
        rows: [],
        sqliteAvailable: isSqliteAvailable(),
        sourcePath: '(未找到 VS Code 用户数据目录)',
      },
    };
  }

  const profiles = readProfiles(paths.storageJson);
  const allExtensions = readExtensionList(path.join(paths.extensionsDir, 'extensions.json'));

  const installedByProfile = new Map<string, ExtensionEntry[]>();
  const disabledByProfile = new Map<string, Set<string>>();
  for (const profile of profiles) {
    installedByProfile.set(profile.location, readExtensionList(extensionListPath(paths, profile)));
    const disabled = readDisabledEntries(disabledDbPath(paths, profile));
    disabledByProfile.set(profile.location, new Set(disabled.map((d) => d.id)));
  }

  const displayNames = collectDisplayNames(allExtensions);
  const rows: MatrixRow[] = buildMatrix({
    profiles,
    installedByProfile,
    disabledByProfile,
    allExtensions,
    displayNames,
  });

  return {
    payload: {
      profiles,
      rows,
      sqliteAvailable: isSqliteAvailable(),
      sourcePath: paths.userDir,
    },
  };
}

export { DEFAULT_PROFILE_LOCATION };
```

- [ ] **Step 3: 写 `src/panel/matrixPanel.ts`**

```ts
import * as vscode from 'vscode';
import { loadSnapshot } from '../core/snapshot';
import type { HostToWebviewMessage, WebviewToHostMessage } from './protocol';

export class MatrixPanel {
  private static current: MatrixPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToHostMessage) => void this.handleMessage(msg),
      null,
      this.disposables,
    );
    this.panel.webview.html = this.renderHtml();
    this.pushMatrix();
  }

  static show(extensionUri: vscode.Uri): MatrixPanel {
    if (MatrixPanel.current) {
      MatrixPanel.current.panel.reveal();
      MatrixPanel.current.pushMatrix();
      return MatrixPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      'profileMatrix',
      '扩展矩阵',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      },
    );
    MatrixPanel.current = new MatrixPanel(panel, extensionUri);
    return MatrixPanel.current;
  }

  private post(message: HostToWebviewMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private pushMatrix(): void {
    try {
      const { payload } = loadSnapshot();
      this.post({ type: 'matrix', payload });
    } catch (err) {
      this.post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleMessage(msg: WebviewToHostMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
      case 'refresh':
        this.pushMatrix();
        return;
      case 'switchProfile':
        await vscode.commands.executeCommand(
          `workbench.profiles.actions.profileEntry.${msg.location}`,
        );
        return;
      case 'openNativeExtensions':
        await vscode.commands.executeCommand('workbench.extensions.search', `@id:${msg.extensionId}`);
        return;
    }
  }

  private renderHtml(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'styles.css'),
    );
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${styleUri}">
<title>扩展矩阵</title>
</head>
<body>
<div id="app">正在读取配置…</div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    MatrixPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }
}
```

- [ ] **Step 4: 改 `src/extension.ts` 注册命令**

```ts
import * as vscode from 'vscode';
import { MatrixPanel } from './panel/matrixPanel';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('profileMatrix.openPanel', () => {
      MatrixPanel.show(context.extensionUri);
    }),
  );
}

export function deactivate(): void {
  // 无需要清理的资源
}
```

- [ ] **Step 5: 占位两个前端文件，保证面板能打开**

`media/styles.css`：

```css
body {
  font-family: var(--vscode-font-family);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  padding: 12px;
}
```

`media/main.js`：

```js
const vscode = acquireVsCodeApi();
const app = document.getElementById('app');

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'matrix') {
    app.textContent = `读到 ${msg.payload.profiles.length} 个配置文件、${msg.payload.rows.length} 个扩展`;
  } else if (msg.type === 'error') {
    app.textContent = `出错了：${msg.message}`;
  }
});

vscode.postMessage({ type: 'ready' });
```

- [ ] **Step 6: 构建并手工验证**

```bash
npm run build
```

按 F5 启动扩展开发宿主（或用 `code --extensionDevelopmentPath=<项目路径>`），执行命令 **Profile Matrix: 打开扩展矩阵**。

预期：面板打开，显示形如「读到 4 个配置文件、33 个扩展」。

- [ ] **Step 7: 提交**

```bash
git add src/panel src/core/snapshot.ts src/extension.ts media
git commit -m "接通 Webview 面板与消息协议

Wire up the webview panel and message protocol"
```

---

## Task 8: 矩阵渲染与交互

**Files:**
- Modify: `media/main.js`（整体替换）
- Modify: `media/styles.css`（整体替换）
- Modify: `src/panel/matrixPanel.ts`（放开资源限制已在 Task 7 完成，无需改动）

- [ ] **Step 1: 写 `media/styles.css`**

```css
:root {
  --pm-border: var(--vscode-panel-border, #3c3c3c);
  --pm-on: var(--vscode-charts-blue, #0e639c);
  --pm-off: var(--vscode-charts-orange, #c8912a);
  --pm-muted: var(--vscode-descriptionForeground, #8a8a8a);
}

body {
  font-family: var(--vscode-font-family);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  margin: 0;
  padding: 0;
}

.pm-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--pm-border);
  position: sticky;
  top: 0;
  background: var(--vscode-editor-background);
  z-index: 1;
}

.pm-bar input {
  flex: 1;
  min-width: 80px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, transparent);
  padding: 3px 8px;
}

.pm-filter {
  display: flex;
  border: 1px solid var(--pm-border);
}

.pm-filter button {
  background: transparent;
  color: var(--vscode-foreground);
  border: 0;
  padding: 3px 10px;
  cursor: pointer;
  font-size: 12px;
}

.pm-filter button[aria-pressed='true'] {
  background: var(--pm-on);
  color: #fff;
}

table {
  border-collapse: collapse;
  width: 100%;
  font-size: 12px;
}

th,
td {
  border-bottom: 1px solid var(--pm-border);
  padding: 0 8px;
  height: 30px;
  text-align: center;
  white-space: nowrap;
}

th:first-child,
td:first-child {
  text-align: left;
}

thead th {
  position: sticky;
  top: 45px;
  background: var(--vscode-editor-background);
  color: var(--pm-muted);
  font-weight: 500;
}

thead th small {
  display: block;
  font-size: 10px;
  font-weight: 400;
}

th.pm-current {
  color: var(--vscode-foreground);
  box-shadow: inset 0 -2px 0 var(--pm-on);
}

tbody tr:hover td {
  background: var(--vscode-list-hoverBackground);
}

.pm-name {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pm-badge {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  color: #fff;
  background: var(--pm-muted);
  flex: 0 0 auto;
}

.pm-sub {
  color: var(--pm-muted);
  font-size: 10px;
}

tr.pm-group td {
  background: var(--vscode-sideBar-background);
  color: var(--pm-muted);
  font-size: 11px;
  text-align: left;
  height: 24px;
}

.cell {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1px solid var(--pm-muted);
}

.cell.enabled {
  background: var(--pm-on);
  border-color: var(--pm-on);
}

.cell.disabled {
  background: repeating-linear-gradient(
    45deg,
    transparent,
    transparent 3px,
    var(--pm-off) 3px,
    var(--pm-off) 4px
  );
  border-color: var(--pm-off);
}

.cell.absent {
  background: transparent;
  border-color: var(--pm-border);
}

.cell.global {
  border-radius: 50%;
  background: transparent;
  border-color: var(--pm-border);
}

.pm-legend {
  display: flex;
  gap: 16px;
  padding: 10px 12px;
  color: var(--pm-muted);
  font-size: 11px;
}

.pm-legend span {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pm-empty {
  padding: 24px;
  color: var(--pm-muted);
}
```

- [ ] **Step 2: 写 `media/main.js`**

```js
const vscode = acquireVsCodeApi();
const app = document.getElementById('app');

let state = { payload: null, query: '', filter: 'all', collapsed: { global: true, orphan: true } };

const GROUP_LABEL = {
  managed: '由配置文件管理',
  global: '全局共享 · 不归配置文件管',
  orphan: '装了但没用上',
};

const CELL_TITLE = {
  enabled: '已启用',
  disabled: '已装但禁用',
  absent: '该配置未装',
  global: '全局共享，不随配置变化',
};

function summarize(rows, profileLocation) {
  let installed = 0;
  let disabled = 0;
  for (const row of rows) {
    const cell = row.cells[profileLocation];
    if (cell === 'enabled' || cell === 'disabled') {
      installed += 1;
      if (cell === 'disabled') {
        disabled += 1;
      }
    }
  }
  return `${installed} 装 · ${installed - disabled} 启用 · ${disabled} 禁用`;
}

function matchesFilter(row) {
  if (state.filter === 'managed') {
    return row.group === 'managed';
  }
  if (state.filter === 'diff') {
    const cells = Object.values(row.cells).filter((c) => c !== 'global');
    return new Set(cells).size > 1;
  }
  return true;
}

function matchesQuery(row) {
  if (!state.query) {
    return true;
  }
  const q = state.query.toLowerCase();
  return row.id.toLowerCase().includes(q) || row.name.toLowerCase().includes(q);
}

function renderRow(row, profiles) {
  const tr = document.createElement('tr');
  const nameTd = document.createElement('td');
  const wrap = document.createElement('div');
  wrap.className = 'pm-name';

  const badge = document.createElement('span');
  badge.className = 'pm-badge';
  badge.textContent = (row.name[0] || '?').toUpperCase();
  wrap.appendChild(badge);

  const text = document.createElement('div');
  const title = document.createElement('div');
  title.textContent = row.name;
  const sub = document.createElement('div');
  sub.className = 'pm-sub';
  sub.textContent = `${row.publisher} · ${row.id}`;
  text.appendChild(title);
  text.appendChild(sub);
  wrap.appendChild(text);
  nameTd.appendChild(wrap);
  tr.appendChild(nameTd);

  for (const profile of profiles) {
    const td = document.createElement('td');
    const cell = document.createElement('span');
    const cellState = row.cells[profile.location] || 'absent';
    cell.className = `cell ${cellState}`;
    cell.title = CELL_TITLE[cellState];
    td.appendChild(cell);
    td.addEventListener('click', () => {
      vscode.postMessage({ type: 'openNativeExtensions', extensionId: row.id });
    });
    tr.appendChild(td);
  }
  return tr;
}

function render(payload) {
  app.textContent = '';

  const bar = document.createElement('div');
  bar.className = 'pm-bar';

  const search = document.createElement('input');
  search.placeholder = '搜索扩展…';
  search.value = state.query;
  search.addEventListener('input', () => {
    state.query = search.value;
    render(state.payload);
  });
  bar.appendChild(search);

  const filters = [
    ['all', '全部'],
    ['diff', '有差异'],
    ['managed', '仅配置级'],
  ];
  const filterBox = document.createElement('div');
  filterBox.className = 'pm-filter';
  for (const [key, label] of filters) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.setAttribute('aria-pressed', String(state.filter === key));
    btn.addEventListener('click', () => {
      state.filter = key;
      render(state.payload);
    });
    filterBox.appendChild(btn);
  }
  bar.appendChild(filterBox);
  app.appendChild(bar);

  if (!payload.sqliteAvailable) {
    const warn = document.createElement('div');
    warn.className = 'pm-empty';
    warn.textContent = '当前 VS Code 版本不支持内置 SQLite，禁用状态不可见（只读模式）。';
    app.appendChild(warn);
  }

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const corner = document.createElement('th');
  corner.textContent = '扩展';
  headRow.appendChild(corner);
  for (const profile of payload.profiles) {
    const th = document.createElement('th');
    if (profile.location === payload.currentProfileLocation) {
      th.className = 'pm-current';
    }
    th.textContent = profile.name;
    const small = document.createElement('small');
    small.textContent = summarize(payload.rows, profile.location);
    th.appendChild(small);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const visible = payload.rows.filter((r) => matchesFilter(r) && matchesQuery(r));
  const groups = ['managed', 'global', 'orphan'];
  for (const group of groups) {
    const rows = visible.filter((r) => r.group === group);
    if (rows.length === 0) {
      continue;
    }
    const groupRow = document.createElement('tr');
    groupRow.className = 'pm-group';
    const groupCell = document.createElement('td');
    groupCell.colSpan = payload.profiles.length + 1;
    const arrow = state.collapsed[group] ? '▸' : '▾';
    groupCell.textContent = `${arrow} ${GROUP_LABEL[group]}（${rows.length}）`;
    groupCell.style.cursor = 'pointer';
    groupCell.addEventListener('click', () => {
      state.collapsed[group] = !state.collapsed[group];
      render(state.payload);
    });
    groupRow.appendChild(groupCell);
    tbody.appendChild(groupRow);

    if (!state.collapsed[group]) {
      for (const row of rows) {
        tbody.appendChild(renderRow(row, payload.profiles));
      }
    }
  }
  table.appendChild(tbody);
  app.appendChild(table);

  const legend = document.createElement('div');
  legend.className = 'pm-legend';
  for (const key of ['enabled', 'disabled', 'absent', 'global']) {
    const item = document.createElement('span');
    const dot = document.createElement('span');
    dot.className = `cell ${key}`;
    item.appendChild(dot);
    item.appendChild(document.createTextNode(CELL_TITLE[key]));
    legend.appendChild(item);
  }
  app.appendChild(legend);
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'matrix') {
    state.payload = msg.payload;
    render(msg.payload);
  } else if (msg.type === 'error') {
    app.textContent = `出错了：${msg.message}`;
  }
});

vscode.postMessage({ type: 'ready' });
```

- [ ] **Step 3: 构建并手工验证**

```bash
npm run build
```

按 F5 打开扩展开发宿主，运行 **Profile Matrix: 打开扩展矩阵**。

预期：
- 表头列出 默认 / STM32 / ESP32 / Agents 四列，各列下方有统计
- 默认展开「由配置文件管理」组，行内格子四态正确
- 点格子 → 打开原生扩展面板并搜索该扩展
- 「全局共享」「装了但没用上」两组默认折叠，点组头可展开
- 搜索框与筛选按钮生效

- [ ] **Step 4: 提交**

```bash
git add media
git commit -m "实现矩阵渲染与筛选交互

Render the matrix with filtering and search"
```

---

## Task 9: 配置文件切换与状态栏入口

**Files:**
- Create: `src/commands/switchProfile.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`（新增命令）

- [ ] **Step 1: 在 `package.json` 的 `contributes.commands` 增加两条**

```json
{
  "command": "profileMatrix.switchProfile",
  "title": "切换配置文件",
  "category": "Profile Matrix"
},
{
  "command": "profileMatrix.showCurrentProfile",
  "title": "显示当前配置文件",
  "category": "Profile Matrix"
}
```

- [ ] **Step 2: 写 `src/commands/switchProfile.ts`**

```ts
import * as vscode from 'vscode';
import { readProfiles } from '../core/profileStore';
import { resolveUserDataPaths } from '../core/paths';
import type { ProfileInfo } from '../core/types';

/** 读出全部配置供选择 */
export function pickProfile(): Promise<ProfileInfo | undefined> {
  const paths = resolveUserDataPaths();
  if (!paths) {
    void vscode.window.showWarningMessage('未找到 VS Code 用户数据目录，无法读取配置文件。');
    return Promise.resolve(undefined);
  }
  const profiles = readProfiles(paths.storageJson);
  return vscode.window
    .showQuickPick(
      profiles.map((p) => ({
        label: p.name,
        description: p.isDefault ? '默认配置' : p.isBuiltin ? '内置' : p.location,
        profile: p,
      })),
      { placeHolder: '选择要切换到的配置文件' },
    )
    .then((picked) => picked?.profile);
}

/** 切换到指定配置文件（VS Code 会自行重载窗口） */
export async function switchToProfile(profile: ProfileInfo): Promise<void> {
  await vscode.commands.executeCommand(
    `workbench.profiles.actions.profileEntry.${profile.location}`,
  );
}
```

- [ ] **Step 3: 在 `src/extension.ts` 注册命令与状态栏**

```ts
import * as vscode from 'vscode';
import { pickProfile, switchToProfile } from './commands/switchProfile';
import { MatrixPanel } from './panel/matrixPanel';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('profileMatrix.openPanel', () => {
      MatrixPanel.show(context.extensionUri);
    }),
    vscode.commands.registerCommand('profileMatrix.switchProfile', async () => {
      const profile = await pickProfile();
      if (profile) {
        await switchToProfile(profile);
      }
    }),
  );

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = '$(list-selection) 扩展矩阵';
  status.command = 'profileMatrix.openPanel';
  status.tooltip = '打开扩展矩阵';
  status.show();
  context.subscriptions.push(status);
}

export function deactivate(): void {
  // 无需要清理的资源
}
```

- [ ] **Step 4: 构建并手工验证**

```bash
npm run build
```

预期：状态栏出现「扩展矩阵」入口，点击打开面板；命令面板里「切换配置文件」能列出四个配置。

- [ ] **Step 5: 提交**

```bash
git add src/commands src/extension.ts package.json
git commit -m "接入配置文件切换与状态栏入口

Add profile switching and a status bar entry"
```

---

## 自查记录

**Spec 覆盖对照**（设计文档 §3 各节 → 本计划任务）：

| Spec 章节 | 对应任务 | 状态 |
|---|---|---|
| §3.1 矩阵四态、三组分组、列头统计、搜索、筛选 | Task 6（数据）+ Task 8（渲染） | 覆盖 |
| §3.2 待应用队列与备份 | **未覆盖**——依赖 Task 2 的 spike 结论，属第二期 | 计划内延后 |
| §3.3 配置文件增删改查、切换 | 切换见 Task 9；**增删改查未覆盖**（走官方命令转发，第二期） | 部分覆盖 |
| §3.4 设置差异 | 属第三期 | 计划内延后 |
| §3.5 导出/导入 | 属第三期 | 计划内延后 |
| §2.5 永不直写 storage.json | 本计划全程只读该文件 | 覆盖 |
| §6 降级路径 | Task 5（sqlite 不可用返回空）+ Task 8（UI 提示） | 覆盖 |

**类型一致性核对**：`CellState` / `RowGroup` / `MatrixRow` / `ProfileInfo` / `ExtensionEntry` 均在 Task 3 定义，Task 6、7、8 使用一致；`DISABLED_KEY` 在 Task 5 定义并被测试引用；`loadSnapshot` 的返回类型 `{ payload }` 与 Task 7 的 `MatrixPayload` 一致。
