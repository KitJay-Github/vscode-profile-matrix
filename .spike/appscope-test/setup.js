// 验证：改 extensions.json 里条目的 metadata.isApplicationScoped，VS Code 认不认。
//
// 做法：拿两个真实扩展做对照——一个是 app-scoped（跨配置继承），一个不是。
// 扩展目录用 junction 软链到真实的扩展目录，所以不复制文件、也碰不到原数据；
// extensions.json 是本目录里的副本，随便改。
//
// 用法：node setup.js [false|true] [--keep]
//   参数是要把 app-scoped 那个扩展的标记改成什么，默认保持原样。
const fs = require('fs');
const path = require('path');

const USER_EXT = 'C:/Users/22859/.vscode/extensions';
const ROOT = path.resolve(__dirname);
const EXT = path.join(ROOT, 'ext');
const DATA = path.join(ROOT, 'data');

/** 这个在真实数据里 isApplicationScoped 为 true */
const APP_SCOPED_ID = 'ms-vscode.cpptools';
/** 这个为 false */
const PLAIN_ID = 'dbaeumer.vscode-eslint';
/** 被改写的那个标记；不传就保持真实数据里的值 */
const override = process.argv[2];
const keep = process.argv.includes('--keep');

console.log('override =', override ?? '(不改，保持原值)');

// --- 清理并重建扩展目录 ---
fs.rmSync(EXT, { recursive: true, force: true, maxRetries: 3 });
fs.mkdirSync(EXT, { recursive: true });

const globalList = JSON.parse(fs.readFileSync(path.join(USER_EXT, 'extensions.json'), 'utf8'));
const entries = [];

for (const id of [APP_SCOPED_ID, PLAIN_ID]) {
  const entry = globalList.find((e) => e.identifier.id === id);
  if (!entry) {
    console.error(`找不到扩展 ${id}，先确认它已安装`);
    process.exit(1);
  }
  const dirName = entry.relativeLocation;
  const target = path.join(USER_EXT, dirName);
  if (!fs.existsSync(target)) {
    console.error(`扩展目录不存在：${target}`);
    process.exit(1);
  }
  fs.symlinkSync(target, path.join(EXT, dirName), 'junction');

  const copy = { ...entry, metadata: { ...entry.metadata } };
  if (id === APP_SCOPED_ID && override) {
    copy.metadata.isApplicationScoped = override === 'true';
  }
  entries.push(copy);
  console.log(
    `已链接 ${id} → isApplicationScoped=${copy.metadata.isApplicationScoped}`,
  );
}

fs.writeFileSync(path.join(EXT, 'extensions.json'), JSON.stringify(entries, null, 4));

// --- 用户数据目录：一个空清单的配置 ---
if (!keep) {
  fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 3 });
}
const profileDir = path.join(DATA, 'User', 'profiles', '-testprof');
fs.mkdirSync(path.join(profileDir, 'globalStorage'), { recursive: true });
fs.mkdirSync(path.join(DATA, 'User', 'globalStorage'), { recursive: true });
fs.writeFileSync(
  path.join(DATA, 'User', 'globalStorage', 'storage.json'),
  JSON.stringify({ userDataProfiles: [{ location: '-testprof', name: 'TestProf' }] }, null, 4),
);
// 刻意留空：这样出现的任何扩展都只能是「跨配置继承」来的
fs.writeFileSync(path.join(profileDir, 'extensions.json'), '[]');

console.log();
console.log('隔离环境就绪：', ROOT);
console.log('  扩展目录：', EXT);
console.log('  TestProf 清单：空');
console.log('  预期：app-scoped 的那个会冒出来，另一个不会');
