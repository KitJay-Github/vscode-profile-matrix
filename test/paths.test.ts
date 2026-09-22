import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  candidateUserDataRoots,
  EXT_DIR_BY_PRODUCT,
  resolveUserDataPaths,
} from '../src/core/paths';

test('Windows 候选目录来自 APPDATA', () => {
  const roots = candidateUserDataRoots(
    'win32',
    { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' },
    'C:\\Users\\x',
  );
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
  assert.ok(roots.length > 0);
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
  assert.equal(paths.productName, 'Code');
  assert.equal(paths.userDir, '/home/x/.config/Code/User');
  assert.equal(paths.storageJson, '/home/x/.config/Code/User/globalStorage/storage.json');
  assert.equal(paths.profilesDir, '/home/x/.config/Code/User/profiles');
  assert.equal(paths.extensionsDir, '/home/x/.vscode/extensions');
});

test('resolveUserDataPaths 跳过不存在的发行版', () => {
  const existing = new Set(['/home/x/.config/VSCodium/User/globalStorage/storage.json']);
  const paths = resolveUserDataPaths('linux', {}, '/home/x', (p) => existing.has(p));
  assert.equal(paths?.productName, 'VSCodium');
  assert.equal(paths?.extensionsDir, '/home/x/.vscode-oss/extensions');
});

test('resolveUserDataPaths 找不到时返回 undefined', () => {
  assert.equal(resolveUserDataPaths('linux', {}, '/home/x', () => false), undefined);
});

test('扩展目录按发行版区分', () => {
  assert.equal(EXT_DIR_BY_PRODUCT['Code'], '.vscode');
  assert.equal(EXT_DIR_BY_PRODUCT['Code - Insiders'], '.vscode-insiders');
  assert.equal(EXT_DIR_BY_PRODUCT['VSCodium'], '.vscode-oss');
});
