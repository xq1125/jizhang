'use strict';
/* 记账本前端 —— 离线优先：数据存本机 IndexedDB，联网时经 GitHub Gist 多设备同步 */

const $ = (s) => document.querySelector(s);
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const PALETTE = ['#4f6ef7', '#e5533c', '#f2a93b', '#1aad6e', '#9b59d0', '#2bb3c0',
  '#ef7fa9', '#8fa2b3', '#c0ca33', '#7e57c2', '#ff8a50', '#5c6bc0'];

function pad2(n) { return String(n).padStart(2, '0'); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function thisMonth() { return todayStr().slice(0, 7); }
function monthLabel(m) {
  const [y, mo] = m.split('-');
  return `${y}年${Number(mo)}月`;
}
function dayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`;
}
function fmt(cents) {
  return (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function genId() {
  return settings.deviceId + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

/* ---------------- IndexedDB ---------------- */
const DB_NAME = 'jizhang-db', DB_VER = 1;
let _dbPromise = null;
function idb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB_NAME, DB_VER);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id' });
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
  return _dbPromise;
}
async function idbAll(store) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const rq = db.transaction(store).objectStore(store).getAll();
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}
async function idbPut(store, items) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    for (const it of [].concat(items)) t.objectStore(store).put(it);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/* ---------------- 设置（localStorage） ---------------- */
const LS_KEY = 'jizhang-settings';
let settings = null;
function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { /* ignore */ }
  s.token = s.token || '';
  s.gistId = s.gistId || '';
  s.deviceId = s.deviceId || ('dev-' + Math.random().toString(36).slice(2, 8));
  s.lastSync = s.lastSync || 0;
  s.lastError = s.lastError || '';
  return s;
}
function saveSettings() { localStorage.setItem(LS_KEY, JSON.stringify(settings)); }

/* ---------------- 状态 ---------------- */
const SEED_CATEGORIES = [
  ['餐饮', 'expense', '🍜'], ['交通', 'expense', '🚌'], ['购物', 'expense', '🛍️'],
  ['居住', 'expense', '🏠'], ['娱乐', 'expense', '🎮'], ['医疗', 'expense', '💊'],
  ['教育', 'expense', '📚'], ['人情', 'expense', '🎁'], ['数码', 'expense', '📱'],
  ['其他', 'expense', '📦'],
  ['工资', 'income', '💰'], ['奖金', 'income', '🧧'], ['兼职', 'income', '🛠️'],
  ['理财', 'income', '📈'], ['报销', 'income', '🧾'], ['其他', 'income', '💵'],
];

const state = {
  month: thisMonth(),
  tab: 'add',
  allRecords: [],   // 含删除标记（同步用）
  allCategories: [],
  records: [],      // 当月可见
  categories: [],   // 活跃分类
  stats: null,
  form: { type: 'expense', categoryId: null, amount: '', note: '', date: todayStr(), editingId: null },
};

async function reload() {
  state.allRecords = await idbAll('records');
  state.allCategories = await idbAll('categories');
  state.categories = state.allCategories.filter((c) => !c.deleted);
  const month = state.month;
  state.records = state.allRecords
    .filter((r) => !r.deleted && r.date.startsWith(month))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id.localeCompare(a.id)));
  computeStats();
  render();
}

function computeStats() {
  const recs = state.records;
  let income = 0, expense = 0;
  const byCat = new Map(), daily = new Map();
  for (const r of recs) {
    if (r.type === 'income') income += r.amount; else expense += r.amount;
    const key = r.catId + r.type;
    const b = byCat.get(key) || { name: r.catName, icon: r.catIcon, type: r.type, amount: 0, count: 0 };
    b.amount += r.amount; b.count += 1; byCat.set(key, b);
    const d = daily.get(r.date) || { date: r.date, income: 0, expense: 0 };
    d[r.type] += r.amount; daily.set(r.date, d);
  }
  state.stats = {
    income, expense, net: income - expense,
    byCategory: Array.from(byCat.values()).sort((a, b) => b.amount - a.amount),
    daily: Array.from(daily.values()).sort((a, b) => (a.date < b.date ? -1 : 1)),
  };
}

/* ---------------- toast ---------------- */
let toastTimer = null;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}

/* ---------------- 同步 ---------------- */
let syncing = false;
let syncTimer = null;
function scheduleSync() {
  if (!settings.token) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => doSync('auto'), 4000);
}
async function doSync(kind) {
  if (!settings.token) {
    if (kind === 'manual') toast('请先在“设置”里填写 GitHub Token', true);
    updateSyncChip();
    return;
  }
  if (syncing) return;
  syncing = true;
  updateSyncChip();
  try {
    const local = { records: state.allRecords, categories: state.allCategories };
    const res = await JZ.syncNow(settings, local);
    settings.gistId = res.gistId;
    settings.lastSync = Date.now();
    settings.lastError = '';
    saveSettings();
    await idbPut('records', res.records);
    await idbPut('categories', res.categories);
    await reload();
    if (kind === 'manual') toast(res.created ? '已创建云端账本并同步 ✓' : '同步完成 ✓');
  } catch (e) {
    settings.lastError = e.message;
    saveSettings();
    toast('同步失败：' + e.message, true);
  } finally {
    syncing = false;
    updateSyncChip();
    if (state.tab === 'set') render();
  }
}
function updateSyncChip() {
  const chip = $('#sync-chip');
  if (!chip) return;
  let cls = 'off', title = '未配置同步（数据只存在本机）';
  if (syncing) { cls = 'busy'; title = '正在同步…'; }
  else if (settings.token) {
    if (settings.lastError) { cls = 'err'; title = '上次同步失败：' + settings.lastError; }
    else if (settings.lastSync) {
      cls = 'ok';
      title = '已同步 ' + new Date(settings.lastSync).toLocaleString('zh-CN');
    } else { cls = 'warn'; title = '已配置 Token，等待首次同步'; }
  }
  chip.className = 'sync-chip ' + cls;
  chip.title = title;
}

/* ---------------- 顶栏 ---------------- */
function renderHeader() {
  $('#month-label').textContent = monthLabel(state.month);
  const s = state.stats;
  $('#sum-expense').textContent = '¥' + fmt(s.expense);
  $('#sum-income').textContent = '¥' + fmt(s.income);
  $('#sum-net').textContent = (s.net < 0 ? '-¥' : '¥') + fmt(Math.abs(s.net));
  updateSyncChip();
}

/* ---------------- 记一笔 ---------------- */
function renderAdd() {
  const f = state.form;
  const cats = state.categories.filter((c) => c.type === f.type);
  const editing = f.editingId != null;
  const view = $('#view');
  view.innerHTML = `
    <div class="card">
      <div class="type-switch">
        <button data-type="expense" class="${f.type === 'expense' ? 'on-expense' : ''}">支出</button>
        <button data-type="income" class="${f.type === 'income' ? 'on-income' : ''}">收入</button>
      </div>
      <div class="amount-box">
        <span class="yen">¥</span>
        <input id="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(f.amount)}">
      </div>
      <div class="cat-grid" id="cat-grid">
        ${cats.map((c) => `
          <div class="cat ${c.id === f.categoryId ? 'sel' : ''}" data-cat="${esc(c.id)}">
            <span class="ico">${esc(c.icon)}</span><span>${esc(c.name)}</span>
          </div>`).join('')}
        <div class="cat add-cat" data-addcat="1"><span class="ico">＋</span><span>新分类</span></div>
      </div>
      <div class="field"><label>日期</label><input type="date" id="f-date" value="${esc(f.date)}"></div>
      <div class="field"><label>备注</label><input id="f-note" maxlength="60" placeholder="选填" value="${esc(f.note)}"></div>
      ${editing ? `
        <div class="edit-actions">
          <button class="btn-ghost btn-danger" id="btn-del">删除</button>
          <button class="btn-ghost" id="btn-cancel">取消</button>
          <button class="save-btn" id="btn-save">更新</button>
        </div>` : `
        <button class="save-btn" id="btn-save">保存</button>`}
    </div>`;

  view.querySelectorAll('.type-switch button').forEach((b) => {
    b.onclick = () => { f.type = b.dataset.type; f.categoryId = null; render(); };
  });
  view.querySelectorAll('.cat[data-cat]').forEach((el) => {
    el.onclick = () => { f.categoryId = el.dataset.cat; render(); };
  });
  view.querySelector('[data-addcat]').onclick = addCategory;
  view.querySelector('#amount').oninput = (e) => { f.amount = e.target.value; };
  view.querySelector('#f-date').onchange = (e) => { f.date = e.target.value; };
  view.querySelector('#f-note').oninput = (e) => { f.note = e.target.value; };
  view.querySelector('#btn-save').onclick = saveRecord;
  if (editing) {
    view.querySelector('#btn-del').onclick = deleteRecord;
    view.querySelector('#btn-cancel').onclick = () => { resetForm(); render(); };
  }
}

function resetForm(keepType = true) {
  const type = keepType ? state.form.type : 'expense';
  state.form = { type, categoryId: null, amount: '', note: '', date: todayStr(), editingId: null };
}

async function addCategory() {
  const name = prompt(`新的${state.form.type === 'expense' ? '支出' : '收入'}分类名称：`);
  if (!name || !name.trim()) return;
  const icon = (prompt('配一个表情图标（可留空，直接确定用默认）：', '📦') || '📦').trim();
  const cat = { id: genId(), name: name.trim().slice(0, 20), type: state.form.type, icon: icon.slice(0, 8) || '📦', updatedAt: Date.now(), deleted: false };
  state.allCategories.push(cat);
  await idbPut('categories', cat);
  state.form.categoryId = cat.id;
  await reload();
  scheduleSync();
  toast(`已添加分类「${cat.name}」`);
}

function formPayload() {
  const f = state.form;
  const amount = f.amount.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) { toast('请输入正确的金额（大于0，最多两位小数）', true); return null; }
  if (!f.categoryId) { toast('请选择一个分类', true); return null; }
  if (!f.date) { toast('请选择日期', true); return null; }
  const cat = state.categories.find((c) => c.id === f.categoryId);
  if (!cat) { toast('分类不存在，请重新选择', true); return null; }
  return {
    type: f.type,
    amount: Math.round(Number(amount) * 100),
    catId: cat.id, catName: cat.name, catIcon: cat.icon,
    date: f.date, note: f.note.trim().slice(0, 200),
  };
}

async function saveRecord() {
  const data = formPayload();
  if (!data) return;
  const now = Date.now();
  let rec;
  if (state.form.editingId != null) {
    rec = Object.assign({}, state.allRecords.find((r) => r.id === state.form.editingId), data, { updatedAt: now });
    toast('已更新');
    state.tab = 'list';
  } else {
    rec = Object.assign({ id: genId(), deleted: false }, data, { updatedAt: now });
    state.allRecords.push(rec);
    toast('已记一笔 ✓');
  }
  await idbPut('records', rec);
  resetForm();
  await reload();
  scheduleSync();
}

async function deleteRecord() {
  const id = state.form.editingId;
  if (id == null) return;
  if (!confirm('确定删除这条记录吗？')) return;
  const rec = state.allRecords.find((r) => r.id === id);
  if (rec) {
    rec.deleted = true;
    rec.updatedAt = Date.now();
    await idbPut('records', rec);
  }
  toast('已删除');
  resetForm();
  state.tab = 'list';
  await reload();
  scheduleSync();
}

/* ---------------- 明细 ---------------- */
function renderList() {
  const view = $('#view');
  if (!state.records.length) {
    view.innerHTML = `<div class="empty"><span class="big">🗒️</span>${monthLabel(state.month)}还没有记录<br>去「记一笔」开始吧</div>`;
    return;
  }
  const groups = new Map();
  for (const r of state.records) {
    if (!groups.has(r.date)) groups.set(r.date, []);
    groups.get(r.date).push(r);
  }
  let html = '';
  for (const [date, list] of groups) {
    let exp = 0, inc = 0;
    for (const r of list) (r.type === 'expense' ? (exp += r.amount) : (inc += r.amount));
    html += `<div class="day-group">
      <div class="day-head"><span>${dayLabel(date)}</span>
        <span class="day-total">支出 ¥${fmt(exp)}${inc > 0 ? ` · 收入 ¥${fmt(inc)}` : ''}</span></div>`;
    for (const r of list) {
      html += `<div class="rec" data-id="${esc(r.id)}">
        <div class="ico">${esc(r.catIcon)}</div>
        <div class="mid"><div class="name">${esc(r.catName)}</div>
          <div class="note">${esc(r.note) || '无备注'}</div></div>
        <div class="amt ${r.type}">${r.type === 'expense' ? '-' : '+'}¥${fmt(r.amount)}</div>
      </div>`;
    }
    html += '</div>';
  }
  view.innerHTML = html;
  view.querySelectorAll('.rec').forEach((el) => {
    el.onclick = () => {
      const r = state.records.find((x) => x.id === el.dataset.id);
      if (!r) return;
      state.form = {
        type: r.type, categoryId: r.catId, amount: String(r.amount / 100),
        note: r.note, date: r.date, editingId: r.id,
      };
      state.tab = 'add';
      render();
    };
  });
}

/* ---------------- 统计 ---------------- */
function setupCanvas(canvas, w, h) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function drawPie(ctx, slices, total) {
  const cx = 75, cy = 75, R = 62, r = 36;
  let a = -Math.PI / 2;
  if (!slices.length) {
    ctx.fillStyle = '#e8eaf2';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.arc(cx, cy, r, 0, Math.PI * 2, true); ctx.fill();
  }
  for (const s of slices) {
    const a2 = a + (s.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, a, a2);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
    a = a2;
  }
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#22263a';
  ctx.textAlign = 'center';
  ctx.font = '600 11px sans-serif';
  ctx.fillText('支出', cx, cy - 8);
  ctx.font = '700 13px sans-serif';
  ctx.fillText('¥' + fmt(total), cx, cy + 10);
}

function drawBars(ctx, days, expByDay, incByDay, W, H) {
  const padL = 6, padR = 6, padT = 10, padB = 20;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  let max = 0;
  for (let d = 1; d <= days; d++) max = Math.max(max, expByDay[d] || 0, incByDay[d] || 0);
  if (max <= 0) max = 1;
  ctx.strokeStyle = '#e8eaf2';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 2; i++) {
    const y = padT + (plotH * i) / 2;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
  }
  const slot = plotW / days;
  const bw = Math.max(2, Math.min(7, slot * 0.32));
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  for (let d = 1; d <= days; d++) {
    const x = padL + slot * (d - 0.5);
    const eh = ((expByDay[d] || 0) / max) * plotH;
    const ih = ((incByDay[d] || 0) / max) * plotH;
    if (eh > 0) { ctx.fillStyle = '#e5533c'; ctx.fillRect(x - bw - 0.5, padT + plotH - eh, bw, eh); }
    if (ih > 0) { ctx.fillStyle = '#1aad6e'; ctx.fillRect(x + 0.5, padT + plotH - ih, bw, ih); }
    ctx.fillStyle = '#8a90a6';
    if (d === 1 || d % 5 === 0 || d === days) ctx.fillText(String(d), x, H - 6);
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = '#8a90a6';
  ctx.font = '10px sans-serif';
  ctx.fillText('¥' + fmt(max), padL + 2, padT + 9);
}

function renderStats() {
  const view = $('#view');
  const s = state.stats;
  const expCats = s.byCategory.filter((c) => c.type === 'expense');
  const incCats = s.byCategory.filter((c) => c.type === 'income');
  const legend = (cats, total) => cats.map((c, i) => `
    <div class="legend-item">
      <span class="dot" style="background:${PALETTE[i % PALETTE.length]}"></span>
      <span class="l-name">${esc(c.icon)} ${esc(c.name)}</span>
      <span class="l-val">¥${fmt(c.amount)}</span>
      <span class="l-pct">${total > 0 ? Math.round((c.amount / total) * 100) : 0}%</span>
    </div>`).join('') || '<div class="legend-item" style="color:#8a90a6">暂无数据</div>';

  view.innerHTML = `
    <div class="stat-nums">
      <div class="stat-num"><div class="k">总支出</div><div class="v" style="color:var(--expense)">¥${fmt(s.expense)}</div></div>
      <div class="stat-num"><div class="k">总收入</div><div class="v" style="color:var(--income)">¥${fmt(s.income)}</div></div>
      <div class="stat-num"><div class="k">结余</div><div class="v">¥${fmt(s.net)}</div></div>
    </div>
    <div class="card">
      <div class="chart-title">支出分类占比</div>
      <div class="pie-wrap">
        <canvas id="pie"></canvas>
        <div class="legend">${legend(expCats, s.expense)}</div>
      </div>
    </div>
    <div class="card">
      <div class="chart-title">每日收支（<span style="color:var(--expense)">■ 支出</span> / <span style="color:var(--income)">■ 收入</span>）</div>
      <canvas id="bars"></canvas>
    </div>
    ${incCats.length ? `<div class="card"><div class="chart-title">收入分类</div><div class="legend">${legend(incCats, s.income)}</div></div>` : ''}`;

  const [y, m] = state.month.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const expByDay = {}, incByDay = {};
  for (const d of s.daily) {
    const day = Number(d.date.slice(8, 10));
    expByDay[day] = d.expense; incByDay[day] = d.income;
  }

  const pie = view.querySelector('#pie');
  const pctx = setupCanvas(pie, 150, 150);
  const slices = expCats.map((c, i) => ({ value: c.amount, color: PALETTE[i % PALETTE.length] }));
  drawPie(pctx, slices, s.expense);

  const bars = view.querySelector('#bars');
  const W = Math.max(200, (view.clientWidth || 360) - 56);
  const bctx = setupCanvas(bars, W, 170);
  drawBars(bctx, days, expByDay, incByDay, W, 170);
}

/* ---------------- 设置 ---------------- */
function renderSettings() {
  const view = $('#view');
  const lastSync = settings.lastSync ? new Date(settings.lastSync).toLocaleString('zh-CN') : '从未';
  view.innerHTML = `
    <div class="card">
      <h3>多设备同步（GitHub 私有账本）</h3>
      <div class="field">
        <input id="set-token" type="password" placeholder="粘贴 GitHub Token（gist 权限）" value="${esc(settings.token)}">
      </div>
      <div class="set-actions">
        <button class="save-btn" id="btn-save-token">保存 Token</button>
        <button class="btn-ghost" id="btn-sync-now">立即同步</button>
      </div>
      <div class="set-status">
        <div>同步状态：<b id="set-status-txt">${settings.token ? '已配置' : '未配置（数据只存本机）'}</b></div>
        <div>上次同步：${esc(lastSync)}</div>
        ${settings.lastError ? `<div class="err-txt">上次失败：${esc(settings.lastError)}</div>` : ''}
        <div>云端账本：${settings.gistId ? esc(settings.gistId) : '（首次同步时自动创建）'}</div>
        <div>本机设备号：${esc(settings.deviceId)}</div>
      </div>
      <div class="set-help">
        1. 在电脑浏览器打开
        <a href="https://github.com/settings/tokens/new?scopes=gist&description=jizhang-app" target="_blank" rel="noopener">github.com → 生成 Token 页面</a>，
        只勾选 <b>gist</b>，生成后复制；<br>
        2. 粘贴到上面保存，立即同步一次；<br>
        3. 手机打开同样的网址，装成 App，在设置里粘贴<b>同一个 Token</b>，
        会自动连上同一个云端账本，两端记账互通。<br>
        不配置也能用：数据保存在本机，只是不跨设备。
      </div>
    </div>
    <div class="card">
      <h3>关于</h3>
      <div class="set-help">
        记账本离线版：断网、电脑关机都能记账，联网后自动同步。<br>
        数据双保险：本机一份 + GitHub 私有 Gist 一份（只有你的账号可见）。
      </div>
    </div>`;

  view.querySelector('#btn-save-token').onclick = async () => {
    settings.token = view.querySelector('#set-token').value.trim();
    if (settings.token) { settings.gistId = ''; settings.lastError = ''; }
    saveSettings();
    render();
    if (settings.token) { toast('Token 已保存，开始同步…'); doSync('manual'); }
  };
  view.querySelector('#btn-sync-now').onclick = () => doSync('manual');
}

/* ---------------- 渲染入口 ---------------- */
function render() {
  renderHeader();
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === state.tab));
  if (state.tab === 'add') renderAdd();
  else if (state.tab === 'list') renderList();
  else if (state.tab === 'stats') renderStats();
  else renderSettings();
}

/* ---------------- 事件 ---------------- */
function shiftMonth(delta) {
  const [y, m] = state.month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  state.month = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  reload();
}

$('#prev-month').onclick = () => shiftMonth(-1);
$('#next-month').onclick = () => shiftMonth(1);
$('#this-month').onclick = () => { if (state.month !== thisMonth()) { state.month = thisMonth(); reload(); } };
document.querySelectorAll('.tab').forEach((t) => {
  t.onclick = () => { state.tab = t.dataset.tab; render(); };
});
window.addEventListener('resize', () => { if (state.tab === 'stats') renderStats(); });
window.addEventListener('online', () => { if (settings.token) doSync('auto'); });

/* ---------------- 启动 ---------------- */
(async function init() {
  settings = loadSettings();
  saveSettings();
  const cats = await idbAll('categories');
  if (!cats.length) {
    const now = Date.now();
    const seeds = SEED_CATEGORIES.map((c, i) => ({
      id: 'seed-' + (i + 1), name: c[0], type: c[1], icon: c[2], updatedAt: now, deleted: false,
    }));
    await idbPut('categories', seeds);
  }
  await reload();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  if (settings.token) doSync('boot');
})().catch((e) => toast('初始化失败：' + e.message, true));
