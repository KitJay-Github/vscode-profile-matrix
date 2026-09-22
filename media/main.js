const vscode = acquireVsCodeApi();
const app = document.getElementById('app');

const state = {
  payload: null,
  query: '',
  filter: 'all',
  collapsed: { global: true, orphan: true },
};

const GROUP_ORDER = ['managed', 'global', 'orphan'];

const GROUP_LABEL = {
  managed: '由配置文件管理',
  global: '全局共享 · 不归配置文件管',
  orphan: '装了但没用上',
};

const CELL_TITLE = {
  enabled: '已启用',
  disabled: '已装但禁用',
  absent: '该配置未装',
  global: '全局共享，不随配置变化',
};

const FILTERS = [
  ['all', '全部'],
  ['diff', '有差异'],
  ['managed', '仅配置级'],
];

// 外壳只建一次，之后只重建表格：否则每次敲键盘都会重建输入框，焦点会丢。
let searchInput;
let filterButtons = [];
let tableHost;
let warnHost;

function summarize(rows, profileLocation) {
  let installed = 0;
  let disabled = 0;
  for (const row of rows) {
    const cell = row.cells[profileLocation];
    if (cell === 'enabled' || cell === 'disabled') {
      installed += 1;
      if (cell === 'disabled') {
        disabled += 1;
      }
    }
  }
  return `${installed} 装 · ${installed - disabled} 启用 · ${disabled} 禁用`;
}

function matchesFilter(row) {
  if (state.filter === 'managed') {
    return row.group === 'managed';
  }
  if (state.filter === 'diff') {
    const cells = Object.values(row.cells).filter((c) => c !== 'global');
    return new Set(cells).size > 1;
  }
  return true;
}

function matchesQuery(row) {
  if (!state.query) {
    return true;
  }
  const q = state.query.toLowerCase();
  return row.id.toLowerCase().includes(q) || row.name.toLowerCase().includes(q);
}

function updateFilterButtons() {
  for (const { key, btn } of filterButtons) {
    btn.setAttribute('aria-pressed', String(state.filter === key));
  }
}

function buildShell() {
  app.textContent = '';

  const bar = document.createElement('div');
  bar.className = 'pm-bar';

  searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = '搜索扩展名或 id…';
  searchInput.addEventListener('input', () => {
    state.query = searchInput.value;
    renderTable();
  });
  bar.appendChild(searchInput);

  const filterBox = document.createElement('div');
  filterBox.className = 'pm-filter';
  filterButtons = FILTERS.map(([key, label]) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      state.filter = key;
      updateFilterButtons();
      renderTable();
    });
    filterBox.appendChild(btn);
    return { key, btn };
  });
  bar.appendChild(filterBox);
  app.appendChild(bar);

  warnHost = document.createElement('div');
  app.appendChild(warnHost);

  tableHost = document.createElement('div');
  app.appendChild(tableHost);

  const legend = document.createElement('div');
  legend.className = 'pm-legend';
  for (const key of ['enabled', 'disabled', 'absent', 'global']) {
    const item = document.createElement('span');
    const dot = document.createElement('span');
    dot.className = `cell ${key}`;
    item.appendChild(dot);
    item.appendChild(document.createTextNode(CELL_TITLE[key]));
    legend.appendChild(item);
  }
  app.appendChild(legend);

  updateFilterButtons();
}

function renderWarnings(payload) {
  warnHost.textContent = '';
  if (!payload.sqliteAvailable) {
    const warn = document.createElement('div');
    warn.className = 'pm-warn';
    warn.textContent =
      '当前 VS Code 版本不支持内置 SQLite，读不到「已装但禁用」的状态，矩阵已降级为只读。';
    warnHost.appendChild(warn);
  }
}

function renderGroupHeader(group, count, colspan) {
  const tr = document.createElement('tr');
  tr.className = 'pm-group';
  const td = document.createElement('td');
  td.colSpan = colspan;
  const arrow = state.collapsed[group] ? '▸' : '▾';
  td.textContent = `${arrow} ${GROUP_LABEL[group]}（${count}）`;
  td.style.cursor = 'pointer';
  td.addEventListener('click', () => {
    state.collapsed[group] = !state.collapsed[group];
    renderTable();
  });
  tr.appendChild(td);
  return tr;
}

function renderRow(row, profiles) {
  const tr = document.createElement('tr');

  const nameTd = document.createElement('td');
  const wrap = document.createElement('div');
  wrap.className = 'pm-name';
  const badge = document.createElement('span');
  badge.className = 'pm-badge';
  badge.textContent = (row.name[0] || '?').toUpperCase();
  wrap.appendChild(badge);
  const text = document.createElement('div');
  const title = document.createElement('div');
  title.textContent = row.name;
  const sub = document.createElement('div');
  sub.className = 'pm-sub';
  sub.textContent = `${row.publisher} · ${row.id}`;
  text.appendChild(title);
  text.appendChild(sub);
  wrap.appendChild(text);
  nameTd.appendChild(wrap);
  tr.appendChild(nameTd);

  for (const profile of profiles) {
    const td = document.createElement('td');
    const cellState = row.cells[profile.location] || 'absent';
    const cell = document.createElement('span');
    cell.className = `cell ${cellState}`;
    cell.title = CELL_TITLE[cellState];
    td.appendChild(cell);
    if (cellState !== 'global') {
      // 全局共享的扩展不归配置管，点了也没用，所以不做成可点击
      td.className = 'pm-clickable';
      td.title = '在原生扩展面板中查看';
      td.addEventListener('click', () => {
        vscode.postMessage({ type: 'openNativeExtensions', extensionId: row.id });
      });
    }
    tr.appendChild(td);
  }
  return tr;
}

function renderTable() {
  const payload = state.payload;
  tableHost.textContent = '';
  if (!payload) {
    return;
  }

  if (payload.profiles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pm-empty';
    empty.textContent = '没有找到 VS Code 配置文件，请确认数据目录可读。';
    tableHost.appendChild(empty);
    return;
  }

  const visible = payload.rows.filter((r) => matchesFilter(r) && matchesQuery(r));
  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pm-empty';
    empty.textContent =
      payload.rows.length === 0 ? '没有读到任何扩展。' : '没有符合当前筛选条件的扩展。';
    tableHost.appendChild(empty);
    return;
  }

  const table = document.createElement('table');

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const corner = document.createElement('th');
  corner.textContent = '扩展';
  headRow.appendChild(corner);
  for (const profile of payload.profiles) {
    const th = document.createElement('th');
    if (profile.location === payload.currentProfileLocation) {
      th.className = 'pm-current';
    }
    th.appendChild(document.createTextNode(profile.name));
    const small = document.createElement('small');
    small.textContent = summarize(payload.rows, profile.location);
    th.appendChild(small);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const group of GROUP_ORDER) {
    const rows = visible.filter((r) => r.group === group);
    if (rows.length === 0) {
      continue;
    }
    tbody.appendChild(renderGroupHeader(group, rows.length, payload.profiles.length + 1));
    if (!state.collapsed[group]) {
      for (const row of rows) {
        tbody.appendChild(renderRow(row, payload.profiles));
      }
    }
  }
  table.appendChild(tbody);
  tableHost.appendChild(table);
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'matrix') {
    state.payload = msg.payload;
    if (!searchInput) {
      buildShell();
    }
    renderWarnings(msg.payload);
    renderTable();
  } else if (msg.type === 'error') {
    app.textContent = `出错了：${msg.message}`;
  }
});

vscode.postMessage({ type: 'ready' });
