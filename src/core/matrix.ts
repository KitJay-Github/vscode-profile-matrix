import type { ExtensionMeta } from './extensionStore';
import type { CellState, ExtensionEntry, MatrixRow, ProfileInfo, RowGroup } from './types';

export interface MatrixInput {
  profiles: ProfileInfo[];
  /** profileLocation -> 该配置清单里的扩展 */
  installedByProfile: Map<string, ExtensionEntry[]>;
  /** profileLocation -> 被禁用的扩展 id */
  disabledByProfile: Map<string, Set<string>>;
  /** 全局已下载的扩展（用来找出「装了但没用上」的） */
  allExtensions: ExtensionEntry[];
  /** 扩展 id -> 展示名与图标 */
  meta?: Map<string, ExtensionMeta>;
}

const GROUP_ORDER: Record<RowGroup, number> = { managed: 0, global: 1, orphan: 2 };

/**
 * 把三方数据拼成矩阵行（纯函数）。
 *
 * 一个扩展的状态由三件事决定：
 *   1. isApplicationScoped 为真 → 全局共享，所有列都是 global，不归配置管
 *   2. 是否在该配置的扩展清单里 → 不在就是 absent
 *   3. 是否在该配置的禁用列表里 → 在就是 disabled，否则 enabled
 */
export function buildMatrix(input: MatrixInput): MatrixRow[] {
  const { profiles, installedByProfile, disabledByProfile, allExtensions, meta } = input;

  const known = new Map<string, ExtensionEntry>();
  const globalIds = new Set<string>();
  const collect = (e: ExtensionEntry): void => {
    if (!known.has(e.identifier.id)) {
      known.set(e.identifier.id, e);
    }
    if (e.metadata?.isApplicationScoped === true) {
      globalIds.add(e.identifier.id);
    }
  };
  allExtensions.forEach(collect);
  for (const entries of installedByProfile.values()) {
    entries.forEach(collect);
  }

  const rows: MatrixRow[] = [];
  for (const id of known.keys()) {
    const isGlobal = globalIds.has(id);
    const cells: Record<string, CellState> = {};
    let installedAnywhere = false;

    for (const profile of profiles) {
      if (isGlobal) {
        cells[profile.location] = 'global';
        continue;
      }
      const installed = (installedByProfile.get(profile.location) ?? []).some(
        (e) => e.identifier.id === id,
      );
      if (!installed) {
        cells[profile.location] = 'absent';
        continue;
      }
      installedAnywhere = true;
      cells[profile.location] = disabledByProfile.get(profile.location)?.has(id)
        ? 'disabled'
        : 'enabled';
    }

    const group: RowGroup = isGlobal ? 'global' : installedAnywhere ? 'managed' : 'orphan';
    const [publisher = '', ...rest] = id.split('.');
    const fallbackName = rest.length > 0 ? rest.join('.') : id;
    const info = meta?.get(id);
    rows.push({
      id,
      name: info?.displayName ?? fallbackName,
      publisher,
      group,
      cells,
      iconPath: info?.iconPath,
    });
  }

  rows.sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || a.name.localeCompare(b.name));
  return rows;
}

/** 各配置之间的状态是否不一致（全局共享的格子不参与比较） */
export function hasDifference(row: MatrixRow): boolean {
  const states = Object.values(row.cells).filter((s) => s !== 'global');
  if (states.length < 2) {
    return false;
  }
  return new Set(states).size > 1;
}
