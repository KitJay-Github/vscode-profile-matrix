import * as fs from 'fs';
import * as path from 'path';
import type { ExtensionEntry } from './types';

/** 从扩展自己的 package.json 里取到的展示信息 */
export interface ExtensionMeta {
  /** 展示名；取不到时为 undefined，调用方应退回用 id 推导 */
  displayName?: string;
  /** 图标文件的绝对路径；没有图标或文件不存在时为 undefined */
  iconPath?: string;
}

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

/** 纯函数：从 package.json 的内容解析展示信息 */
export function parseExtensionMeta(
  packageJsonText: string,
  extensionDir: string,
  fileExists: (p: string) => boolean = fs.existsSync,
): ExtensionMeta {
  let pkg: { displayName?: unknown; name?: unknown; icon?: unknown };
  try {
    pkg = JSON.parse(packageJsonText) as typeof pkg;
  } catch {
    return {};
  }

  // VS Code 会把 %key% 形式的本地化占位符替换掉；这里没有 nls 表，
  // 遇到未替换的占位符就退回包名，总好过把 %name% 显示给用户。
  const rawDisplayName = typeof pkg.displayName === 'string' ? pkg.displayName : undefined;
  const displayName =
    rawDisplayName && !/^%.*%$/.test(rawDisplayName)
      ? rawDisplayName
      : typeof pkg.name === 'string' && pkg.name.length > 0
        ? pkg.name
        : undefined;

  let iconPath: string | undefined;
  if (typeof pkg.icon === 'string' && pkg.icon.length > 0) {
    const candidate = path.join(extensionDir, pkg.icon);
    if (fileExists(candidate)) {
      iconPath = candidate;
    }
  }

  return { displayName, iconPath };
}

/** 读扩展自己的 package.json 取展示信息 */
export function readExtensionMeta(extensionDir: string | undefined): ExtensionMeta {
  if (!extensionDir) {
    return {};
  }
  try {
    return parseExtensionMeta(
      fs.readFileSync(path.join(extensionDir, 'package.json'), 'utf8'),
      extensionDir,
    );
  } catch {
    return {};
  }
}

/** 批量取展示信息，读不到就跳过（界面会退回用 id 推导的名字与首字母色块） */
export function collectExtensionMeta(entries: ExtensionEntry[]): Map<string, ExtensionMeta> {
  const result = new Map<string, ExtensionMeta>();
  for (const e of entries) {
    const dir = e.location?.path ? uriPathToLocal(e.location.path) : undefined;
    const meta = readExtensionMeta(dir);
    if (meta.displayName || meta.iconPath) {
      result.set(e.identifier.id, meta);
    }
  }
  return result;
}
