import * as path from 'path';
import type { MatrixPayload } from '../panel/protocol';
import { collectExtensionMeta, readExtensionList } from './extensionStore';
import { buildMatrix } from './matrix';
import { resolveUserDataPaths, type UserDataPaths } from './paths';
import { disabledDbPath, extensionListPath } from './profileFiles';
import { readProfiles } from './profileStore';
import { isSqliteAvailable, readDisabledEntries } from './sqlite';
import type { ExtensionEntry } from './types';

/** 读取一次完整快照。找不到用户数据目录时返回空载荷而非抛错。 */
export function loadSnapshot(
  paths: UserDataPaths | undefined = resolveUserDataPaths(),
): MatrixPayload {
  if (!paths) {
    return {
      profiles: [],
      rows: [],
      pending: {},
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
      meta: collectExtensionMeta(allExtensions),
    }),
    pending: {},
    sqliteAvailable: isSqliteAvailable(),
    sourcePath: paths.userDir,
  };
}
