'use strict';
/* 记账本前端 —— 离线优先：数据存本机 localStorage，联网时经 GitHub Gist 多设备同步 */

const $ = (s) => document.querySelector(s);
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const PALETTE = ['#3e63dd', '#e5484d', '#f76b15', '#46a758', '#8e4ec6', '#12a594',
  '#d6409f', '#946800', '#5b7083', '#0090ff', '#6e56cf', '#e18d07'];

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

/* ---------------- 本机存储（localStorage） ---------------- */
const LS_DATA = 'jizhang-data';
const LS_SET = 'jizhang-settings';
let settings = null;

function loadData() {
  try {
    const d = JSON.parse(localStorage.getItem(LS_DATA) || '{}');
    return {
      records: Array.isArray(d.records) ? d.records : [],
      categories: Array.isArray(d.categories) ? d.categories : [],
      ledgers: Array.isArray(d.ledgers) ? d.ledgers : [],
    };
  } catch (e) { return { records: [], categories: [], ledgers: [] }; }
}
function persist() {
  try {
    localStorage.setItem(LS_DATA, JSON.stringify({
      records: state.allRecords, categories: state.allCategories, ledgers: state.allLedgers,
    }));
    return true;
  } catch (e) {
    toast('本机存储空间不足，请导出或清理数据', true);
    return false;
  }
}

function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(LS_SET) || '{}'); } catch (e) { /* ignore */ }
  s.token = s.token || '';
  s.gistId = s.gistId || '';
  s.deviceId = s.deviceId || ('dev-' + Math.random().toString(36).slice(2, 8));
  s.lastSync = s.lastSync || 0;
  s.lastError = s.lastError || '';
  return s;
}
function saveSettings() { localStorage.setItem(LS_SET, JSON.stringify(settings)); }

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
  ledgerId: 'main',
  dayFilter: null,
  allRecords: [],
  allCategories: [],
  allLedgers: [],
  records: [],
  categories: [],
  ledgers: [],
  stats: null,
  form: { type: 'expense', categoryId: null, amount: '', note: '', date: todayStr(), editingId: null },
};

function reload() {
  const d = loadData();
  state.allRecords = d.records;
  state.allCategories = d.categories;
  state.allLedgers = d.ledgers;
  state.ledgers = state.allLedgers.filter((L) => !L.deleted);
  if (!state.ledgers.some((L) => L.id === state.ledgerId)) state.ledgerId = 'main';
  state.categories = state.allCategories.filter((c) => !c.deleted);
  const month = state.month, lid = state.ledgerId;
  state.records = state.allRecords
    .filter((r) => !r.deleted && (r.ledgerId || 'main') === lid && r.date.startsWith(month))
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
    const local = { records: state.allRecords, categories: state.allCategories, ledgers: state.allLedgers };
    const res = await JZ.syncNow(settings, local);
    settings.gistId = res.gistId;
    settings.lastSync = Date.now();
    settings.lastError = '';
    saveSettings();
    state.allRecords = res.records;
    state.allCategories = res.categories;
    state.allLedgers = res.ledgers || [];
    persist();
    reload();
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
  let cls = 'off', text = '未配置';
  if (syncing) { cls = 'busy'; text = '同步中'; }
  else if (settings.token) {
    if (settings.lastError) { cls = 'err'; text = '同步失败'; }
    else if (settings.lastSync) { cls = 'ok'; text = '已同步'; }
    else { cls = 'warn'; text = '待同步'; }
  }
  chip.className = 'sync-chip ' + cls;
  chip.querySelector('b').textContent = text;
  chip.title = settings.token
    ? (settings.lastError ? '上次同步失败：' + settings.lastError
       : settings.lastSync ? '已同步 ' + new Date(settings.lastSync).toLocaleString('zh-CN') : '等待首次同步')
    : '未配置同步（数据只存在本机）';
}

/* ---------------- 顶栏 + 结余卡 ---------------- */
function renderHeader() {
  $('#month-label').textContent = monthLabel(state.month);
  const cur = state.ledgers.find((L) => L.id === state.ledgerId);
  $('.hero-k').textContent = (cur && cur.id !== 'main' ? cur.name + ' · ' : '') + '本月结余';
  const s = state.stats;
  $('#sum-expense').textContent = '¥' + fmt(s.expense);
  $('#sum-income').textContent = '¥' + fmt(s.income);
  const net = $('#sum-net');
  net.textContent = (s.net < 0 ? '-¥' : '¥') + fmt(Math.abs(s.net));
  net.classList.toggle('neg', s.net < 0);
  updateSyncChip();
}

/* ---------------- 账本切换 ---------------- */
function renderLedgers() {
  const el = $('#ledger-row');
  if (!el) return;
  el.innerHTML = state.ledgers.map((L) => `
    <button class="lchip ${L.id === state.ledgerId ? 'on' : ''}" data-ledger="${esc(L.id)}">${esc(L.icon)} ${esc(L.name)}</button>`).join('') +
    `<button class="lchip lchip-add" id="btn-add-ledger">＋ 新账本</button>`;
  el.querySelectorAll('[data-ledger]').forEach((b) => {
    b.onclick = () => { state.ledgerId = b.dataset.ledger; reload(); };
  });
  el.querySelector('#btn-add-ledger').onclick = addLedger;
}

function addLedger() {
  const name = prompt('新账本名称（如：国庆旅行、装修）：');
  if (!name || !name.trim()) return;
  const icon = (prompt('选一个图标（表情，可留空）：', '🗂️') || '🗂️').trim() || '🗂️';
  const L = { id: genId(), name: name.trim().slice(0, 12), icon: icon.slice(0, 8), updatedAt: Date.now(), deleted: false };
  state.allLedgers.push(L);
  if (!persist()) return;
  state.ledgerId = L.id;
  reload();
  scheduleSync();
  toast(`已创建账本「${L.name}」`);
}

function renameLedger(id) {
  const L = state.allLedgers.find((x) => x.id === id && !x.deleted);
  if (!L) return;
  const name = prompt('重命名账本：', L.name);
  if (!name || !name.trim()) return;
  L.name = name.trim().slice(0, 12);
  L.updatedAt = Date.now();
  persist();
  reload();
  scheduleSync();
  toast('已重命名');
}

function deleteLedger(id) {
  const L = state.allLedgers.find((x) => x.id === id && !x.deleted);
  if (!L || id === 'main') return;
  const n = state.allRecords.filter((r) => !r.deleted && (r.ledgerId || 'main') === id).length;
  if (!confirm(`删除账本「${L.name}」？其中 ${n} 条记录也会一并删除。`)) return;
  L.deleted = true;
  L.updatedAt = Date.now();
  for (const r of state.allRecords) {
    if (!r.deleted && (r.ledgerId || 'main') === id) { r.deleted = true; r.updatedAt = Date.now(); }
  }
  if (state.ledgerId === id) state.ledgerId = 'main';
  persist();
  reload();
  scheduleSync();
  toast('已删除账本');
}

/* ---------------- 记一笔 ---------------- */
function renderAdd() {
  const f = state.form;
  const cats = state.categories.filter((c) => c.type === f.type);
  const editing = f.editingId != null;
  const view = $('#view');
  view.innerHTML = `
    <div class="card">
      <div class="seg">
        <button data-type="expense" class="${f.type === 'expense' ? 'on' : ''}">支出</button>
        <button data-type="income" class="${f.type === 'income' ? 'on' : ''}">收入</button>
      </div>
      <div class="amount-row">
        <span class="yen">¥</span>
        <input id="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(f.amount)}">
      </div>
      <div class="cat-grid">
        ${cats.map((c) => `
          <button class="cat ${c.id === f.categoryId ? 'sel' : ''}" data-cat="${esc(c.id)}">
            <span class="cico">${esc(c.icon)}</span><span class="cname">${esc(c.name)}</span>
          </button>`).join('')}
        <button class="cat add-cat" data-addcat="1">
          <span class="cico">＋</span><span class="cname">新分类</span>
        </button>
      </div>
      <div class="frow"><span class="fk">日期</span><input type="date" id="f-date" value="${esc(f.date)}"></div>
      <div class="frow"><span class="fk">备注</span><input id="f-note" maxlength="60" placeholder="选填" value="${esc(f.note)}"></div>
      ${editing ? `
        <div class="edit-actions">
          <button class="btn-ghost btn-danger" id="btn-del">删除</button>
          <button class="btn-ghost" id="btn-cancel">取消</button>
          <button class="btn-primary" id="btn-save">更新</button>
        </div>` : `
        <button class="btn-primary" id="btn-save">保存</button>`}
    </div>`;

  view.querySelectorAll('.seg button').forEach((b) => {
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

function addCategory() {
  const name = prompt(`新的${state.form.type === 'expense' ? '支出' : '收入'}分类名称：`);
  if (!name || !name.trim()) return;
  const icon = (prompt('配一个表情图标（可留空，直接确定用默认）：', '📦') || '📦').trim();
  const cat = { id: genId(), name: name.trim().slice(0, 20), type: state.form.type, icon: icon.slice(0, 8) || '📦', updatedAt: Date.now(), deleted: false };
  state.allCategories.push(cat);
  if (!persist()) return;
  state.form.categoryId = cat.id;
  reload();
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

function saveRecord() {
  const data = formPayload();
  if (!data) return;
  const now = Date.now();
  if (state.form.editingId != null) {
    const rec = Object.assign({}, state.allRecords.find((r) => r.id === state.form.editingId), data, { updatedAt: now });
    const i = state.allRecords.findIndex((r) => r.id === rec.id);
    if (i >= 0) state.allRecords[i] = rec; else state.allRecords.push(rec);
    toast('已更新');
    state.tab = 'list';
  } else {
    state.allRecords.push(Object.assign({ id: genId(), ledgerId: state.ledgerId, deleted: false }, data, { updatedAt: now }));
    toast('已记一笔 ✓');
  }
  if (!persist()) return;
  resetForm();
  reload();
  scheduleSync();
}

function deleteRecord() {
  const id = state.form.editingId;
  if (id == null) return;
  if (!confirm('确定删除这条记录吗？')) return;
  const rec = state.allRecords.find((r) => r.id === id);
  if (rec) {
    rec.deleted = true;
    rec.updatedAt = Date.now();
    persist();
  }
  toast('已删除');
  resetForm();
  state.tab = 'list';
  reload();
  scheduleSync();
}

/* ---------------- 明细 ---------------- */
function renderList() {
  const view = $('#view');
  let recs = state.records;
  let filterBar = '';
  if (state.dayFilter) {
    recs = recs.filter((r) => r.date === state.dayFilter);
    filterBar = `<div class="day-filter"><span>📅 ${dayLabel(state.dayFilter)}</span>
      <button id="clear-day">看全月 ✕</button></div>`;
  }
  if (!recs.length) {
    view.innerHTML = filterBar + `<div class="empty"><span class="big">🗒️</span>${
      state.dayFilter ? '这一天没有记录' : monthLabel(state.month) + '还没有记录<br>去「记一笔」开始吧'}</div>`;
    bindClearDay(view);
    return;
  }
  const groups = new Map();
  for (const r of recs) {
    if (!groups.has(r.date)) groups.set(r.date, []);
    groups.get(r.date).push(r);
  }
  let html = '<div class="card list-card">';
  for (const [date, list] of groups) {
    let exp = 0, inc = 0;
    for (const r of list) (r.type === 'expense' ? (exp += r.amount) : (inc += r.amount));
    html += `<div class="day-group">
      <div class="day-head"><span>${dayLabel(date)}</span>
        <span class="day-total">支出 ¥${fmt(exp)}${inc > 0 ? ` · 收入 ¥${fmt(inc)}` : ''}</span></div>`;
    for (const r of list) {
      html += `<div class="rrow" data-id="${esc(r.id)}">
        <span class="rico">${esc(r.catIcon)}</span>
        <span class="rmid"><div class="rname">${esc(r.catName)}</div>
          ${r.note ? `<div class="rnote">${esc(r.note)}</div>` : ''}</span>
        <span class="ramt ${r.type}">${r.type === 'expense' ? '-' : '+'}¥${fmt(r.amount)}</span>
      </div>`;
    }
    html += '</div>';
  }
  html += '</div>';
  view.innerHTML = filterBar + html;
  bindClearDay(view);
  view.querySelectorAll('.rrow').forEach((el) => {
    el.onclick = () => {
      const r = state.records.find((x) => x.id === el.dataset.id);
      if (!r) return;
      state.form = {
        type: r.type, categoryId: r.catId, amount: String(r.amount / 100),
        note: r.note || '', date: r.date, editingId: r.id,
      };
      state.tab = 'add';
      render();
    };
  });
}

/* ---------------- 统计 ---------------- */
function bindClearDay(view) {
  const b = view.querySelector('#clear-day');
  if (b) b.onclick = () => { state.dayFilter = null; render(); };
}

function fmtDay(cents) { return (cents / 100).toFixed(2); }

function calendarHtml() {
  const [y, m] = state.month.split('-').map(Number);
  const lead = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const byDate = new Map();
  for (const r of state.records) {
    const t = byDate.get(r.date) || { exp: 0, inc: 0 };
    if (r.type === 'expense') t.exp += r.amount; else t.inc += r.amount;
    byDate.set(r.date, t);
  }
  const today = todayStr();
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<div class="cal-cell pad"></div>';
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${pad2(m)}-${pad2(d)}`;
    const t = byDate.get(ds);
    const cls = 'cal-cell' + (t ? ' has' : '') + (ds === today ? ' today' : '');
    const amt = t
      ? `<span class="ce">${t.exp ? '-' + fmtDay(t.exp) : ''}</span><span class="ci">${t.inc ? '+' + fmtDay(t.inc) : ''}</span>`
      : '<span class="ce"></span><span class="ci"></span>';
    cells += `<div class="${cls}" data-day="${ds}"><span class="cd">${d}</span>${amt}</div>`;
  }
  const wd = ['日', '一', '二', '三', '四', '五', '六'].map((w) => `<span class="cal-wd">${w}</span>`).join('');
  return `<div class="cal-head">${wd}</div><div class="cal-grid">${cells}</div>`;
}

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
  const cx = 70, cy = 70, R = 58, r = 34;
  let a = -Math.PI / 2;
  if (!slices.length) {
    ctx.fillStyle = '#f2f2ef';
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
  ctx.fillStyle = '#1b1d21';
  ctx.textAlign = 'center';
  ctx.font = '500 10px sans-serif';
  ctx.fillText('支出', cx, cy - 9);
  ctx.font = '700 12px sans-serif';
  ctx.fillText('¥' + fmt(total), cx, cy + 8);
}

function drawBars(ctx, days, expByDay, incByDay, W, H) {
  const padL = 6, padR = 6, padT = 12, padB = 20;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  let max = 0;
  for (let d = 1; d <= days; d++) max = Math.max(max, expByDay[d] || 0, incByDay[d] || 0);
  if (max <= 0) max = 1;
  ctx.strokeStyle = '#f0efec';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 2; i++) {
    const y = padT + (plotH * i) / 2;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
  }
  const slot = plotW / days;
  const bw = Math.max(2, Math.min(6, slot * 0.3));
  const round = (x, y, w, h, rad) => {
    if (h <= 0) return;
    rad = Math.min(rad, w / 2, h);
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + rad);
    ctx.arcTo(x, y, x + rad, y, rad);
    ctx.lineTo(x + w - rad, y);
    ctx.arcTo(x + w, y, x + w, y + rad, rad);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fill();
  };
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  for (let d = 1; d <= days; d++) {
    const x = padL + slot * (d - 0.5);
    const eh = ((expByDay[d] || 0) / max) * plotH;
    const ih = ((incByDay[d] || 0) / max) * plotH;
    if (eh > 0) { ctx.fillStyle = '#e5484d'; round(x - bw - 1, padT + plotH - eh, bw, eh, 2); }
    if (ih > 0) { ctx.fillStyle = '#30a46c'; round(x + 1, padT + plotH - ih, bw, ih, 2); }
    ctx.fillStyle = '#b9bdc5';
    if (d === 1 || d % 5 === 0 || d === days) ctx.fillText(String(d), x, H - 6);
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = '#b9bdc5';
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
      <div class="legend-line">
        <span class="l-name">${esc(c.icon)} ${esc(c.name)}</span>
        <span class="l-val">¥${fmt(c.amount)}</span>
        <span class="l-pct">${total > 0 ? Math.round((c.amount / total) * 100) : 0}%</span>
      </div>
      <div class="lbar"><i style="width:${total > 0 ? Math.max(2, (c.amount / total) * 100) : 0}%;background:${PALETTE[i % PALETTE.length]}"></i></div>
    </div>`).join('') || '<div class="legend-line" style="color:#b9bdc5">暂无数据</div>';

  view.innerHTML = `
    <div class="card">
      <div class="chart-title">日历总览 · 点某天看当天明细</div>
      ${calendarHtml()}
    </div>
    <div class="card">
      <div class="chart-title">支出分类占比</div>
      <div class="pie-wrap">
        <canvas id="pie"></canvas>
        <div class="legend">${legend(expCats, s.expense)}</div>
      </div>
    </div>
    <div class="card">
      <div class="chart-title">每日收支（<span style="color:#e5484d">■ 支出</span> / <span style="color:#30a46c">■ 收入</span>）</div>
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
  const pctx = setupCanvas(pie, 140, 140);
  const slices = expCats.map((c, i) => ({ value: c.amount, color: PALETTE[i % PALETTE.length] }));
  drawPie(pctx, slices, s.expense);

  const bars = view.querySelector('#bars');
  const W = Math.max(200, (view.clientWidth || 360) - 60);
  const bctx = setupCanvas(bars, W, 170);
  drawBars(bctx, days, expByDay, incByDay, W, 170);

  view.querySelectorAll('.cal-cell.has').forEach((el) => {
    el.onclick = () => { state.dayFilter = el.dataset.day; state.tab = 'list'; render(); };
  });
}

/* ---------------- 导出账单 ---------------- */
function monthList() {
  let min = null, max = null;
  for (const r of state.allRecords) {
    if (r.deleted) continue;
    const m = r.date.slice(0, 7);
    if (!min || m < min) min = m;
    if (!max || m > max) max = m;
  }
  const nowM = thisMonth();
  if (!min) min = nowM;
  if (!max || max < nowM) max = nowM;
  const out = [];
  let [y, mo] = min.split("-").map(Number);
  const [ey, em] = max.split("-").map(Number);
  while (y < ey || (y === ey && mo <= em)) {
    out.push(`${y}-${pad2(mo)}`);
    mo++;
    if (mo > 12) { mo = 1; y++; }
  }
  return out;
}

function csvCell(s) {
  s = String(s ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportCsv() {
  const lid = $('#exp-ledger').value;
  const from = $('#exp-from').value;
  const to = $('#exp-to').value;
  if (from > to) { toast('开始时间不能晚于结束时间', true); return; }
  const ledgerName = {};
  for (const L of state.allLedgers) ledgerName[L.id] = L.name;
  const rows = state.allRecords
    .filter((r) => !r.deleted
      && (lid === "all" || (r.ledgerId || "main") === lid)
      && r.date >= from + "-01" && r.date <= to + "-31")
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!rows.length) { toast('所选范围内没有记录', true); return; }
  const lines = ["日期,类型,分类,支出,收入,账本,备注"];
  let exp = 0, inc = 0;
  for (const r of rows) {
    const e = r.type === "expense" ? (r.amount / 100).toFixed(2) : "";
    const i = r.type === "income" ? (r.amount / 100).toFixed(2) : "";
    if (r.type === "expense") exp += r.amount; else inc += r.amount;
    lines.push([
      r.date, r.type === "expense" ? "支出" : "收入", csvCell(r.catName),
      e, i, csvCell(ledgerName[r.ledgerId || "main"] || "主账本"), csvCell(r.note || ""),
    ].join(","));
  }
  lines.push(["合计", "", "", (exp / 100).toFixed(2), (inc / 100).toFixed(2), "", ""].join(","));
  const csv = "\ufeff" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `记账本_${from}至${to}${lid === "all" ? "_全部账本" : "_" + (ledgerName[lid] || "")}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  toast(`已导出 ${rows.length} 条记录`);
}

/* ---------------- 设置 ---------------- */
function renderSettings() {
  const view = $('#view');
  const lastSync = settings.lastSync ? new Date(settings.lastSync).toLocaleString('zh-CN') : '从未';
  const ledgerRows = state.ledgers.map((L) => {
    const n = state.allRecords.filter((r) => !r.deleted && (r.ledgerId || 'main') === L.id).length;
    return `<div class="mrow">
      <span class="mico">${esc(L.icon)}</span>
      <span class="mname">${esc(L.name)}<em>${n} 条记录${L.id === 'main' ? ' · 主账本，不可删除' : ''}</em></span>
      ${L.id === 'main' ? '' : `<button class="mini" data-ren="${esc(L.id)}">改名</button><button class="mini danger" data-del="${esc(L.id)}">删除</button>`}
    </div>`;
  }).join('');
  const months = monthList();
  const mOpt = (m, sel) => `<option value="${m}"${sel ? " selected" : ""}>${m.replace("-", "年")}月</option>`;
  const fromOpts = months.map((m, i) => mOpt(m, i === 0)).join("");
  const toOpts = months.map((m, i) => mOpt(m, i === months.length - 1)).join("");
  const ledgerOpts = `<option value="all" selected>全部账本</option>` + state.ledgers.map((L) =>
    `<option value="${esc(L.id)}">${esc(L.icon)} ${esc(L.name)}</option>`).join("");
  view.innerHTML = `
    <div class="card">
      <div class="chart-title">安装成 App</div>
      ${isStandalone
        ? '<div class="set-help">✓ 当前已作为 App 运行（桌面图标打开）</div>'
        : `<div class="set-help">
             <b>安卓（Chrome / Edge）</b>：点页面顶部的「安装」按钮；或右上角 ⋮ 菜单 → 「安装应用 / 添加到主屏幕」。<br>
             <b>iPhone（Safari）</b>：底部分享按钮 → 「添加到主屏幕」。<br>
             请在系统浏览器里打开本页面，微信内置浏览器无法安装。
           </div>`}
    </div>
    <div class="card">
      <div class="chart-title">账本管理</div>
      ${ledgerRows}
    </div>
    <div class="card">
      <div class="chart-title">导出账单</div>
      <div class="frow"><span class="fk">账本</span><select id="exp-ledger">${ledgerOpts}</select></div>
      <div class="frow"><span class="fk">从</span><select id="exp-from">${fromOpts}</select></div>
      <div class="frow"><span class="fk">到</span><select id="exp-to">${toOpts}</select></div>
      <button class="btn-primary" id="btn-export">导出 CSV 文档</button>
      <div class="set-help">按所选账本和时间范围导出，Excel / WPS 可直接打开；文件会保存到手机或电脑的下载目录。</div>
    </div>
    <div class="card">
      <div class="chart-title">多设备同步（GitHub 私有账本）</div>
      <div class="set-row">
        <div class="set-k">GitHub Token（gist 权限）</div>
        <input id="set-token" type="password" placeholder="粘贴 Token" value="${esc(settings.token)}">
      </div>
      <div class="set-actions">
        <button class="btn-primary" id="btn-save-token">保存 Token</button>
        <button class="btn-ghost" id="btn-sync-now">立即同步</button>
      </div>
      <div class="set-status">
        <div>同步状态：<b>${settings.token ? '已配置' : '未配置（数据只存本机）'}</b></div>
        <div>上次同步：<b>${esc(lastSync)}</b></div>
        ${settings.lastError ? `<div class="err-txt">上次失败：${esc(settings.lastError)}</div>` : ''}
        <div>云端账本：${settings.gistId ? esc(settings.gistId) : '（首次同步时自动创建）'}</div>
        <div>本机设备号：${esc(settings.deviceId)}</div>
      </div>
      <div class="set-help">
        1. 打开 <a href="https://github.com/settings/tokens/new?scopes=gist&description=jizhang-app" target="_blank" rel="noopener">github.com Token 页面</a>，只勾选 <b>gist</b>，生成后复制；<br>
        2. 粘贴到上面保存，点“立即同步”；<br>
        3. 另一台设备填<b>同一个 Token</b>，会自动连上同一个云端账本。<br>
        不配置也能用：数据保存在本机，只是不跨设备。
      </div>
    </div>
    <div class="card">
      <div class="chart-title">关于</div>
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
  view.querySelector('#btn-export').onclick = exportCsv;
  view.querySelectorAll('[data-ren]').forEach((b) => { b.onclick = () => renameLedger(b.dataset.ren); });
  view.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => deleteLedger(b.dataset.del); });
}

/* ---------------- 渲染入口 ---------------- */
function render() {
  renderHeader();
  renderLedgers();
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
  state.dayFilter = null;
  reload();
}

$('#prev-month').onclick = () => shiftMonth(-1);
$('#next-month').onclick = () => shiftMonth(1);
$('#this-month').onclick = () => { if (state.month !== thisMonth()) { state.month = thisMonth(); state.dayFilter = null; reload(); } };
document.querySelectorAll('.tab').forEach((t) => {
  t.onclick = () => { state.tab = t.dataset.tab; if (t.dataset.tab !== 'stats') state.dayFilter = null; render(); };
});
window.addEventListener('resize', () => { if (state.tab === 'stats') renderStats(); });
window.addEventListener('online', () => { if (settings.token) doSync('auto'); });

/* ---------------- 安装成 App ---------------- */
let deferredPrompt = null;
const isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
  || window.navigator.standalone === true;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showInstallBanner();
});
window.addEventListener('appinstalled', () => {
  const b = $('#install-banner');
  if (b) b.hidden = true;
});
function showInstallBanner() {
  const b = $('#install-banner');
  if (!b || isStandalone || !deferredPrompt) return;
  if (localStorage.getItem('jizhang-install-dismissed') === '1') return;
  b.hidden = false;
  b.querySelector('#ib-install').onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try {
      const r = await deferredPrompt.userChoice;
      if (r.outcome === 'accepted') b.hidden = true;
    } catch (e) { /* ignore */ }
    deferredPrompt = null;
  };
  b.querySelector('#ib-dismiss').onclick = () => {
    b.hidden = true;
    localStorage.setItem('jizhang-install-dismissed', '1');
  };
}

/* ---------------- 启动 ---------------- */
try {
  settings = loadSettings();
  saveSettings();
  const d0 = loadData();
  state.allRecords = d0.records;
  state.allCategories = d0.categories;
  state.allLedgers = d0.ledgers;
  let dirty = false;
  if (!state.allLedgers.length) {
    state.allLedgers = [{ id: 'main', name: '主账本', icon: '💼', updatedAt: Date.now(), deleted: false }];
    dirty = true;
  }
  if (!state.allCategories.length) {
    const now = Date.now();
    state.allCategories = SEED_CATEGORIES.map((c, i) => ({
      id: 'seed-' + (i + 1), name: c[0], type: c[1], icon: c[2], updatedAt: now, deleted: false,
    }));
    dirty = true;
  }
  if (dirty) persist();
  const h = location.hash.replace('#', '');
  if (['add', 'list', 'stats', 'set'].includes(h)) state.tab = h;
  reload();
  showInstallBanner();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  if (settings.token) doSync('boot');
} catch (e) {
  toast('初始化失败：' + e.message, true);
}
