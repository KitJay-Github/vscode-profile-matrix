# 写入链路 Spike 结论

**日期**：2026-09-22
**VS Code 版本**：1.138.0（commit 7debcd0e2a）
**隔离环境**：`.spike/write-test`（独立 `--user-data-dir` 与 `--extensions-dir`，全程不接触主环境）
**探针输出**：`.spike/write-test/ext/spike.profile-matrix-probe-1.0.0/probe-result.json`

## 结论：写入链路可用 ✅

把扩展 id 写进某个配置的 `extensionsIdentifiers/disabled`，**扩展在下次启动时真的不会加载**。

三组对照（须同时成立才有说服力）：

| 扩展 | 期望 | 实测 |
|---|---|---|
| `spike.profile-matrix-probe` | 可见（探针自身，证明环境跑起来了） | ✅ 可见 |
| `spike.target-control` | 可见（对照组，未写进禁用列表） | ✅ 可见 |
| `spike.target-disabled` | **不可见**（实验组，写进了禁用列表） | ✅ **不可见** |

当次可见扩展 97 个（含内置），其中 `spike.*` 只剩探针与对照组两个。

**因此**：写侧按设计文档 §3.2 的「待应用队列」实现，**不需要**降级到「跳转原生面板」。

## 踩到的坑：值必须写成 TEXT，不能写成 BLOB

第一次实验彻底失败——探针没激活，扩展宿主起来了但一个扩展都不加载。renderer.log 里反复刷同一个异常：

```
[error] Unexpected non-whitespace character after JSON at position 2
    at JSON.parse
    at s3._getExtensions
    at s3.getDisabledExtensions
    at Fvt.ensureChatExtensionInitialDisabledState
    at Fvt.disableExtension
    at new Fvt
```

**原因**：用 `db.run(key, Buffer.from(json, 'utf8'))` 写入，SQLite 类型是 **BLOB**；而 VS Code 存的是 **TEXT**，读出来直接 `JSON.parse(value)`。Buffer 被转成 `"91,123,34,..."` 这种逗号分隔的数字串，第 3 个字符正是 `,` —— 于是「position 2 处 JSON 已结束却还有非空白字符」。

比对本机真实数据确认：用户机器上该 key 的 SQLite 类型是 `text`。

**影响面比看上去大**：这个异常发生在扩展管理器初始化路径上（`ensureChatExtensionInitialDisabledState` → `disableExtension`），异常一抛整个扩展服务创建失败，**所有扩展都不激活**。初次实验里探针自己也没跑起来，一度被误判成激活事件写错了。

**对实现的要求**：
- 写入时传字符串（`JSON.stringify(...)`），**不要**包 Buffer
- 读取时两种都要能处理（TEXT 得到 string；万一遇到 BLOB 得到 Uint8Array）

## 对设计的影响

1. 设计文档 §2.2 的表结构说明须改为：value 是 **TEXT**
2. 设计文档 §8 写入侧 spike 标记完成，写侧走「待应用队列」
3. `src/core/sqlite.ts` 的 `parseDisabledValue` 已同时支持 string 与 Uint8Array，无需改动；将来加写入能力时须遵守上一条

## 复现方式

```bash
node .spike/setup.js     # 重建隔离环境：3 个自制扩展 + 禁用列表
```

然后用 `Code.exe` 启动，参数：

```
--user-data-dir <项目>/.spike/write-test/data --extensions-dir <项目>/.spike/write-test/ext
```

启动约 10 秒后探针写出结果，关闭窗口，读 `probe-result.json`。`setup.js` 每次运行都会重置隔离环境。
