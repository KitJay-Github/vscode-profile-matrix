import * as fs from 'fs';
import * as path from 'path';
import type { ExtensionEntry } from './types';

/** 解析某个配置的 extensions.json（纯函数） */
export function parseExtensionList(jsonText: string): ExtensionEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(
    (e): e is ExtensionEntry =>
      !!e &&
      typeof e === 'object' &&
      typeof (e as { identifier?: { id?: unknown } }).identifier?.id === 'string',
  );
}

/** 从磁盘读某个配置的扩展清单 */
export function readExtensionList(jsonPath: string): ExtensionEntry[] {
  try {
    return parseExtensionList(fs.readFileSync(jsonPath, 'utf8'));
  } catch {
    return [];
  }
}

/** 把 file:// URI 的 path 转成本地路径（Windows 上是 /c:/x → c:/x） */
export function uriPathToLocal(p: string): string {
  return /^\/[a-zA-Z]:\//.test(p) ? p.slice(1) : p;
}

/** 读扩展自己的 package.json 取 displayName */
export function readDisplayName(extensionDir: string | undefined): string | undefined {
  if (!extensionDir) {
    return undefined;
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(extensionDir, 'package.json'), 'utf8')) as {
      displayName?: unknown;
    };
    return typeof pkg.displayName === 'string' && pkg.displayName.length > 0
      ? pkg.displayName
      : undefined;
  } catch {
    return undefined;
  }
}

/** 批量取显示名，读不到就跳过（界面会退回用 id 推导的名字） */
export function collectDisplayNames(entries: ExtensionEntry[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const e of entries) {
    const dir = e.location?.path ? uriPathToLocal(e.location.path) : undefined;
    const name = readDisplayName(dir);
    if (name) {
      names.set(e.identifier.id, name);
    }
  }
  return names;
}
