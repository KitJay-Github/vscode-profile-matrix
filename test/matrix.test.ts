import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildMatrix, hasDifference } from '../src/core/matrix';
import { parseExtensionList, uriPathToLocal } from '../src/core/extensionStore';
import type { ExtensionEntry, ProfileInfo } from '../src/core/types';

const PROFILES: ProfileInfo[] = [
  { location: '__default__profile__', name: '默认', isDefault: true, isBuiltin: false },
  { location: '-aaa', name: 'STM32', isDefault: false, isBuiltin: false },
  { location: '-bbb', name: 'ESP32', isDefault: false, isBuiltin: false },
];

function entry(id: string, appScoped = false): ExtensionEntry {
  return { identifier: { id }, metadata: { isApplicationScoped: appScoped } };
}

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
  assert.deepEqual(parseExtensionList('这不是 JSON'), []);
});

test('parseExtensionList 对非数组返回空数组', () => {
  assert.deepEqual(parseExtensionList('{"identifier":{"id":"a.b"}}'), []);
});

test('uriPathToLocal 去掉 Windows 盘符前的斜杠', () => {
  assert.equal(uriPathToLocal('/c:/Users/x/ext'), 'c:/Users/x/ext');
  assert.equal(uriPathToLocal('/home/x/ext'), '/home/x/ext');
});

test('全局共享的扩展在所有列都是 global，且归入 global 组', () => {
  const rows = buildMatrix({
    profiles: PROFILES,
    installedByProfile: new Map([['-aaa', [entry('a.one'), entry('ms-vscode.cpptools', true)]]]),
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

test('已启用与「装了但禁用」能区分，未装为 absent', () => {
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
  assert.equal(eide?.group, 'managed');
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
  assert.equal(orphan?.cells['-aaa'], 'absent');
});

test('只出现在某个配置清单里、不在全局清单里的扩展也会被收进来', () => {
  const rows = buildMatrix({
    profiles: PROFILES,
    installedByProfile: new Map([['-aaa', [entry('only.in.profile')]]]),
    disabledByProfile: new Map(),
    allExtensions: [],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].group, 'managed');
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
    meta: new Map([['candycium.keil-assistant-new', { displayName: 'Keil Assistant' }]]),
  });
  assert.equal(rows[0].name, 'Keil Assistant');
  assert.equal(rows[0].publisher, 'candycium');
});

test('没有显示名映射时用 id 去掉发布者部分兜底', () => {
  const rows = buildMatrix({
    profiles: PROFILES,
    installedByProfile: new Map([['-aaa', [entry('candycium.keil-assistant-new')]]]),
    disabledByProfile: new Map(),
    allExtensions: [entry('candycium.keil-assistant-new')],
  });
  assert.equal(rows[0].name, 'keil-assistant-new');
  assert.equal(rows[0].publisher, 'candycium');
});

test('hasDifference 只在受管格子状态不一致时为真', () => {
  const rows = buildMatrix({
    profiles: PROFILES,
    installedByProfile: new Map([
      ['__default__profile__', [entry('a.same')]],
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

test('全局扩展不影响 hasDifference', () => {
  const rows = buildMatrix({
    profiles: PROFILES,
    installedByProfile: new Map([['-aaa', [entry('x.shared', true)]]]),
    disabledByProfile: new Map(),
    allExtensions: [entry('x.shared', true)],
  });
  assert.equal(hasDifference(rows[0]), false);
});
