import * as fs from 'fs';
import { DEFAULT_PROFILE_LOCATION, type ProfileInfo } from './types';

/** 默认配置在界面上的展示名 */
const DEFAULT_PROFILE_NAME = '默认';

interface RawProfile {
  location?: unknown;
  name?: unknown;
  icon?: unknown;
}

interface RawStorage {
  userDataProfiles?: unknown;
}

function defaultProfile(): ProfileInfo {
  return {
    location: DEFAULT_PROFILE_LOCATION,
    name: DEFAULT_PROFILE_NAME,
    isDefault: true,
    isBuiltin: false,
  };
}

/**
 * 把 storage.json 的文本解析成配置文件列表（纯函数）。
 * 默认配置不写在 userDataProfiles 里，这里补在首位。
 */
export function parseProfiles(storageJsonText: string): ProfileInfo[] {
  let raw: RawStorage;
  try {
    raw = JSON.parse(storageJsonText) as RawStorage;
  } catch {
    return [defaultProfile()];
  }

  if (!Array.isArray(raw.userDataProfiles)) {
    return [defaultProfile()];
  }

  const rest = (raw.userDataProfiles as RawProfile[])
    .filter(
      (p): p is RawProfile & { location: string } =>
        !!p && typeof p.location === 'string' && p.location.length > 0,
    )
    .map((p) => ({
      location: p.location,
      name: typeof p.name === 'string' && p.name.length > 0 ? p.name : p.location,
      icon: typeof p.icon === 'string' ? p.icon : undefined,
      isDefault: false,
      isBuiltin: p.location.startsWith('builtin/'),
    }));

  return [defaultProfile(), ...rest];
}

/** 从磁盘读并解析；读失败时退化为只有默认配置 */
export function readProfiles(storageJsonPath: string): ProfileInfo[] {
  try {
    return parseProfiles(fs.readFileSync(storageJsonPath, 'utf8'));
  } catch {
    return [defaultProfile()];
  }
}
