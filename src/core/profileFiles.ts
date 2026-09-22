import * as path from 'path';
import type { UserDataPaths } from './paths';
import type { ProfileInfo } from './types';

/** 某个配置的禁用状态库所在路径 */
export function disabledDbPath(paths: UserDataPaths, profile: ProfileInfo): string {
  return profile.isDefault
    ? path.join(paths.userDir, 'globalStorage', 'state.vscdb')
    : path.join(paths.profilesDir, profile.location, 'globalStorage', 'state.vscdb');
}

/**
 * 某个配置的扩展清单路径。
 * 内置配置（如 Agents）没有自己的清单，它继承默认配置的——这一点由 VS Code 的
 * useDefaultFlags.extensions 控制，实测 builtin/agents 目录下确实没有 extensions.json。
 */
export function extensionListPath(paths: UserDataPaths, profile: ProfileInfo): string {
  if (profile.isDefault || profile.isBuiltin) {
    return path.join(paths.extensionsDir, 'extensions.json');
  }
  return path.join(paths.profilesDir, profile.location, 'extensions.json');
}
