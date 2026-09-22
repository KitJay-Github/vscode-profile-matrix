import * as vscode from 'vscode';
import { resolveUserDataPaths } from '../core/paths';
import { toPayloadMap, togglePending, type PendingMap } from '../core/pendingQueue';
import { loadSnapshot } from '../core/snapshot';
import type { CellState } from '../core/types';
import { applyChanges } from '../core/writer';
import type { HostToWebviewMessage, MatrixPayload, WebviewToHostMessage } from './protocol';

export class MatrixPanel {
  private static current: MatrixPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];

  /** 待应用的改动，关掉面板就丢——这里刻意不持久化 */
  private pending: PendingMap = new Map();

  /** 最近一次推给页面的快照，用于查询格子的当前状态 */
  private lastPayload: MatrixPayload | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.panel.onDidDispose(() => this.cleanup(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToHostMessage) => void this.handleMessage(msg),
      null,
      this.disposables,
    );
    this.panel.webview.html = this.renderHtml();
    // 不在这里推数据：webview 脚本还没跑起来，消息会丢。等它发 ready。
  }

  static show(extensionUri: vscode.Uri): void {
    if (MatrixPanel.current) {
      MatrixPanel.current.panel.reveal();
      MatrixPanel.current.pushMatrix();
      return;
    }

    // 图标要从扩展安装目录里读，所以要把它也放进允许访问的根目录
    const roots = [vscode.Uri.joinPath(extensionUri, 'media')];
    const paths = resolveUserDataPaths();
    if (paths) {
      roots.push(vscode.Uri.file(paths.extensionsDir));
    }

    const panel = vscode.window.createWebviewPanel(
      'profileMatrix',
      '扩展矩阵',
      vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: roots },
    );
    MatrixPanel.current = new MatrixPanel(panel, extensionUri);
  }

  private post(message: HostToWebviewMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private pushMatrix(): void {
    try {
      const payload = loadSnapshot();
      payload.pending = toPayloadMap(this.pending);
      for (const row of payload.rows) {
        if (row.iconPath) {
          row.iconUri = this.panel.webview
            .asWebviewUri(vscode.Uri.file(row.iconPath))
            .toString();
        }
      }
      this.lastPayload = payload;
      this.post({ type: 'matrix', payload });
    } catch (err) {
      this.post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  private currentCellState(extensionId: string, profileLocation: string): CellState | undefined {
    const row = this.lastPayload?.rows.find((r) => r.id === extensionId);
    return row?.cells[profileLocation];
  }

  private toggleCell(extensionId: string, profileLocation: string, to?: CellState): void {
    const current = this.currentCellState(extensionId, profileLocation);
    if (!current) {
      return;
    }

    if (to) {
      // 指定目标状态（右键「从此配置移出」走这条）
      const key = `${profileLocation}|${extensionId}`;
      const next = new Map(this.pending);
      if (next.get(key)?.to === to) {
        next.delete(key);
      } else {
        next.set(key, { extensionId, profileLocation, from: current, to });
      }
      this.pending = next;
    } else {
      this.pending = togglePending(this.pending, extensionId, profileLocation, current);
    }
    this.pushMatrix();
  }

  private async applyPending(): Promise<void> {
    if (this.pending.size === 0) {
      return;
    }

    const paths = resolveUserDataPaths();
    if (!paths) {
      void vscode.window.showErrorMessage('未找到 VS Code 用户数据目录，无法写入。');
      return;
    }

    const outcome = applyChanges(paths, this.pending);

    if (outcome.applied > 0) {
      this.pending = new Map();
    }

    if (outcome.errors.length > 0) {
      void vscode.window.showErrorMessage(`应用改动时出错：${outcome.errors.join('；')}`);
    } else {
      void vscode.window.showWarningMessage(
        `已写入 ${outcome.applied} 项改动，并留了 ${outcome.backups.length} 份备份。` +
          '需要完全退出 VS Code 再重新打开才会生效——Reload Window 不行。',
        '知道了',
      );
    }

    this.post({
      type: 'applyResult',
      applied: outcome.applied,
      backups: outcome.backups.length,
      errors: outcome.errors,
    });
    this.pushMatrix();
  }

  private async handleMessage(msg: WebviewToHostMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
      case 'refresh':
        this.pushMatrix();
        return;
      case 'toggleCell':
        this.toggleCell(msg.extensionId, msg.profileLocation);
        return;
      case 'removeFromProfile':
        this.toggleCell(msg.extensionId, msg.profileLocation, 'absent');
        return;
      case 'discardChanges':
        this.pending = new Map();
        this.pushMatrix();
        return;
      case 'applyChanges':
        await this.applyPending();
        return;
      case 'switchProfile':
        await vscode.commands.executeCommand(
          `workbench.profiles.actions.profileEntry.${msg.location}`,
        );
        return;
      case 'openNativeExtensions':
        await vscode.commands.executeCommand(
          'workbench.extensions.search',
          `@id:${msg.extensionId}`,
        );
        return;
    }
  }

  private renderHtml(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'styles.css'),
    );
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
<link rel="stylesheet" href="${styleUri}">
<title>扩展矩阵</title>
</head>
<body>
<div id="app">正在读取配置…</div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private cleanup(): void {
    MatrixPanel.current = undefined;
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}
