import type { MatrixRow, ProfileInfo } from '../core/types';

/** 宿主推给 Webview 的完整快照 */
export interface MatrixPayload {
  profiles: ProfileInfo[];
  rows: MatrixRow[];
  /** 当前所在配置；无法判定时为 undefined */
  currentProfileLocation?: string;
  /** 内置 SQLite 是否可用；不可用时界面降级为不含禁用态的只读矩阵 */
  sqliteAvailable: boolean;
  /** 数据源路径，便于排错 */
  sourcePath: string;
}

export type HostToWebviewMessage =
  | { type: 'matrix'; payload: MatrixPayload }
  | { type: 'error'; message: string };

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'switchProfile'; location: string }
  | { type: 'openNativeExtensions'; extensionId: string };
