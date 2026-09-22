# Profile Matrix — 设计文档

**日期**：2026-09-22
**状态**：设计已确认，进入实现
**项目**：VS Code 扩展，用 UI 管理配置文件（Profiles）与扩展的对应关系

---

## 1. 背景与目标

### 1.1 要解决的问题

VS Code 自 1.75 起内置了 Profiles（配置文件），但原生 UI 在「管理扩展与配置文件的对应关系」上非常弱：

| 痛点 | 表现 |
|---|---|
| **看不到全局** | 不知道某个扩展在哪些配置文件里启用/禁用，只能挨个切过去查 |
| **改起来费劲** | 原生 UI 只能一个个点启用/禁用，无法批量操作 |
| **复制/同步难** | 想把一个配置文件的扩展方案套用到另一个，没有手段 |

### 1.2 目标

提供一个**矩阵式界面**，一眼看清「扩展 × 配置文件」的完整关系，支持批量修改、方案对比与复制。

### 1.3 非目标（本期不做）

- 不替代原生配置文件切换器（只提供入口）
- 不管理 VS Code 之外的配置
- 不做配置文件的云同步

---

## 2. 关键技术约束（全部经实测/源码验证）

> 这一节是实现的地基。所有结论都在本机 VS Code 1.138.0 上实测或对照 VS Code 源码确认。

### 2.1 官方 API 完全缺失

| 想要的 | 现状 |
|---|---|
| Profile 相关 API | **不存在**。请求 issue #211890 于 2025-12 关闭为 *not planned* |
| 启用/禁用扩展 API | **不存在**。issue #15466 于 2020-11 关闭为"不计划实现" |
| `vscode.extensions.all` | 只含**已启用**的扩展；禁用的返回 undefined，无法区分"禁用"与"未安装" |
| 内部命令 `extensions.disableGlobally` 等 | **对扩展调用是静默 no-op**——源码中 action 的 run() 首行即 `if (!this.extension) { return; }`，参数被忽略 |

**结论**：必须绕开 API，直接读写 VS Code 的数据文件。

### 2.2 数据存储位置与格式（Windows，macOS/Linux 路径不同但结构一致）

用户数据根：`%APPDATA%/Code/User/`

| 内容 | 位置 | 格式 |
|---|---|---|
| 配置文件注册表 | `globalStorage/storage.json` → `userDataProfiles` | JSON 数组，元素 `{location, name, icon?, useDefaultFlags?}` |
| 配置文件与工作区的关联 | 同上 → `profileAssociations.workspaces` | `{工作区URI: profileId}` |
| 某配置装了哪些扩展 | `profiles/<location>/extensions.json` | JSON 数组，元素 `{identifier:{id,uuid}, version, location, relativeLocation, metadata}` |
| 某配置禁用了哪些扩展 | `profiles/<location>/globalStorage/state.vscdb` → key `extensionsIdentifiers/disabled` | SQLite `ItemTable(key TEXT UNIQUE, value BLOB)`，value 是 `[{"id":..,"uuid":..}]` |
| 默认 Profile | 无独立目录，数据就在 `User/` 根下；其 id 恒为 `__default__profile__` | — |
| 全局扩展安装索引 | `~/.vscode/extensions/extensions.json` | 同时是默认 profile 的扩展清单 |

**注意事项**：
- `location` 是相对 `profiles/` 的**目录名**（形如 `-19496b3a`，由 `hash(uuid).toString(16)` 生成，与名称无关），**不是** profile 名称
- `userDataProfiles` 中**没有 id 字段**
- 内置 profile `Agents` 的 location 是 `builtin/agents`，`useDefaultFlags` 全 true

### 2.3 扩展在矩阵中的四种状态

一个扩展在某个配置文件里的状态，由「是否全局共享」「是否在该配置的清单里」「是否在禁用列表里」三个因素决定：

| 状态 | 判定条件 | 可操作性 |
|---|---|---|
| **全局共享** | `metadata.isApplicationScoped === true` | **不可操作**，所有配置文件都一样 |
| **归属某配置且启用** | 在该配置的 `extensions.json` 中，且不在 `disabled` 列表 | 可禁用 |
| **归属某配置但禁用** | 在该配置的 `extensions.json` 中，且在 `disabled` 列表 | 可启用 |
| **该配置未装** | 不在 `extensions.json` 中 | 可安装（需下载） |

> **实测依据**：隔离实例测试中，`isApplicationScoped: true` 的 10 个扩展恒出现在所有 profile 的扩展列表里，与 profile 自身的 `extensions.json` 无关。

### 2.4 读写时机（写入侧的核心约束）

VS Code 源码 `src/vs/base/parts/storage/node/storage.ts`：

```ts
get onDidChangeItemsExternal() { return Event.None; }
// since we are the only client, there can be no external changes
```

- 主进程把所有 profile 的存储**缓存在内存**，按进程生命周期持有（`storageMainService.ts` 的 `mapProfileToStorage`，仅在退出或删 profile 时 close）
- **Reload Window 只重建渲染进程，主进程缓存仍在**
- 后果：外部改文件 → VS Code 看不见；下次写盘时还会用内存旧值**覆盖**

**结论**：
- **读**：随时可读，无限制
- **写**：必须在 VS Code **完全退出**后进行才可靠；「应用」按钮的语义是"写入磁盘，退出后生效"，**不是**立即生效
- 修改**非当前** profile 的文件风险较低（该 profile 的存储未被加载），修改**当前** profile 风险高

### 2.5 严禁直接写 storage.json

写坏 JSON 会让 `userDataProfiles` 解析失败，进而触发 `UserDataProfilesService.cleanUp()` —— 它会**物理删除 `profiles/` 下所有不在注册表中的目录**（仅豁免 `builtin`），即整个配置文件的数据全部丢失。

**因此**：配置文件的创建/删除/重命名一律走官方命令（`workbench.profiles.actions.*`），绝不手写这个文件。

---

## 3. 功能设计

### 3.1 主界面：扩展矩阵（核心）

**形态**：编辑器区 Webview 面板，顶部 Tab 导航（选定方案 A）。

```
┌──────────────────────────────────────────────────┐
│ 扩展配置管理                    当前：Python 开发  │
├──────────────────────────────────────────────────┤
│ [扩展矩阵]  设置差异 ③  配置文件                  │
├──────────────────────────────────────────────────┤
│ [搜索…]  [全部|有差异|仅配置级]      [批量 ▾]     │
│ ┌──────────────────────────────────────────────┐ │
│ │ 扩展          │ STM32      │ ESP32           │ │
│ │ ▾ 由配置文件管理 (14)                        │ │
│ │   Keil Assistant │ ■ 启用  │ □ 未装         │ │
│ │   PlatformIO     │ □ 未装  │ ▨ 已装·禁用    │ │
│ │ ▸ 全局共享 (10)   每个配置都一样，点不动      │ │
│ │ ▸ 装了但没用上 (5) 白占磁盘                   │ │
│ └──────────────────────────────────────────────┘ │
│ ● 2 项改动待应用 · 需完全退出 VS Code 后生效 [应用]│
└──────────────────────────────────────────────────┘
```

**关键设计**：
- **行**：扩展；**列**：配置文件
- **格子四态**：启用（蓝色实心）/ 已装但禁用（橙色）/ 未装（空框）/ 全局共享（灰点，不可点）
- **三组分组**：由配置文件管理 / 全局共享 / 装了但没用上（后两组默认折叠）
- **列头统计**：`22 装 · 21 启用 · 1 禁用`
- **筛选器**：全部 / 有差异 / 仅配置级（有差异 = 各列状态不一致的行）
- **搜索**：按扩展名或 id 模糊匹配
- **批量操作**：整列全选/全不选、按选中行跨列操作

**行高 30px，带扩展图标与发布者**（选定方案「精致克制」）。

### 3.2 生效机制：待应用队列

由于写入必须等 VS Code 退出（见 2.4），所有改动进入**待应用队列**：

1. 用户点格子 → 改动入队，格子显示为"待应用"样式（橙色半透明）
2. 底部提示条显示 `N 项改动待应用`
3. 点「应用」→ 备份目标文件 → 写入 → 提示"已写入，需完全退出 VS Code 后生效"
4. 提供「撤销」清空队列

**备份策略**：每次应用前把受影响的 `state.vscdb` 复制为 `<原名>.pm-backup-<时间戳>`，保留最近 5 份。

**对当前 profile 的特殊处理**：检测目标是否为当前 profile（通过 `profileAssociations` + 启动参数推断）。若是，额外警告"修改当前配置文件有被覆盖的风险，建议切到其他配置文件后再修改"。

### 3.3 配置文件管理

| 操作 | 实现 |
|---|---|
| 列出所有配置文件 | 读 `storage.json` 的 `userDataProfiles` + 默认 profile |
| 当前是哪个 | 综合 `profileAssociations.workspaces`（当前工作区）与 `emptyWindows` 推断；无法确定时显示"未知" |
| 新建 / 复制 / 重命名 / 删除 | **调用官方命令** `workbench.profiles.actions.createProfile` / `createFromCurrentProfile` / `manageProfiles`，插件只负责跳转，不做文件操作（见 2.5） |
| 切换 | `workbench.profiles.actions.profileEntry.<location>`（动态注册命令，**免弹窗**；默认 profile 为 `profileEntry.__default__profile__`） |
| 导出 / 导入 | 见 3.5 |

### 3.4 设置差异

- 数据源：各 profile 的 `settings.json` 与默认 profile 的 `User/settings.json`
- 视图：`key × 配置文件` 的差异表，只显示有差异的键，高亮不同值
- 写入：改**当前** profile 用官方 API `workspace.getConfiguration().update(k, v, ConfigurationTarget.Global)`（立即生效）；改其他 profile 进入待应用队列（写文件）
- 本期只做**查看与对比**，跨 profile 同步作为增强项

### 3.5 导出 / 导入

- **格式**：插件自有 JSON（不是 VS Code 的 `.code-profile`）
- **导出内容**：选定的 profile 的「扩展方案」（id + 启用状态）+ 可选的 settings 快照
- **导入**：读取文件 → 预览差异 → 应用到目标 profile（进入待应用队列）
- 用途：备份、团队分享、跨机器迁移

---

## 4. 架构

```
src/
  extension.ts              插件入口，注册命令与面板
  core/
    paths.ts               VS Code 用户目录探测（多平台、多发行版）
    profileStore.ts        读 storage.json：配置文件列表、当前配置
    extensionStore.ts      读 extensions.json + state.vscdb，产出矩阵数据
    sqlite.ts              node:sqlite 封装（只读打开、事务写入）
    appScoped.ts           全局扩展判定与依赖闭包展开
    pendingQueue.ts        待应用队列 + 备份 + 应用
    types.ts               共享类型
  commands/
    openPanel.ts           打开矩阵面板
    switchProfile.ts       切换配置文件
    profileActions.ts      增删改查（转发官方命令）
    exportImport.ts        导出/导入
  panel/
    matrixPanel.ts         Webview 面板管理、消息路由
    protocol.ts            插件 ↔ Webview 消息协议定义
media/
  main.js                  Webview 前端逻辑
  styles.css               样式（沿用 VS Code 主题变量）
  icons/                   扩展图标缓存
```

**模块边界**：
- `core/*` 纯数据层，不依赖 vscode API（除了 logger/config），可独立单测
- `panel/*` 负责 UI 与消息路由，不直接碰文件系统
- `commands/*` 面向用户的入口

**Webview 通信**：`postMessage` 单向消息 + `requestId` 请求响应模式；协议定义在 `protocol.ts`，两端共享 TypeScript 类型。

---

## 5. 技术栈

| 项 | 选择 | 理由 |
|---|---|---|
| 语言 | TypeScript | 与项目既有风格一致 |
| 构建 | esbuild | 快，用户既有项目（Translation For VS Code）同款 |
| SQLite | **`node:sqlite`（内置）** | 零依赖。实测 VS Code 1.138.0 的扩展宿主（Node 24.18.1）可直接 `require('node:sqlite')` |
| Webview | 原生 HTML/CSS/JS（无框架） | 体积小，避免打包复杂度；矩阵渲染用原生 DOM |
| 最低 VS Code 版本 | **1.128** | `node:sqlite` 需 Electron 42 / Node 24；更早版本降级为"只读矩阵 + 跳转原生 UI" |
| 发布 | Marketplace，publisher 待定 | 竞品均使用同类非公开机制，合规上可行 |

**兼容性降级**：启动时检测 `process.versions.node`，若 `node:sqlite` 不可用（老版本 VS Code），自动降级为只读模式并在 UI 顶部提示。

---

## 6. 风险与降级路径

| 风险 | 影响 | 应对 |
|---|---|---|
| VS Code 内部格式变更 | 读写失败 | 启动自检 + 解析失败时友好报错；数据层全隔离便于快速适配 |
| 写入被内存缓存覆盖 | 改动不生效 | 明确提示"需完全退出"；提供备份与恢复 |
| `node:sqlite` 不可用 | 无法读禁用状态 | 降级只读矩阵（不含禁用态）+ 跳转原生 UI |
| 官方命令 ID 变更 | 配置文件增删改查失效 | 命令调用失败时降级为"打开配置文件管理页" |
| 用户数据损坏 | 严重 | **永不直写 storage.json**；所有写入前自动备份；只做原子写（临时文件 + rename） |

**降级底线**：即使所有写入路径全部失效，只读矩阵 + 一键跳转原生 UI 仍然成立，已能解决「看不到全局」这一最大痛点。

---

## 7. 分期

**第一期（MVP）**
1. 数据层：读配置文件列表 + 各配置扩展清单 + 禁用状态
2. 矩阵面板：四态渲染、三组分组、搜索、筛选
3. 一键跳转：切换配置文件、打开原生扩展面板
4. 写入链路验证 spike（**第一个任务**，见下）

**第二期**
5. 待应用队列 + 备份 + 应用
6. 批量操作、方案复制（配置间同步）

**第三期**
7. 设置差异视图
8. 导出 / 导入
9. 图标缓存、性能优化（大量扩展时虚拟滚动）

---

## 8. 实现前必须完成的 spike

**任务**：验证写入链路真实生效。

**方法**：
1. 在 `.spike/iso-data` 隔离环境中构造：一个 profile + 一个扩展 + 一条 `disabled` 记录
2. 写一个最小探针扩展（激活时把 `vscode.extensions.all` 的 id 列表写入文件）
3. 用 `code --user-data-dir=.spike/iso-data --profile <测试配置>` 启动隔离实例
4. 检查探针输出：被标记为 disabled 的扩展是否**不在** `extensions.all` 中

**判定**：若不在 → 写入链路成立，按 §3.2 实现；若仍在 → 禁用状态改文件无效，写侧降级为「安装/卸载路径」（官方命令 `workbench.extensions.installExtension` / `uninstallExtension`）+ 跳转原生 UI。

**当前状态**：读侧已实测通过；写侧待此 spike 验证。
