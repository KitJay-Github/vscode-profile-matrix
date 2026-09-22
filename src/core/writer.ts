import * as fs from 'fs';
import * as path from 'path';
import { readExtensionList } from './extensionStore';
import type { UserDataPaths } from './paths';
import { groupByProfile, type PendingMap } from './pendingQueue';
import { disabledDbPath, extensionListPath } from './profileFiles';
import { readProfiles } from './profileStore';
import { DISABLED_KEY, loadSqlite, readDisabledEntries } from './sqlite';
import type { DisabledEntry, ExtensionEntry, ProfileInfo } from './types';

/** 计算某个配置该写成什么样所需的上下文 */
export interface ProfileWriteContext {
  profile: ProfileInfo;
  /** 该配置当前的扩展清单 */
  currentExtensions: ExtensionEntry[];
  /** 该配置当前被禁用的扩展 id */
  currentDisabled: Set<string>;
  /** 全局扩展清单，用来给「加进这个配置」取完整的安装信息 */
  globalExtensions: ExtensionEntry[];
  extensionsJsonPath: string;
  stateDbPath: string;
}

export interface ProfileWritePlan {
  nextExtensions: ExtensionEntry[];
  nextDisabled: DisabledEntry[];
  errors: string[];
}

/**
 * 纯函数：算出这个配置写完之后应该是什么样。
 *
 * 「启用」要把扩展加进清单（安装信息直接从全局清单复制，扩展文件本来就在磁盘上），
 * 「禁用」只动禁用列表，「移出」才是从清单里删掉。
 */
export function planProfileWrites(
  ctx: ProfileWriteContext,
  changes: { extensionId: string; to: string }[],
): ProfileWritePlan {
  const extensions = [...ctx.currentExtensions];
  const disabled = new Set(ctx.currentDisabled);
  const errors: string[] = [];

  for (const change of changes) {
    const id = change.extensionId;
    switch (change.to) {
      case 'enabled': {
        if (!extensions.some((e) => e.identifier.id === id)) {
          const fromGlobal = ctx.globalExtensions.find((e) => e.identifier.id === id);
          if (fromGlobal) {
            extensions.push(fromGlobal);
          } else {
            errors.push(`找不到 ${id} 的安装信息，无法加入「${ctx.profile.name}」`);
            continue;
          }
        }
        disabled.delete(id);
        break;
      }
      case 'disabled':
        if (!disabled.has(id)) {
          disabled.add(id);
        }
        break;
      case 'absent':
        if (!extensions.some((e) => e.identifier.id === id)) {
          errors.push(`${id} 本来就不在「${ctx.profile.name}」里`);
          continue;
        }
        extensions.splice(
          extensions.findIndex((e) => e.identifier.id === id),
          1,
        );
        disabled.delete(id);
        break;
      default:
        errors.push(`${id} 的目标状态 ${change.to} 不支持`);
    }
  }

  const nextDisabled: DisabledEntry[] = [];
  for (const id of disabled) {
    const ext = extensions.find((e) => e.identifier.id === id);
    const uuid = ext?.identifier.uuid;
    nextDisabled.push(uuid ? { id, uuid } : { id });
  }

  return { nextExtensions: extensions, nextDisabled, errors };
}

/** 备份保留份数 */
const BACKUP_KEEP = 5;

function backupFile(filePath: string, stamp: string): string | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  const dest = `${filePath}.pm-backup-${stamp}`;
  fs.copyFileSync(filePath, dest);
  return dest;
}

function pruneBackups(filePath: string): void {
  const dir = path.dirname(filePath);
  const prefix = `${path.basename(filePath)}.pm-backup-`;
  try {
    const olds = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith(prefix))
      .sort();
    for (const name of olds.slice(0, Math.max(0, olds.length - BACKUP_KEEP))) {
      fs.rmSync(path.join(dir, name), { force: true });
    }
  } catch {
    // 清理旧备份失败不影响本次写入
  }
}

/** 落盘：先备份，再写 SQLite 的禁用列表，最后写扩展清单 */
export function writeProfilePlan(
  ctx: ProfileWriteContext,
  plan: ProfileWritePlan,
  stamp: string,
): string[] {
  const backups: string[] = [];

  const dbBackup = backupFile(ctx.stateDbPath, stamp);
  if (dbBackup) {
    backups.push(dbBackup);
  }
  const jsonBackup = backupFile(ctx.extensionsJsonPath, stamp);
  if (jsonBackup) {
    backups.push(jsonBackup);
  }

  const sqlite = loadSqlite();
  if (!sqlite) {
    throw new Error('当前运行时不支持内置 SQLite，无法写入禁用状态');
  }

  fs.mkdirSync(path.dirname(ctx.stateDbPath), { recursive: true });
  const db = new sqlite.DatabaseSync(ctx.stateDbPath);
  try {
    db.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);');
    // 必须写成 TEXT：VS Code 读出来直接 JSON.parse，写成 BLOB 会让它拿到 Buffer 并炸掉
    // 扩展管理器（详见 .spike/RESULT.md）。
    db.prepare('INSERT INTO ItemTable (key,value) VALUES (?,?)').run(
      DISABLED_KEY,
      JSON.stringify(plan.nextDisabled),
    );
  } finally {
    db.close();
  }

  fs.mkdirSync(path.dirname(ctx.extensionsJsonPath), { recursive: true });
  fs.writeFileSync(ctx.extensionsJsonPath, `${JSON.stringify(plan.nextExtensions, null, 4)}\n`, 'utf8');

  pruneBackups(ctx.stateDbPath);
  pruneBackups(ctx.extensionsJsonPath);
  return backups;
}

export interface ApplyOutcome {
  /** 成功写入的改动项数 */
  applied: number;
  /** 创建的备份文件 */
  backups: string[];
  /** 按配置文件汇总的错误 */
  errors: string[];
}

/**
 * 把待应用的改动落盘。
 * 每个受影响的配置独立处理：一个失败不影响其他的。
 */
export function applyChanges(
  paths: UserDataPaths,
  pending: PendingMap,
  stamp: string = String(Date.now()),
): ApplyOutcome {
  const profiles = readProfiles(paths.storageJson);
  const byLocation = new Map(profiles.map((p) => [p.location, p]));
  const globalExtensions = readExtensionList(path.join(paths.extensionsDir, 'extensions.json'));

  const outcome: ApplyOutcome = { applied: 0, backups: [], errors: [] };

  for (const [location, changes] of groupByProfile(pending)) {
    const profile = byLocation.get(location);
    if (!profile) {
      outcome.errors.push(`找不到配置文件 ${location}`);
      continue;
    }

    const extensionsJsonPath = extensionListPath(paths, profile);
    const stateDbPath = disabledDbPath(paths, profile);
    const ctx: ProfileWriteContext = {
      profile,
      currentExtensions: readExtensionList(extensionsJsonPath),
      currentDisabled: new Set(readDisabledEntries(stateDbPath).map((d) => d.id)),
      globalExtensions,
      extensionsJsonPath,
      stateDbPath,
    };

    const plan = planProfileWrites(ctx, changes);

    if (plan.errors.length === changes.length) {
      // 这一组改动全部失败，不必碰文件
      outcome.errors.push(...plan.errors);
      continue;
    }

    try {
      outcome.backups.push(...writeProfilePlan(ctx, plan, stamp));
      outcome.applied += changes.length - plan.errors.length;
      outcome.errors.push(...plan.errors);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcome.errors.push(`写入「${profile.name}」失败：${message}`);
    }
  }

  return outcome;
}
