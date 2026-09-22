import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { UserDataPaths } from '../src/core/paths';
import { appScopeKey, cellKey, type PendingChange } from '../src/core/pendingQueue';
import { disabledDbPath } from '../src/core/profileFiles';
import { planProfileWrites, type ProfileWriteContext } from '../src/core/writer';
import { applyChanges } from '../src/core/writer';
import { readDisabledEntries } from '../src/core/sqlite';
import type { ExtensionEntry, ProfileInfo } from '../src/core/types';

function extEntry(id: string): ExtensionEntry {
  return {
    identifier: { id, uuid: `uuid-of-${id}` },
    version: '1.0.0',
    location: { path: `/ext/${id}-1.0.0` },
    relativeLocation: `${id}-1.0.0`,
    metadata: { isApplicationScoped: false },
  };
}

const PROFILE: ProfileInfo = {
  location: '-aaa',
  name: '测试配置',
  isDefault: false,
  isBuiltin: false,
};

function ctxOf(overrides: Partial<ProfileWriteContext> = {}): ProfileWriteContext {
  return {
    profile: PROFILE,
    currentExtensions: [extEntry('a.one'), extEntry('a.two')],
    currentDisabled: new Set(['a.two']),
    globalExtensions: [extEntry('a.one'), extEntry('a.two'), extEntry('a.three')],
    extensionsJsonPath: '/tmp/x/extensions.json',
    stateDbPath: '/tmp/x/state.vscdb',
    ...overrides,
  };
}

test('禁用：只进禁用列表，清单不动', () => {
  const plan = planProfileWrites(ctxOf(), [{ extensionId: 'a.one', to: 'disabled' }]);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(
    plan.nextDisabled.map((d) => d.id).sort(),
    ['a.one', 'a.two'],
  );
  assert.equal(plan.nextExtensions.length, 2);
});

test('启用：从禁用列表移除，清单本来就有就不重复加', () => {
  const plan = planProfileWrites(ctxOf(), [{ extensionId: 'a.two', to: 'enabled' }]);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.nextDisabled, []);
  assert.equal(plan.nextExtensions.length, 2);
});

test('加入：不在清单里就从全局清单复制条目进来', () => {
  const plan = planProfileWrites(ctxOf(), [{ extensionId: 'a.three', to: 'enabled' }]);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.nextExtensions.length, 3);
  assert.ok(plan.nextExtensions.some((e) => e.identifier.id === 'a.three'));
});

test('加入一个全局清单里也没有的扩展会报错且不改清单', () => {
  const plan = planProfileWrites(ctxOf(), [{ extensionId: 'a.unknown', to: 'enabled' }]);
  assert.equal(plan.errors.length, 1);
  assert.equal(plan.nextExtensions.length, 2);
});

test('移出：从清单删除并同时清掉禁用记录', () => {
  const plan = planProfileWrites(ctxOf(), [{ extensionId: 'a.two', to: 'absent' }]);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(
    plan.nextExtensions.map((e) => e.identifier.id),
    ['a.one'],
  );
  assert.deepEqual(
    plan.nextDisabled.map((d) => d.id),
    [],
  );
});

test('移出一个本来就不在的扩展会报错', () => {
  const plan = planProfileWrites(ctxOf(), [{ extensionId: 'a.three', to: 'absent' }]);
  assert.equal(plan.errors.length, 1);
});

test('禁用列表保留 uuid', () => {
  const plan = planProfileWrites(ctxOf(), [{ extensionId: 'a.one', to: 'disabled' }]);
  const one = plan.nextDisabled.find((d) => d.id === 'a.one');
  assert.equal(one?.uuid, 'uuid-of-a.one');
});

test('不修改传入的上下文', () => {
  const ctx = ctxOf();
  planProfileWrites(ctx, [{ extensionId: 'a.one', to: 'disabled' }]);
  assert.equal(ctx.currentExtensions.length, 2);
  assert.equal(ctx.currentDisabled.size, 1);
});

// ---------- 端到端：真的写盘 ----------

function buildTempEnv(): { root: string; paths: UserDataPaths } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-writer-'));
  const userDir = path.join(root, 'User');
  const profileDir = path.join(userDir, 'profiles', '-aaa');
  const extDir = path.join(root, 'ext');

  fs.mkdirSync(path.join(profileDir, 'globalStorage'), { recursive: true });
  fs.mkdirSync(path.join(userDir, 'globalStorage'), { recursive: true });
  fs.mkdirSync(extDir, { recursive: true });

  fs.writeFileSync(
    path.join(userDir, 'globalStorage', 'storage.json'),
    JSON.stringify({ userDataProfiles: [{ location: '-aaa', name: '测试配置' }] }),
  );
  fs.writeFileSync(
    path.join(profileDir, 'extensions.json'),
    JSON.stringify([extEntry('a.one'), extEntry('a.two')]),
  );
  fs.writeFileSync(
    path.join(extDir, 'extensions.json'),
    JSON.stringify([extEntry('a.one'), extEntry('a.two'), extEntry('a.three')]),
  );

  const sqlite = require('node:sqlite');
  const db = new sqlite.DatabaseSync(path.join(profileDir, 'globalStorage', 'state.vscdb'));
  db.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);');
  db.prepare('INSERT INTO ItemTable (key,value) VALUES (?,?)').run(
    'extensionsIdentifiers/disabled',
    JSON.stringify([{ id: 'a.two' }]),
  );
  db.close();

  return {
    root,
    paths: {
      productName: 'Code',
      userDir,
      storageJson: path.join(userDir, 'globalStorage', 'storage.json'),
      profilesDir: path.join(userDir, 'profiles'),
      extensionsDir: extDir,
    },
  };
}

test('端到端：三项改动一起写盘', () => {
  const { root, paths } = buildTempEnv();
  try {
    const pending: Map<string, PendingChange> = new Map([
      [
        cellKey('-aaa', 'a.one'),
        { kind: 'cell', extensionId: 'a.one', profileLocation: '-aaa', from: 'enabled', to: 'disabled' },
      ],
      [
        cellKey('-aaa', 'a.two'),
        { kind: 'cell', extensionId: 'a.two', profileLocation: '-aaa', from: 'disabled', to: 'enabled' },
      ],
      [
        cellKey('-aaa', 'a.three'),
        { kind: 'cell', extensionId: 'a.three', profileLocation: '-aaa', from: 'absent', to: 'enabled' },
      ],
    ]);

    const outcome = applyChanges(paths, pending, 'test-stamp');
    assert.deepEqual(outcome.errors, []);
    assert.equal(outcome.applied, 3);
    assert.equal(outcome.backups.length, 2, '应当为 state.vscdb 与 extensions.json 各留一份备份');

    // 禁用列表：只有 a.one
    const dbPath = path.join(paths.userDir, 'profiles', '-aaa', 'globalStorage', 'state.vscdb');
    assert.deepEqual(
      readDisabledEntries(dbPath).map((d) => d.id),
      ['a.one'],
    );

    // 清单：a.three 被加了进来，a.one/a.two 还在
    const list = JSON.parse(
      fs.readFileSync(path.join(paths.userDir, 'profiles', '-aaa', 'extensions.json'), 'utf8'),
    ) as ExtensionEntry[];
    assert.deepEqual(
      list.map((e) => e.identifier.id).sort(),
      ['a.one', 'a.three', 'a.two'],
    );

    // 备份文件确实存在
    for (const backup of outcome.backups) {
      assert.ok(fs.existsSync(backup), `备份应当存在：${backup}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('端到端：写入的值是 TEXT 而不是 BLOB', () => {
  const { root, paths } = buildTempEnv();
  try {
    applyChanges(
      paths,
      new Map<string, PendingChange>([
        [
          cellKey('-aaa', 'a.one'),
          { kind: 'cell', extensionId: 'a.one', profileLocation: '-aaa', from: 'enabled', to: 'disabled' },
        ],
      ]),
      'test-stamp',
    );

    const sqlite = require('node:sqlite');
    const dbPath = path.join(paths.userDir, 'profiles', '-aaa', 'globalStorage', 'state.vscdb');
    const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    const row = db
      .prepare("SELECT typeof(value) t FROM ItemTable WHERE key='extensionsIdentifiers/disabled'")
      .get() as { t: string };
    db.close();
    assert.equal(row.t, 'text', '写成 BLOB 会让 VS Code 的扩展管理器初始化失败');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('端到端：不存在的配置文件被记进错误里', () => {
  const { root, paths } = buildTempEnv();
  try {
    const outcome = applyChanges(
      paths,
      new Map<string, PendingChange>([
        [
          cellKey('-does-not-exist', 'a.one'),
          { kind: 'cell', extensionId: 'a.one', profileLocation: '-does-not-exist', from: 'enabled', to: 'disabled' },
        ],
      ]),
      'test-stamp',
    );
    assert.equal(outcome.applied, 0);
    assert.equal(outcome.errors.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('备份超过保留份数时清理最旧的', () => {
  const { root, paths } = buildTempEnv();
  try {
    const change: Map<string, PendingChange> = new Map([
      [
        cellKey('-aaa', 'a.one'),
        { kind: 'cell', extensionId: 'a.one', profileLocation: '-aaa', from: 'enabled', to: 'disabled' },
      ],
    ]);
    for (let i = 1; i <= 7; i += 1) {
      applyChanges(paths, change, `stamp-${i}`);
    }
    const profileDir = path.join(paths.userDir, 'profiles', '-aaa');
    const backups = fs
      .readdirSync(path.join(profileDir, 'globalStorage'))
      .filter((n) => n.includes('.pm-backup-'));
    assert.ok(backups.length <= 5, `备份不应超过 5 份，实际 ${backups.length}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('端到端：改全局共享标记会同时写全局清单和配置清单', () => {
  const { root, paths } = buildTempEnv();
  try {
    const pending: Map<string, PendingChange> = new Map([
      [
        appScopeKey('a.one'),
        { kind: 'appScope', extensionId: 'a.one', from: false, to: true },
      ],
    ]);
    const outcome = applyChanges(paths, pending, 'scope-stamp');
    assert.deepEqual(outcome.errors, []);
    assert.equal(outcome.applied, 1);

    const read = (p: string) =>
      JSON.parse(fs.readFileSync(p, 'utf8')) as ExtensionEntry[];

    const globalList = read(path.join(paths.extensionsDir, 'extensions.json'));
    assert.equal(
      globalList.find((e) => e.identifier.id === 'a.one')?.metadata?.isApplicationScoped,
      true,
    );

    const profileList = read(path.join(paths.userDir, 'profiles', '-aaa', 'extensions.json'));
    assert.equal(
      profileList.find((e) => e.identifier.id === 'a.one')?.metadata?.isApplicationScoped,
      true,
    );

    // 其他扩展保持原值（extEntry 默认标成 false）
    assert.equal(
      globalList.find((e) => e.identifier.id === 'a.two')?.metadata?.isApplicationScoped,
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('端到端：全局共享标记已经对了就不重复写', () => {
  const { root, paths } = buildTempEnv();
  try {
    const setScoped = (v: boolean) => {
      const p = path.join(paths.extensionsDir, 'extensions.json');
      const list = JSON.parse(fs.readFileSync(p, 'utf8')) as ExtensionEntry[];
      for (const e of list) {
        if (e.identifier.id === 'a.one') {
          e.metadata = { ...e.metadata, isApplicationScoped: v };
        }
      }
      fs.writeFileSync(p, JSON.stringify(list));
    };
    setScoped(true);

    const pending: Map<string, PendingChange> = new Map([
      [
        appScopeKey('a.one'),
        { kind: 'appScope', extensionId: 'a.one', from: true, to: true },
      ],
    ]);
    const outcome = applyChanges(paths, pending, 'noop-stamp');
    // 全局清单里已经是 true，配置清单里还是 undefined，所以只应该改后者
    assert.deepEqual(outcome.errors, []);
    assert.equal(outcome.backups.length, 1, '只应按需备份真正被改动的那个文件');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('disabledDbPath 与端到端用的路径一致', () => {
  const { root, paths } = buildTempEnv();
  try {
    const expected = path.join(paths.userDir, 'profiles', '-aaa', 'globalStorage', 'state.vscdb');
    assert.equal(disabledDbPath(paths, PROFILE), path.join(expected));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
