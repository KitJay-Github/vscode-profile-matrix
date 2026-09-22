import * as vscode from 'vscode';
import { loadSnapshot } from '../core/snapshot';
import type { HostToWebviewMessage, WebviewToHostMessage } from './protocol';

export class MatrixPanel {
  private static current: MatrixPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];

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
    const panel = vscode.window.createWebviewPanel(
      'profileMatrix',
      '扩展矩阵',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      },
    );
    MatrixPanel.current = new MatrixPanel(panel, extensionUri);
  }

  private post(message: HostToWebviewMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private pushMatrix(): void {
    try {
      this.post({ type: 'matrix', payload: loadSnapshot() });
    } catch (err) {
      this.post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleMessage(msg: WebviewToHostMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
      case 'refresh':
        this.pushMatrix();
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
      content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
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
