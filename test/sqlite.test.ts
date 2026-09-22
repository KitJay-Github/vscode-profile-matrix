import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DISABLED_KEY, parseDisabledValue, readDisabledEntries } from '../src/core/sqlite';

test('解析 TEXT 形式的禁用列表并保留 uuid', () => {
  const text = '[{"id":"platformio.platformio-ide","uuid":"9d96b65c"}]';
  assert.deepEqual(parseDisabledValue(text), [
    { id: 'platformio.platformio-ide', uuid: '9d96b65c' },
  ]);
});

test('解析 BLOB 形式的禁用列表（防御性：正常写入是 TEXT）', () => {
  const buf = new Uint8Array(Buffer.from('[{"id":"github.copilot-chat"}]', 'utf8'));
  assert.deepEqual(parseDisabledValue(buf), [{ id: 'github.copilot-chat' }]);
});

test('空值返回空列表', () => {
  assert.deepEqual(parseDisabledValue(undefined), []);
  assert.deepEqual(parseDisabledValue(null), []);
});

test('非数组 JSON 返回空列表', () => {
  assert.deepEqual(parseDisabledValue('{"not":"array"}'), []);
});

test('损坏的 JSON 返回空列表而不抛异常', () => {
  assert.deepEqual(parseDisabledValue('[{坏数据'), []);
});

test('缺少 id 的条目被过滤，id 非字符串的也被过滤', () => {
  assert.deepEqual(parseDisabledValue('[{"uuid":"x"},{"id":123},{"id":"ok.ext"}]'), [
    { id: 'ok.ext' },
  ]);
});

test('从真实 SQLite 文件读取（TEXT 写入）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'));
  try {
    const dbPath = path.join(dir, 'state.vscdb');
    const sqlite = require('node:sqlite');
    const db = new sqlite.DatabaseSync(dbPath);
    db.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);');
    db.prepare('INSERT INTO ItemTable (key,value) VALUES (?,?)').run(
      DISABLED_KEY,
      JSON.stringify([{ id: 'cl.eide' }, { id: 'spike.target-disabled' }]),
    );
    db.close();

    assert.deepEqual(readDisabledEntries(dbPath), [
      { id: 'cl.eide' },
      { id: 'spike.target-disabled' },
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('表中没有该 key 时返回空列表', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'));
  try {
    const dbPath = path.join(dir, 'state.vscdb');
    const sqlite = require('node:sqlite');
    const db = new sqlite.DatabaseSync(dbPath);
    db.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);');
    db.close();

    assert.deepEqual(readDisabledEntries(dbPath), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('文件不存在时返回空列表', () => {
  assert.deepEqual(readDisabledEntries(path.join(os.tmpdir(), '不存在的-db-xyz.vscdb')), []);
});

test('不是 SQLite 文件时返回空列表', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'));
  try {
    const bogus = path.join(dir, 'state.vscdb');
    fs.writeFileSync(bogus, '这不是一个 SQLite 文件');
    assert.deepEqual(readDisabledEntries(bogus), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
