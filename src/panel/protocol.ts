import type { CellState, MatrixRow, ProfileInfo } from '../core/types';

/** 传给页面的行：图标已由宿主转成 webview 可访问的 URI */
export interface WebviewRow extends MatrixRow {
  /** 图标在 webview 里的地址；没有图标时缺省 */
  iconUri?: string;
}

/** 宿主推给 Webview 的完整快照 */
export interface MatrixPayload {
  profiles: ProfileInfo[];
  rows: WebviewRow[];
  /** 待应用的配置级改动：`${profileLocation}|${extensionId}` -> 目标状态 */
  pending: Record<string, CellState>;
  /** 待应用的全局共享改动：extensionId -> 目标值 */
  appScopedPending: Record<string, boolean>;
  /** 当前所在配置；无法判定时为 undefined */
  currentProfileLocation?: string;
  /** 内置 SQLite 是否可用；不可用时界面降级为不含禁用态的只读矩阵 */
  sqliteAvailable: boolean;
  /** 数据源路径，便于排错 */
  sourcePath: string;
}

export type HostToWebviewMessage =
  | { type: 'matrix'; payload: MatrixPayload }
  | { type: 'applyResult'; applied: number; backups: number; errors: string[] }
  | { type: 'error'; message: string };

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'toggleCell'; extensionId: string; profileLocation: string }
  | { type: 'removeFromProfile'; extensionId: string; profileLocation: string }
  | { type: 'toggleAppScope'; extensionId: string }
  | { type: 'applyChanges' }
  | { type: 'discardChanges' }
  | { type: 'switchProfile'; location: string }
  | { type: 'openNativeExtensions'; extensionId: string }
  | { type: 'openInMarketplace'; extensionId: string };
