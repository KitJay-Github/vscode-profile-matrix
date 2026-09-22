/** 默认配置文件的固定 id（VS Code 内部常量） */
export const DEFAULT_PROFILE_LOCATION = '__default__profile__';

/** 一个配置文件 */
export interface ProfileInfo {
  /** 相对 User/profiles 的目录名；默认配置为 __default__profile__ */
  location: string;
  /** 显示名 */
  name: string;
  /** 图标 id */
  icon?: string;
  /** 是否为默认配置 */
  isDefault: boolean;
  /** 是否为 VS Code 内置配置（如 Agents） */
  isBuiltin: boolean;
}

/** 扩展在某个配置文件里的状态 */
export type CellState =
  /** 已装且启用 */
  | 'enabled'
  /** 已装但禁用 */
  | 'disabled'
  /** 该配置未装 */
  | 'absent'
  /** 全局共享，不归任何配置管 */
  | 'global';

/** 扩展所属分组 */
export type RowGroup = 'managed' | 'global' | 'orphan';

/** 矩阵中的一行 */
export interface MatrixRow {
  /** 扩展 id，如 candycium.keil-assistant-new */
  id: string;
  /** 展示用名称 */
  name: string;
  /** 发布者 */
  publisher: string;
  /** 分组 */
  group: RowGroup;
  /** profileLocation -> 状态 */
  cells: Record<string, CellState>;
  /** 扩展图标文件的绝对路径；没有图标时为 undefined */
  iconPath?: string;
}

/** 扩展清单条目（来自 extensions.json） */
export interface ExtensionEntry {
  identifier: { id: string; uuid?: string };
  version?: string;
  location?: { path?: string };
  relativeLocation?: string;
  metadata?: {
    isApplicationScoped?: boolean;
    isBuiltin?: boolean;
  } & Record<string, unknown>;
}

/** 被禁用的扩展条目 */
export interface DisabledEntry {
  id: string;
  uuid?: string;
}
