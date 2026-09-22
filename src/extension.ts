import * as vscode from 'vscode';
import { MatrixPanel } from './panel/matrixPanel';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('profileMatrix.openPanel', () => {
      MatrixPanel.show(context.extensionUri);
    }),
  );
}

export function deactivate(): void {
  // 无需要清理的资源
}
