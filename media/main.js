const vscode = acquireVsCodeApi();
const app = document.getElementById('app');

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'matrix') {
    const { profiles, rows } = msg.payload;
    app.textContent = `读到 ${profiles.length} 个配置文件、${rows.length} 个扩展`;
  } else if (msg.type === 'error') {
    app.textContent = `出错了：${msg.message}`;
  }
});

vscode.postMessage({ type: 'ready' });
