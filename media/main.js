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
let applyHost;

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

function pendingOf(profileLocation, extensionId) {
  const pending = state.payload?.pending || {};
  return pending[`${profileLocation}|${extensionId}`];
}

function updateFilterButtons() {
  for (const { key, btn } of filterButtons) {
    btn.setAttribute('aria-pressed', String(state.filter === key));
  }
}

// ---------- 右键菜单 ----------

let openMenu;

function closeMenu() {
  if (openMenu) {
    openMenu.remove();
    openMenu = undefined;
  }
}

function showMenu(x, y, items) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'pm-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  for (const item of items) {
    const btn = document.createElement('button');
    btn.textContent = item.label;
    btn.addEventListener('click', () => {
      closeMenu();
      item.run();
    });
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);
  openMenu = menu;
}

document.addEventListener('click', closeMenu);
document.addEventListener('contextmenu', (event) => {
  if (!event.target.closest('.pm-cell-clickable')) {
    closeMenu();
  }
});

// ---------- 渲染 ----------

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
  const actions = document.createElement('span');
  actions.className = 'pm-legend-hint';
  actions.textContent = '点格子切换 · 右键移出配置';
  legend.appendChild(actions);
  app.appendChild(legend);

  applyHost = document.createElement('div');
  app.appendChild(applyHost);

  updateFilterButtons();
}

function renderWarnings(payload) {
  warnHost.textContent = '';
  if (!payload.sqliteAvailable) {
    const warn = document.createElement('div');
    warn.className = 'pm-warn';
    warn.textContent =
      '当前 VS Code 版本不支持内置 SQLite，既读不到也改不了「已装但禁用」的状态，面板已降级为只读。';
    warnHost.appendChild(warn);
  }
  if (payload.profiles.length === 0) {
    const warn = document.createElement('div');
    warn.className = 'pm-warn';
    warn.textContent = `没有找到配置文件。数据源：${payload.sourcePath}`;
    warnHost.appendChild(warn);
  }
}

function renderApplyBar() {
  applyHost.textContent = '';
  const count = Object.keys(state.payload?.pending || {}).length;
  if (count === 0) {
    return;
  }

  const bar = document.createElement('div');
  bar.className = 'pm-apply-bar';

  const text = document.createElement('span');
  text.className = 'pm-apply-count';
  text.textContent = `${count} 项改动待应用`;
  bar.appendChild(text);

  const hint = document.createElement('span');
  hint.className = 'pm-apply-hint';
  hint.textContent = '需完全退出 VS Code 后生效';
  bar.appendChild(hint);

  const apply = document.createElement('button');
  apply.className = 'pm-primary';
  apply.textContent = '应用';
  apply.addEventListener('click', () => vscode.postMessage({ type: 'applyChanges' }));
  bar.appendChild(apply);

  const discard = document.createElement('button');
  discard.textContent = '放弃';
  discard.addEventListener('click', () => vscode.postMessage({ type: 'discardChanges' }));
  bar.appendChild(discard);

  applyHost.appendChild(bar);
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

function renderNameCell(row) {
  const td = document.createElement('td');
  const wrap = document.createElement('div');
  wrap.className = 'pm-name';

  const badge = document.createElement('span');
  badge.className = 'pm-badge';
  const fallback = () => {
    badge.textContent = (row.name[0] || '?').toUpperCase();
  };
  if (row.iconUri) {
    badge.classList.add('pm-badge-icon');
    const img = document.createElement('img');
    img.src = row.iconUri;
    img.alt = '';
    // 图标加载失败就退回首字母色块，别留个破图
    img.addEventListener('error', () => {
      img.remove();
      badge.classList.remove('pm-badge-icon');
      fallback();
    });
    badge.appendChild(img);
  } else {
    fallback();
  }
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
  td.appendChild(wrap);
  return td;
}

function renderCell(row, profile) {
  const td = document.createElement('td');
  const current = row.cells[profile.location] || 'absent';
  const target = pendingOf(profile.location, row.id);
  const shown = target || current;

  const cell = document.createElement('span');
  cell.className = `cell ${shown}${target ? ' pending' : ''}`;
  cell.title = target
    ? `待应用：${CELL_TITLE[current]} → ${CELL_TITLE[target]}（再点一次撤销）`
    : CELL_TITLE[current];
  td.appendChild(cell);

  if (current === 'global') {
    // 全局共享的扩展不归配置管，点了也没用
    return td;
  }

  td.classList.add('pm-cell-clickable');
  td.addEventListener('click', () => {
    vscode.postMessage({
      type: 'toggleCell',
      extensionId: row.id,
      profileLocation: profile.location,
    });
  });

  if (current !== 'absent') {
    td.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      showMenu(event.clientX, event.clientY, [
        {
          label: target === 'absent' ? '取消移出' : `从「${profile.name}」移出`,
          run: () =>
            vscode.postMessage({
              type: 'removeFromProfile',
              extensionId: row.id,
              profileLocation: profile.location,
            }),
        },
      ]);
    });
  }

  return td;
}

function renderTable() {
  const payload = state.payload;
  tableHost.textContent = '';
  if (!payload) {
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
        const tr = document.createElement('tr');
        tr.appendChild(renderNameCell(row));
        for (const profile of payload.profiles) {
          tr.appendChild(renderCell(row, profile));
        }
        tbody.appendChild(tr);
      }
    }
  }
  table.appendChild(tbody);
  tableHost.appendChild(table);
}

function render() {
  if (!state.payload) {
    return;
  }
  if (!searchInput) {
    buildShell();
  }
  renderWarnings(state.payload);
  renderTable();
  renderApplyBar();
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'matrix') {
    state.payload = msg.payload;
    render();
  } else if (msg.type === 'applyResult') {
    if (msg.applied > 0) {
      const note = document.createElement('div');
      note.className = 'pm-warn';
      note.textContent = `已写入 ${msg.applied} 项改动（备份 ${msg.backups} 份）。完全退出 VS Code 后生效。`;
      warnHost.prepend(note);
      setTimeout(() => note.remove(), 8000);
    }
    if (msg.errors.length > 0) {
      const note = document.createElement('div');
      note.className = 'pm-warn pm-warn-error';
      note.textContent = msg.errors.join('；');
      warnHost.prepend(note);
    }
  } else if (msg.type === 'error') {
    app.textContent = `出错了：${msg.message}`;
  }
});

vscode.postMessage({ type: 'ready' });
