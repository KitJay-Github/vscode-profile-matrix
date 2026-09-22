import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as path from 'path';
import { parseExtensionMeta } from '../src/core/extensionStore';

test('取 displayName 与图标的绝对路径', () => {
  const meta = parseExtensionMeta(
    JSON.stringify({ name: 'foo', displayName: 'Foo Bar', icon: 'res/icon.png' }),
    '/ext/foo-1.0.0',
    () => true,
  );
  assert.equal(meta.displayName, 'Foo Bar');
  assert.equal(meta.iconPath, path.join('/ext/foo-1.0.0', 'res/icon.png'));
});

test('未替换的 %占位符% 退回包名', () => {
  // VS Code 会把 %name% 替换成本地化文案，这里没有 nls 表，不能把占位符显示给用户
  const meta = parseExtensionMeta(
    JSON.stringify({ name: 'hexeditor', displayName: '%name%' }),
    '/ext/x',
    () => true,
  );
  assert.equal(meta.displayName, 'hexeditor');
});

test('没有 displayName 时用包名', () => {
  const meta = parseExtensionMeta(JSON.stringify({ name: 'plain' }), '/ext/x', () => true);
  assert.equal(meta.displayName, 'plain');
});

test('图标文件不存在时不给 iconPath', () => {
  const meta = parseExtensionMeta(
    JSON.stringify({ name: 'x', icon: 'missing.png' }),
    '/ext/x',
    () => false,
  );
  assert.equal(meta.iconPath, undefined);
});

test('没有 icon 字段时不给 iconPath', () => {
  const meta = parseExtensionMeta(JSON.stringify({ name: 'x' }), '/ext/x', () => true);
  assert.equal(meta.iconPath, undefined);
});

test('icon 为空字符串时不给 iconPath', () => {
  const meta = parseExtensionMeta(JSON.stringify({ name: 'x', icon: '' }), '/ext/x', () => true);
  assert.equal(meta.iconPath, undefined);
});

test('损坏的 package.json 返回空对象', () => {
  assert.deepEqual(parseExtensionMeta('{坏', '/ext/x', () => true), {});
});

test('既没有 displayName 也没有 name 时不给名称', () => {
  const meta = parseExtensionMeta(JSON.stringify({}), '/ext/x', () => true);
  assert.equal(meta.displayName, undefined);
});
