import * as path from 'path';
import type { MatrixPayload } from '../panel/protocol';
import { collectDisplayNames, readExtensionList } from './extensionStore';
import { buildMatrix } from './matrix';
import { resolveUserDataPaths, type UserDataPaths } from './paths';
import { readProfiles } from './profileStore';
import { isSqliteAvailable, readDisabledEntries } from './sqlite';
import type { ExtensionEntry, ProfileInfo } from './types';

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

/** 读取一次完整快照。找不到用户数据目录时返回空载荷而非抛错。 */
export function loadSnapshot(
  paths: UserDataPaths | undefined = resolveUserDataPaths(),
): MatrixPayload {
  if (!paths) {
    return {
      profiles: [],
      rows: [],
      sqliteAvailable: isSqliteAvailable(),
      sourcePath: '(未找到 VS Code 用户数据目录)',
    };
  }

  const profiles = readProfiles(paths.storageJson);
  const allExtensions = readExtensionList(path.join(paths.extensionsDir, 'extensions.json'));

  const installedByProfile = new Map<string, ExtensionEntry[]>();
  const disabledByProfile = new Map<string, Set<string>>();
  for (const profile of profiles) {
    installedByProfile.set(profile.location, readExtensionList(extensionListPath(paths, profile)));
    const disabled = readDisabledEntries(disabledDbPath(paths, profile));
    disabledByProfile.set(profile.location, new Set(disabled.map((d) => d.id)));
  }

  return {
    profiles,
    rows: buildMatrix({
      profiles,
      installedByProfile,
      disabledByProfile,
      allExtensions,
      displayNames: collectDisplayNames(allExtensions),
    }),
    sqliteAvailable: isSqliteAvailable(),
    sourcePath: paths.userDir,
  };
}
