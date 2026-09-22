// 探针扩展：激活时把「当前可见（即已启用）的扩展 id 列表」写到自身目录下的文件。
// 判定写入链路是否有效的依据：被写进禁用列表的扩展，不应出现在这个列表里。
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
