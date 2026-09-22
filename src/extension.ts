import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('profileMatrix.openPanel', () => {
      void vscode.window.showInformationMessage('Profile Matrix 已激活');
    }),
  );
}

export function deactivate(): void {
  // 无需要清理的资源
}
