import type { CellState } from './types';

/** 一项待应用的改动 */
export interface PendingChange {
  extensionId: string;
  profileLocation: string;
  /** 改动前的状态，用于撤销与展示 */
  from: CellState;
  /** 改动后的状态 */
  to: CellState;
}

export type PendingMap = ReadonlyMap<string, PendingChange>;

export function cellKey(profileLocation: string, extensionId: string): string {
  return `${profileLocation}|${extensionId}`;
}

/**
 * 点一下格子之后应该变成什么。
 * 全局共享的扩展不归配置管，返回 undefined 表示不可操作。
 */
export function nextCellState(current: CellState): CellState | undefined {
  switch (current) {
    case 'enabled':
      return 'disabled';
    case 'disabled':
      return 'enabled';
    case 'absent':
      return 'enabled';
    case 'global':
      return undefined;
  }
}

/** 切换一项改动：已在队列里就撤销，否则按目标状态加入 */
export function togglePending(
  pending: PendingMap,
  extensionId: string,
  profileLocation: string,
  current: CellState,
): PendingMap {
  const key = cellKey(profileLocation, extensionId);
  const next = new Map(pending);
  if (next.has(key)) {
    next.delete(key);
    return next;
  }
  const target = nextCellState(current);
  if (!target) {
    return next;
  }
  next.set(key, { extensionId, profileLocation, from: current, to: target });
  return next;
}

/** 转成给页面用的扁平表：`${profileLocation}|${extensionId}` -> 目标状态 */
export function toPayloadMap(pending: PendingMap): Record<string, CellState> {
  const out: Record<string, CellState> = {};
  for (const [key, change] of pending) {
    out[key] = change.to;
  }
  return out;
}

/** 按配置文件分组，供写入时逐个处理 */
export function groupByProfile(pending: PendingMap): Map<string, PendingChange[]> {
  const grouped = new Map<string, PendingChange[]>();
  for (const change of pending.values()) {
    const list = grouped.get(change.profileLocation);
    if (list) {
      list.push(change);
    } else {
      grouped.set(change.profileLocation, [change]);
    }
  }
  return grouped;
}
