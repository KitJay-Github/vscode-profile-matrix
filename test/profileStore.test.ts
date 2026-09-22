import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DEFAULT_PROFILE_LOCATION } from '../src/core/types';
import { parseProfiles } from '../src/core/profileStore';

test('默认配置恒在列表首位', () => {
  const profiles = parseProfiles('{}');
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].location, DEFAULT_PROFILE_LOCATION);
  assert.equal(profiles[0].isDefault, true);
  assert.equal(profiles[0].isBuiltin, false);
});

test('解析真实形状的注册表', () => {
  const text = JSON.stringify({
    telemetry: { machineId: 'x' },
    userDataProfiles: [
      { location: '-19496b3a', name: 'STM32', icon: 'chip', useDefaultFlags: {} },
      { location: '-740a190f', name: 'ESP32', icon: 'copilot' },
      { location: 'builtin/agents', name: 'Agents', useDefaultFlags: { settings: true } },
    ],
  });
  const profiles = parseProfiles(text);
  assert.equal(profiles.length, 4);
  assert.deepEqual(
    profiles.map((p) => p.name),
    ['默认', 'STM32', 'ESP32', 'Agents'],
  );
  const agents = profiles.find((p) => p.name === 'Agents');
  assert.equal(agents?.isBuiltin, true);
  const stm32 = profiles.find((p) => p.name === 'STM32');
  assert.equal(stm32?.icon, 'chip');
  assert.equal(stm32?.isBuiltin, false);
  assert.equal(stm32?.isDefault, false);
});

test('非法 JSON 只返回默认配置', () => {
  const profiles = parseProfiles('{ 这不是 JSON');
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].isDefault, true);
});

test('userDataProfiles 不是数组时只返回默认配置', () => {
  const profiles = parseProfiles(JSON.stringify({ userDataProfiles: 'oops' }));
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].isDefault, true);
});

test('缺少 location 的条目被丢弃', () => {
  const text = JSON.stringify({
    userDataProfiles: [{ name: '坏数据' }, { location: '-ok1', name: '正常' }],
  });
  const profiles = parseProfiles(text);
  assert.deepEqual(
    profiles.map((p) => p.name),
    ['默认', '正常'],
  );
});

test('缺少 name 时用 location 兜底', () => {
  const text = JSON.stringify({ userDataProfiles: [{ location: '-abc123' }] });
  const profiles = parseProfiles(text);
  assert.equal(profiles[1].name, '-abc123');
});

test('location 为空字符串的条目被丢弃', () => {
  const text = JSON.stringify({ userDataProfiles: [{ location: '', name: '空' }] });
  assert.equal(parseProfiles(text).length, 1);
});
