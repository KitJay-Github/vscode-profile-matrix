import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as path from 'path';
import type { UserDataPaths } from '../src/core/paths';
import { disabledDbPath, extensionListPath } from '../src/core/profileFiles';
import type { ProfileInfo } from '../src/core/types';

const PATHS: UserDataPaths = {
  productName: 'Code',
  userDir: '/u/User',
  storageJson: '/u/User/globalStorage/storage.json',
  profilesDir: '/u/User/profiles',
  extensionsDir: '/u/.vscode/extensions',
};

const DEFAULT_PROFILE: ProfileInfo = {
  location: '__default__profile__',
  name: '默认',
  isDefault: true,
  isBuiltin: false,
};
const NAMED: ProfileInfo = {
  location: '-1a2b3c4d',
  name: 'STM32',
  isDefault: false,
  isBuiltin: false,
};
const BUILTIN: ProfileInfo = {
  location: 'builtin/agents',
  name: 'Agents',
  isDefault: false,
  isBuiltin: true,
};

test('默认配置的禁用库在 User/globalStorage 下', () => {
  assert.equal(
    disabledDbPath(PATHS, DEFAULT_PROFILE),
    path.join('/u/User', 'globalStorage', 'state.vscdb'),
  );
});

test('普通配置的禁用库在自己的目录下', () => {
  assert.equal(
    disabledDbPath(PATHS, NAMED),
    path.join('/u/User/profiles', '-1a2b3c4d', 'globalStorage', 'state.vscdb'),
  );
});

test('默认配置的清单用扩展目录下的 extensions.json', () => {
  assert.equal(
    extensionListPath(PATHS, DEFAULT_PROFILE),
    path.join('/u/.vscode/extensions', 'extensions.json'),
  );
});

test('普通配置用自己的 extensions.json', () => {
  assert.equal(
    extensionListPath(PATHS, NAMED),
    path.join('/u/User/profiles', '-1a2b3c4d', 'extensions.json'),
  );
});

test('内置配置继承默认配置的清单', () => {
  assert.equal(
    extensionListPath(PATHS, BUILTIN),
    path.join('/u/.vscode/extensions', 'extensions.json'),
  );
});
