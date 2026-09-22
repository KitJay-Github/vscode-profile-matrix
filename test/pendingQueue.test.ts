import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  cellKey,
  groupByProfile,
  nextCellState,
  toPayloadMap,
  togglePending,
} from '../src/core/pendingQueue';

test('点击后的目标状态', () => {
  assert.equal(nextCellState('enabled'), 'disabled');
  assert.equal(nextCellState('disabled'), 'enabled');
  assert.equal(nextCellState('absent'), 'enabled');
  assert.equal(nextCellState('global'), undefined);
});

test('点击加入队列，再点撤销', () => {
  const empty = new Map();
  const once = togglePending(empty, 'a.one', '-aaa', 'enabled');
  assert.equal(once.size, 1);
  assert.deepEqual(once.get(cellKey('-aaa', 'a.one')), {
    extensionId: 'a.one',
    profileLocation: '-aaa',
    from: 'enabled',
    to: 'disabled',
  });

  const twice = togglePending(once, 'a.one', '-aaa', 'enabled');
  assert.equal(twice.size, 0);
});

test('原始状态不改变已有改动', () => {
  // 第二次点击时传入的 current 是新状态，但撤销仍然按 key 生效
  const once = togglePending(new Map(), 'a.one', '-aaa', 'absent');
  assert.equal(once.get(cellKey('-aaa', 'a.one'))?.to, 'enabled');
  const twice = togglePending(once, 'a.one', '-aaa', 'enabled');
  assert.equal(twice.size, 0);
});

test('全局共享的扩展点不动', () => {
  const result = togglePending(new Map(), 'ms-vscode.cpptools', '-aaa', 'global');
  assert.equal(result.size, 0);
});

test('不同配置文件互不干扰', () => {
  let pending = togglePending(new Map(), 'a.one', '-aaa', 'enabled');
  pending = togglePending(pending, 'a.one', '-bbb', 'absent');
  assert.equal(pending.size, 2);
  assert.equal(pending.get(cellKey('-aaa', 'a.one'))?.to, 'disabled');
  assert.equal(pending.get(cellKey('-bbb', 'a.one'))?.to, 'enabled');
});

test('不改动传入的 Map', () => {
  const original = new Map();
  togglePending(original, 'a.one', '-aaa', 'enabled');
  assert.equal(original.size, 0);
});

test('转成给页面的扁平表', () => {
  const pending = togglePending(new Map(), 'a.one', '-aaa', 'enabled');
  assert.deepEqual(toPayloadMap(pending), { '-aaa|a.one': 'disabled' });
});

test('按配置文件分组', () => {
  let pending = togglePending(new Map(), 'a.one', '-aaa', 'enabled');
  pending = togglePending(pending, 'a.two', '-aaa', 'absent');
  pending = togglePending(pending, 'a.three', '-bbb', 'enabled');

  const grouped = groupByProfile(pending);
  assert.equal(grouped.size, 2);
  assert.equal(grouped.get('-aaa')?.length, 2);
  assert.equal(grouped.get('-bbb')?.length, 1);
});
