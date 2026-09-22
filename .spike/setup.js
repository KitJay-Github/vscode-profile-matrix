// 构造写入链路验证用的隔离环境（可重复运行，每次重置）：
//   .spike/write-test/ext   隔离的扩展目录，放 3 个自制扩展
//   .spike/write-test/data  隔离的用户数据目录，默认配置里带上禁用列表
//
// 三个扩展：探针本身 + 实验组（将被禁用）+ 对照组（保持启用）。
// 一次启动即可同时拿到实验组与对照组的结果，结论无歧义。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, 'write-test');
const EXT = path.join(ROOT, 'ext');
const DATA = path.join(ROOT, 'data');

const PROBE_ID = 'spike.profile-matrix-probe';
const EXPERIMENT = 'spike.target-disabled';
const CONTROL = 'spike.target-control';
const ALL = [PROBE_ID, EXPERIMENT, CONTROL];

// 1) 探针扩展：从源文件整份复制
const probeDir = path.join(EXT, `${PROBE_ID}-1.0.0`);
fs.mkdirSync(probeDir, { recursive: true });
fs.copyFileSync(
  path.join(__dirname, 'probe-extension', 'package.json'),
  path.join(probeDir, 'package.json'),
);
fs.copyFileSync(
  path.join(__dirname, 'probe-extension', 'extension.js'),
  path.join(probeDir, 'extension.js'),
);

// 2) 两个靶子扩展：激活时什么都不做，只求被加载
const stub = 'exports.activate = function () {};';
for (const id of [EXPERIMENT, CONTROL]) {
  const [publisher, name] = id.split('.');
  const dir = path.join(EXT, `${id}-1.0.0`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name,
        publisher,
        version: '1.0.0',
        engines: { vscode: '^1.128.0' },
        main: './extension.js',
        activationEvents: ['*'],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(dir, 'extension.js'), stub);
}

// 3) 扩展目录的清单（默认配置的扩展清单就是这个文件）
const toUriPath = (p) => {
  const s = path.resolve(p).replace(/\\/g, '/');
  return `/${s.charAt(0).toLowerCase()}${s.slice(1)}`;
};
fs.writeFileSync(
  path.join(EXT, 'extensions.json'),
  JSON.stringify(
    ALL.map((id) => ({
      identifier: { id, uuid: '00000000-0000-0000-0000-000000000000' },
      version: '1.0.0',
      location: { $mid: 1, path: toUriPath(path.join(EXT, `${id}-1.0.0`)), scheme: 'file' },
      relativeLocation: `${id}-1.0.0`,
      metadata: {
        isApplicationScoped: false,
        isMachineScoped: false,
        isBuiltin: false,
        source: 'vsix',
      },
    })),
    null,
    4,
  ),
);

// 4) 默认配置的禁用列表：只放实验组
const globalStorage = path.join(DATA, 'User', 'globalStorage');
fs.mkdirSync(globalStorage, { recursive: true });
const sqlite = require('node:sqlite');
const dbPath = path.join(globalStorage, 'state.vscdb');
fs.rmSync(dbPath, { force: true });
const db = new sqlite.DatabaseSync(dbPath);
db.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);');
// 必须以 TEXT 写入：VS Code 用的是 TEXT 类型，读出来直接 JSON.parse。
// 写成 BLOB 会被读成 Buffer，JSON.parse(Buffer) 得到 "91,123,..." 这种数字串并抛错，
// 进而让扩展管理器初始化失败、所有扩展都不激活。
db.prepare('INSERT INTO ItemTable (key,value) VALUES (?,?)').run(
  'extensionsIdentifiers/disabled',
  JSON.stringify([{ id: EXPERIMENT }]),
);
db.close();

console.log('隔离环境已就绪:', ROOT);
console.log('  扩展目录:', EXT, `(${ALL.length} 个扩展)`);
console.log('  实验组(已禁用):', EXPERIMENT);
console.log('  对照组(已启用):', CONTROL);
console.log('  探针结果将写到:', path.join(probeDir, 'probe-result.json'));
