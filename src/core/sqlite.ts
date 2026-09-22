import type { DisabledEntry } from './types';

/** state.vscdb 中记录被禁用扩展的 key */
export const DISABLED_KEY = 'extensionsIdentifiers/disabled';

/**
 * node:sqlite 的最小类型描述。
 * 自己声明而不依赖 @types/node 的版本，因为该模块的类型在各 Node 版本间还在变动。
 */
interface SqliteStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

interface SqliteModule {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqliteDatabase;
}

let cached: SqliteModule | null | undefined;

/**
 * 加载内置 SQLite；不可用时返回 undefined。
 * VS Code 1.128 之前（Electron 36-38 的部分版本）没有这个模块，会走到这里。
 */
export function loadSqlite(): SqliteModule | undefined {
  if (cached === undefined) {
    try {
      cached = require('node:sqlite') as SqliteModule;
    } catch {
      cached = null;
    }
  }
  return cached ?? undefined;
}

/** 当前运行时是否支持内置 SQLite */
export function isSqliteAvailable(): boolean {
  return loadSqlite() !== undefined;
}

/**
 * 把数据库里存的值解析成禁用条目（纯函数）。
 *
 * 注意：VS Code 写入的是 **TEXT**，读出来是 string。写成 BLOB 会让它读到 Buffer 并
 * 在 JSON.parse 时炸掉整个扩展管理器——详见 .spike/RESULT.md。这里对两种形态都做兼容，
 * 是为了读取外部产生的数据时更稳。
 */
export function parseDisabledValue(value: unknown): DisabledEntry[] {
  if (value === undefined || value === null) {
    return [];
  }
  const text =
    typeof value === 'string'
      ? value
      : value instanceof Uint8Array
        ? Buffer.from(value).toString('utf8')
        : String(value);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(
    (e): e is DisabledEntry =>
      !!e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string',
  );
}

/** 只读打开一个 state.vscdb，读出被禁用的扩展列表 */
export function readDisabledEntries(dbPath: string): DisabledEntry[] {
  const sqlite = loadSqlite();
  if (!sqlite) {
    return [];
  }
  let db: SqliteDatabase;
  try {
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return [];
  }
  try {
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(DISABLED_KEY) as
      | { value?: unknown }
      | undefined;
    return parseDisabledValue(row?.value);
  } catch {
    return [];
  } finally {
    try {
      db.close();
    } catch {
      // 关闭失败无需处理
    }
  }
}
