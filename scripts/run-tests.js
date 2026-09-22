// 收集 out-test 下的测试文件并交给 node:test 运行。
// 直接传目录给 node --test 在 Windows 上会被当成模块解析，故显式列举文件。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEST_DIR = 'out-test';

function collect(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collect(full));
    } else if (entry.name.endsWith('.test.js')) {
      found.push(full);
    }
  }
  return found;
}

const files = collect(TEST_DIR).sort();
if (files.length === 0) {
  console.log(`没有找到测试文件（${TEST_DIR} 下没有 *.test.js）`);
  process.exit(0);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
