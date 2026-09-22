import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** VS Code 各发行版的用户数据目录名 */
export const PRODUCT_DIR_NAMES = ['Code', 'Code - Insiders', 'VSCodium', 'Cursor'];

/** 发行版 -> 扩展目录所在的隐藏目录名 */
export const EXT_DIR_BY_PRODUCT: Record<string, string> = {
  Code: '.vscode',
  'Code - Insiders': '.vscode-insiders',
  VSCodium: '.vscode-oss',
  Cursor: '.cursor',
};

export interface UserDataPaths {
  /** 发行版名，如 Code */
  productName: string;
  /** <用户数据根>/User */
  userDir: string;
  /** <用户数据根>/User/globalStorage/storage.json */
  storageJson: string;
  /** <用户数据根>/User/profiles */
  profilesDir: string;
  /** 扩展安装目录，如 ~/.vscode/extensions */
  extensionsDir: string;
}

/**
 * 按目标平台选 path 实现。
 * 这样在 Windows 上也能正确拼出 Linux/macOS 的路径，反之亦然——测试才能跨平台。
 */
function pathFor(platform: NodeJS.Platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

/**
 * 按平台列出用户数据根目录的候选路径。
 * 纯函数：平台、环境变量、家目录都从参数注入。
 */
export function candidateUserDataRoots(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string,
): string[] {
  const p = pathFor(platform);
  if (platform === 'win32') {
    const appData = env.APPDATA;
    if (!appData) {
      return [];
    }
    return PRODUCT_DIR_NAMES.map((name) => p.join(appData, name));
  }
  if (platform === 'darwin') {
    return PRODUCT_DIR_NAMES.map((name) =>
      p.join(home, 'Library', 'Application Support', name),
    );
  }
  const configHome = env.XDG_CONFIG_HOME || p.join(home, '.config');
  return PRODUCT_DIR_NAMES.map((name) => p.join(configHome, name));
}

/**
 * 找到真实存在的那份用户数据目录（以 storage.json 是否存在为准）。
 * exists 可注入，便于测试。
 */
export function resolveUserDataPaths(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
  exists: (p: string) => boolean = fs.existsSync,
): UserDataPaths | undefined {
  const p = pathFor(platform);
  const roots = candidateUserDataRoots(platform, env, home);

  for (let i = 0; i < PRODUCT_DIR_NAMES.length; i += 1) {
    const productName = PRODUCT_DIR_NAMES[i];
    const root = roots[i];
    if (!root) {
      continue;
    }
    const userDir = p.join(root, 'User');
    const storageJson = p.join(userDir, 'globalStorage', 'storage.json');
    if (!exists(storageJson)) {
      continue;
    }
    return {
      productName,
      userDir,
      storageJson,
      profilesDir: p.join(userDir, 'profiles'),
      extensionsDir: p.join(home, EXT_DIR_BY_PRODUCT[productName] ?? '.vscode', 'extensions'),
    };
  }
  return undefined;
}
