import type { CellState } from './types';

/** 改某个扩展在某个配置里的启用状态 */
export interface CellChange {
  kind: 'cell';
  extensionId: string;
  profileLocation: string;
  /** 改动前的状态，用于撤销与展示 */
  from: CellState;
  /** 改动后的状态 */
  to: CellState;
}

/** 改某个扩展是不是「全局共享」——这一项是扩展级而非配置级的 */
export interface AppScopeChange {
  kind: 'appScope';
  extensionId: string;
  from: boolean;
  to: boolean;
}

export type PendingChange = CellChange | AppScopeChange;

export type PendingMap = ReadonlyMap<string, PendingChange>;

export function isCellChange(change: PendingChange): change is CellChange {
  return change.kind === 'cell';
}

export function isAppScopeChange(change: PendingChange): change is AppScopeChange {
  return change.kind === 'appScope';
}

export function cellKey(profileLocation: string, extensionId: string): string {
  return `${profileLocation}|${extensionId}`;
}

/** 全局共享标记的 key 用不同前缀，免得和配置目录名撞上 */
export function appScopeKey(extensionId: string): string {
  return `appscope.${extensionId}`;
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

/** 切换一项配置级改动：已在队列里就撤销，否则按目标状态加入 */
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
  next.set(key, { kind: 'cell', extensionId, profileLocation, from: current, to: target });
  return next;
}

/** 切换「全局共享」标记 */
export function toggleAppScope(
  pending: PendingMap,
  extensionId: string,
  currentAppScoped: boolean,
): PendingMap {
  const key = appScopeKey(extensionId);
  const next = new Map(pending);
  if (next.has(key)) {
    next.delete(key);
    return next;
  }
  next.set(key, {
    kind: 'appScope',
    extensionId,
    from: currentAppScoped,
    to: !currentAppScoped,
  });
  return next;
}

/** 转成给页面用的扁平表：`${profileLocation}|${extensionId}` -> 目标状态 */
export function toPayloadMap(pending: PendingMap): Record<string, CellState> {
  const out: Record<string, CellState> = {};
  for (const change of pending.values()) {
    if (isCellChange(change)) {
      out[cellKey(change.profileLocation, change.extensionId)] = change.to;
    }
  }
  return out;
}

/** 待应用的「全局共享」改动：extensionId -> 目标值 */
export function toAppScopeMap(pending: PendingMap): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const change of pending.values()) {
    if (isAppScopeChange(change)) {
      out[change.extensionId] = change.to;
    }
  }
  return out;
}

/** 按配置文件分组，供写入时逐个处理（只包含配置级改动） */
export function groupByProfile(pending: PendingMap): Map<string, CellChange[]> {
  const grouped = new Map<string, CellChange[]>();
  for (const change of pending.values()) {
    if (!isCellChange(change)) {
      continue;
    }
    const list = grouped.get(change.profileLocation);
    if (list) {
      list.push(change);
    } else {
      grouped.set(change.profileLocation, [change]);
    }
  }
  return grouped;
}
