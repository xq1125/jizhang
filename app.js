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
  s.mirror = s.mirror === undefined ? true : !!s.mirror;
  s.sound = s.sound === undefined ? true : !!s.sound;
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
  multiSel: false,
  selected: new Set(),
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
  const main = lid === 'main';
  state.records = state.allRecords
    .filter((r) => !r.deleted && (r.ledgerId || 'main') === lid && (!main || r.date.startsWith(month)))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id.localeCompare(a.id)));
  computeStats();
  render();
}

function computeStats() {
  const recs = state.records;
  let income = 0, expense = 0;
  const byCat = new Map(), daily = new Map(), byMonth = new Map();
  for (const r of recs) {
    if (r.type === 'income') income += r.amount; else expense += r.amount;
    const key = r.catId + r.type;
    const b = byCat.get(key) || { name: r.catName, icon: r.catIcon, type: r.type, amount: 0, count: 0 };
    b.amount += r.amount; b.count += 1; byCat.set(key, b);
    const d = daily.get(r.date) || { date: r.date, income: 0, expense: 0 };
    d[r.type] += r.amount; daily.set(r.date, d);
    const mk = r.date.slice(0, 7);
    const mm = byMonth.get(mk) || { month: mk, income: 0, expense: 0 };
    mm[r.type] += r.amount; byMonth.set(mk, mm);
  }
  state.stats = {
    income, expense, net: income - expense,
    byCategory: Array.from(byCat.values()).sort((a, b) => b.amount - a.amount),
    daily: Array.from(daily.values()).sort((a, b) => (a.date < b.date ? -1 : 1)),
    byMonth: Array.from(byMonth.values()).sort((a, b) => (a.month < b.month ? -1 : 1)),
  };
}

/* ---------------- toast ---------------- */
let toastTimer = null;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  if (isErr) sfx('error');
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
    rebuildMirrors();
    reload();
    if (kind === 'manual') { toast(res.created ? '已创建云端账本并同步 ✓' : '同步完成 ✓'); sfx('sync'); }
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

/* ---------------- 音效与震动 ---------------- */
let audioCtx = null;
function sfx(name) {
  if (!settings || !settings.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    const tone = (freq, start, dur, type, gain) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t + start);
      g.gain.linearRampToValueAtTime(gain || 0.1, t + start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
      o.connect(g).connect(audioCtx.destination);
      o.start(t + start);
      o.stop(t + start + dur + 0.05);
    };
    if (name === 'save') { tone(660, 0, 0.12); tone(880, 0.09, 0.2); }
    else if (name === 'tap') { tone(1200, 0, 0.04, 'triangle', 0.045); }
    else if (name === 'delete') { tone(220, 0, 0.16, 'triangle', 0.09); }
    else if (name === 'error') { tone(170, 0, 0.22, 'sawtooth', 0.05); }
    else if (name === 'sync') { tone(523, 0, 0.1, 'sine', 0.07); tone(659, 0.08, 0.1, 'sine', 0.07); tone(784, 0.16, 0.18, 'sine', 0.08); }
  } catch (e) { /* ignore */ }
}
function buzz(pattern) {
  if (!settings || !settings.sound) return;
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* ignore */ }
}

/* ---------------- 数字滚动 ---------------- */
function setNum(el, cents) {
  const prev = el._val == null ? cents : el._val;
  el._val = cents;
  if (prev === cents) {
    el.textContent = (cents < 0 ? '-¥' : '¥') + fmt(Math.abs(cents));
    return;
  }
  const dur = 420;
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    const v = prev + (cents - prev) * eased;
    el.textContent = (v < 0 ? '-¥' : '¥') + fmt(Math.abs(v));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

/* ---------------- 顶栏 + 结余卡 ---------------- */
function renderHeader() {
  const main = state.ledgerId === 'main';
  $('#month-label').textContent = main ? monthLabel(state.month) : '全部时间';
  $('#prev-month').style.display = main ? '' : 'none';
  $('#next-month').style.display = main ? '' : 'none';
  $('#this-month').style.display = main ? '' : 'none';
  $('.hero-k').textContent = main ? '本月支出' : '总支出';
  const s = state.stats;
  setNum($('#sum-expense'), s.expense);
  setNum($('#sum-income'), s.income);
  const net = $('#sum-net');
  setNum(net, s.net);
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
    b.onclick = () => { state.ledgerId = b.dataset.ledger; sfx('tap'); reload(); };
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
  rebuildMirrors();
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
  rebuildMirrors();
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
  rebuildMirrors();
  reload();
  scheduleSync();
  toast('已删除账本');
}

/* ---------------- 小账本每日汇总（镜像进主账本） ---------------- */
const SYS_HUIZONG = { id: 'sys-cat-huizong', name: '活动汇总', type: 'expense', icon: '🗂️' };
const LEDGER_KEYWORDS = {
  'imp-jp': ['日本'], 'imp-cx': ['川西'], 'imp-whqd': ['青岛', '威海'], 'imp-cs': ['长沙'],
  'imp-xn': ['咸宁'], 'imp-ly': ['洛阳'], 'imp-jd': ['景德镇'], 'imp-bday': ['生日'],
  'imp-xq66': ['星邱'], 'imp-xq1121': ['星邱'],
};

function ledgerKeywords(L) {
  return LEDGER_KEYWORDS[L.id] || [L.name];
}

function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function findLedgerLink(r) {
  if (r.mirror && r.mirror.ledgerId) {
    const L = state.allLedgers.find((x) => x.id === r.mirror.ledgerId && !x.deleted);
    if (L) return { lid: L.id, date: r.mirror.date, label: L.icon + ' ' + L.name };
  }
  if (state.ledgerId === 'main' && r.note) {
    for (const L of state.ledgers) {
      if (L.id === 'main') continue;
      try {
        if (new RegExp('(' + ledgerKeywords(L).map(escRe).join('|') + ')').test(r.note)) {
          return { lid: L.id, date: null, label: '🔗 ' + L.name };
        }
      } catch (e) { /* ignore */ }
    }
  }
  return null;
}

function jumpToLedger(lid, date) {
  state.ledgerId = lid;
  state.dayFilter = date || null;
  state.tab = 'list';
  reload();
}

function ensureHuizongCat() {
  if (!state.allCategories.some((c) => c.id === SYS_HUIZONG.id)) {
    state.allCategories.push(Object.assign({}, SYS_HUIZONG, { updatedAt: Date.now(), deleted: false }));
  }
}

function rebuildMirrors() {
  if (!settings.mirror) return false;
  ensureHuizongCat();
  const now = Date.now();
  const want = new Map();
  for (const L of state.allLedgers.filter((x) => !x.deleted && x.id !== 'main')) {
    const byDate = new Map();
    for (const r of state.allRecords) {
      if (r.deleted || r.mirror || (r.ledgerId || 'main') !== L.id || r.type !== 'expense') continue;
      byDate.set(r.date, (byDate.get(r.date) || 0) + r.amount);
    }
    for (const [date, cents] of byDate) {
      want.set('mirror-' + L.id + '-' + date, { cents, date, name: L.name, lid: L.id });
    }
  }
  let changed = false;
  const byId = new Map(state.allRecords.map((r) => [r.id, r]));
  for (const [mid, w] of want) {
    const rec = {
      id: mid, ledgerId: 'main', type: 'expense', amount: w.cents,
      catId: SYS_HUIZONG.id, catName: SYS_HUIZONG.name, catIcon: SYS_HUIZONG.icon,
      date: w.date, note: `「${w.name}」当日汇总`, updatedAt: now, deleted: false,
      mirror: { ledgerId: w.lid, date: w.date },
    };
    const ex = byId.get(mid);
    if (!ex || ex.deleted || ex.amount !== w.cents || ex.note !== rec.note) {
      if (ex) Object.assign(ex, rec); else state.allRecords.push(rec);
      changed = true;
    }
  }
  for (const r of state.allRecords) {
    if (r.mirror && !r.deleted && !want.has(r.id)) { r.deleted = true; r.updatedAt = now; changed = true; }
  }
  if (changed) persist();
  return changed;
}

function clearMirrors() {
  let changed = false;
  const now = Date.now();
  for (const r of state.allRecords) {
    if (r.mirror && !r.deleted) { r.deleted = true; r.updatedAt = now; changed = true; }
  }
  if (changed) persist();
}

/* ---------------- 记一笔 ---------------- */
const EXPAND_LIMIT = 10;
let catsExpanded = false;

function renderAdd() {
  const f = state.form;
  const cats = state.categories.filter((c) => c.type === f.type && c.id !== SYS_HUIZONG.id);
  if (f.categoryId && cats.findIndex((c) => c.id === f.categoryId) >= EXPAND_LIMIT) catsExpanded = true;
  const collapsible = cats.length > EXPAND_LIMIT;
  const shown = (collapsible && !catsExpanded) ? cats.slice(0, EXPAND_LIMIT) : cats;
  const editing = f.editingId != null;
  const view = $('#view');
  view.innerHTML = `
    <div class="card">
      <div class="chart-title">日历总览 · 点某天选为记账日期</div>
      ${calendarHtml(f.date)}
    </div>
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
        ${shown.map((c) => `
          <button class="cat ${c.id === f.categoryId ? 'sel' : ''}" data-cat="${esc(c.id)}">
            <span class="cico">${esc(c.icon)}</span><span class="cname">${esc(c.name)}</span>
          </button>`).join('')}
        ${collapsible ? `
          <button class="cat cat-more" id="cat-more">
            <span class="cico">${catsExpanded ? '∧' : '∨'}</span><span class="cname">${catsExpanded ? '收起' : '展开 ' + (cats.length - EXPAND_LIMIT) + '个'}</span>
          </button>` : ''}
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

  view.querySelectorAll('.cal-cell[data-day]').forEach((el) => {
    el.onclick = () => { f.date = el.dataset.day; render(); };
  });
  view.querySelectorAll('.seg button').forEach((b) => {
    b.onclick = () => { f.type = b.dataset.type; f.categoryId = null; render(); };
  });
  view.querySelectorAll('.cat[data-cat]').forEach((el) => {
    el.onclick = () => { f.categoryId = el.dataset.cat; sfx('tap'); render(); };
  });
  const more = view.querySelector('#cat-more');
  if (more) more.onclick = () => { catsExpanded = !catsExpanded; render(); };
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
  sfx('save');
  buzz(35);
  if (!persist()) return;
  rebuildMirrors();
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
  sfx('delete');
  buzz([25, 40, 25]);
  resetForm();
  state.tab = 'list';
  rebuildMirrors();
  reload();
  scheduleSync();
}

/* ---------------- 明细 ---------------- */
let moveState = { date: '', ledger: '' };

function moveBarHtml() {
  const opts = state.ledgers.map((L) =>
    `<option value="${esc(L.id)}" ${moveState.ledger === L.id ? 'selected' : ''}>${esc(L.icon)} ${esc(L.name)}</option>`).join('');
  return `<div class="move-bar">
    <span class="mb-count">已选 ${state.selected.size} 条</span>
    <input type="date" id="mb-date" value="${esc(moveState.date)}" title="新日期，不填则不改">
    <select id="mb-ledger" title="目标账本"><option value="">账本不变</option>${opts}</select>
    <button id="mb-go">移动</button>
  </div>`;
}

function applyMove() {
  const nd = moveState.date;
  const nl = moveState.ledger;
  if (!nd && !nl) { toast('先选个新日期或目标账本', true); return; }
  if (!state.selected.size) { toast('先勾选要移动的记录', true); return; }
  const now = Date.now();
  let cnt = 0;
  for (const id of state.selected) {
    const r = state.allRecords.find((x) => x.id === id);
    if (!r || r.deleted || r.mirror) continue;
    if (nd) r.date = nd;
    if (nl) r.ledgerId = nl;
    r.updatedAt = now;
    cnt++;
  }
  persist();
  rebuildMirrors();
  state.multiSel = false;
  state.selected.clear();
  moveState = { date: '', ledger: '' };
  reload();
  scheduleSync();
  toast(`已移动 ${cnt} 条`);
  sfx('save');
  buzz(35);
}

function renderList() {
  const view = $('#view');
  let recs = state.records;
  let filterBar = '';
  if (state.dayFilter) {
    recs = recs.filter((r) => r.date === state.dayFilter);
    filterBar = `<div class="day-filter"><span>📅 ${dayLabel(state.dayFilter)}</span>
      <button id="clear-day">看全月 ✕</button></div>`;
  }
  const ms = state.multiSel;
  const tools = `<div class="list-tools">
      <button class="mini" id="btn-multi">${ms ? '✕ 退出多选' : '☑ 多选移动'}</button>
      ${ms ? '<span class="lt-hint">勾选记录，底部统一改日期/账本；点日期头全选当天</span>' : ''}
    </div>`;
  if (!recs.length) {
    view.innerHTML = tools + filterBar + `<div class="empty"><span class="big">🗒️</span>${
      state.dayFilter ? '这一天没有记录'
        : state.ledgerId === 'main' ? monthLabel(state.month) + '还没有记录<br>去「记一笔」开始吧'
        : '这个账本还没有记录<br>去「记一笔」开始吧'}</div>`;
    bindClearDay(view);
    bindMultiToggle(view);
    return;
  }
  const groups = new Map();
  for (const r of recs) {
    if (!groups.has(r.date)) groups.set(r.date, []);
    groups.get(r.date).push(r);
  }
  let html = tools + filterBar + '<div class="card list-card">';
  for (const [date, list] of groups) {
    let exp = 0, inc = 0;
    for (const r of list) (r.type === 'expense' ? (exp += r.amount) : (inc += r.amount));
    html += `<div class="day-group">
      <div class="day-head${ms ? ' dayhead-act' : ''}" data-dayall="${esc(date)}"><span>${dayLabel(date)}</span>
        <span class="day-total">支出 ¥${fmt(exp)}${inc > 0 ? ` · 收入 ¥${fmt(inc)}` : ''}</span></div>`;
    for (const r of list) {
      const link = findLedgerLink(r);
      const isMirror = !!r.mirror;
      const picked = state.selected.has(r.id);
      html += `<div class="rrow${ms && picked ? ' picked' : ''}${ms && isMirror ? ' mirror-row' : ''}" data-id="${esc(r.id)}" data-mirror="${isMirror ? '1' : ''}">
        ${ms ? `<span class="selbox">${picked ? '✓' : ''}</span>` : `<span class="rico">${esc(r.catIcon)}</span>`}
        <span class="rmid"><div class="rname">${esc(r.catName)}</div>
          ${r.note ? `<div class="rnote">${esc(r.note)}</div>` : ''}</span>
        <span class="ramt ${r.type}">${r.type === 'expense' ? '-' : '+'}¥${fmt(r.amount)}</span>
        ${!ms && link ? `<button class="jump-chip" data-jump="${esc(link.lid)}" data-jdate="${esc(link.date || '')}">${esc(link.label)}</button>` : ''}
      </div>`;
    }
    html += '</div>';
  }
  html += '</div>';
  if (ms) html += moveBarHtml();
  view.innerHTML = html;
  bindClearDay(view);
  bindMultiToggle(view);

  if (ms) {
    view.querySelectorAll('.rrow').forEach((el) => {
      el.onclick = () => {
        if (el.dataset.mirror) return;
        const id = el.dataset.id;
        if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
        render();
      };
    });
    view.querySelectorAll('.dayhead-act').forEach((el) => {
      el.onclick = () => {
        const d = el.dataset.dayall;
        const ids = state.records.filter((r) => r.date === d && !r.mirror).map((r) => r.id);
        const allOn = ids.length > 0 && ids.every((id) => state.selected.has(id));
        ids.forEach((id) => { if (allOn) state.selected.delete(id); else state.selected.add(id); });
        render();
      };
    });
    view.querySelector('#mb-date').oninput = (e) => { moveState.date = e.target.value; };
    view.querySelector('#mb-ledger').onchange = (e) => { moveState.ledger = e.target.value; };
    view.querySelector('#mb-go').onclick = applyMove;
  } else {
    view.querySelectorAll('.rrow').forEach((el) => {
      el.onclick = () => {
        const r = state.records.find((x) => x.id === el.dataset.id);
        if (!r) return;
        if (r.mirror) {
          const link = findLedgerLink(r);
          if (link) { jumpToLedger(link.lid, link.date); return; }
        }
        state.form = {
          type: r.type, categoryId: r.catId, amount: String(r.amount / 100),
          note: r.note || '', date: r.date, editingId: r.id,
        };
        state.tab = 'add';
        render();
      };
    });
    view.querySelectorAll('.jump-chip').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); jumpToLedger(b.dataset.jump, b.dataset.jdate || null); };
    });
  }
}

/* ---------------- 统计 ---------------- */
function bindClearDay(view) {
  const b = view.querySelector('#clear-day');
  if (b) b.onclick = () => { state.dayFilter = null; render(); };
}

function bindMultiToggle(view) {
  const b = view.querySelector('#btn-multi');
  if (b) b.onclick = () => {
    state.multiSel = !state.multiSel;
    if (!state.multiSel) { state.selected.clear(); moveState = { date: '', ledger: '' }; }
    render();
  };
}

function fmtDay(cents) { return (cents / 100).toFixed(2); }

function calendarHtml(selectedDate) {
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
    const cls = 'cal-cell' + (t ? ' has' : '') + (ds === today ? ' today' : '') + (ds === selectedDate ? ' sel' : '');
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

function drawPie(ctx, slices, total, size) {
  const cx = size / 2, cy = size / 2, R = size * 0.42, r = size * 0.245;
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
  ctx.font = `500 ${Math.round(size * 0.072)}px sans-serif`;
  ctx.fillText('支出', cx, cy - size * 0.065);
  ctx.font = `700 ${Math.round(size * 0.088)}px sans-serif`;
  ctx.fillText('¥' + fmt(total), cx, cy + size * 0.06);
}

function drawBars(ctx, cols, W, H) {
  const padL = 6, padR = 6, padT = 12, padB = 20;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = Math.max(1, cols.length);
  let max = 0;
  for (const c of cols) max = Math.max(max, c.exp || 0, c.inc || 0);
  if (max <= 0) max = 1;
  ctx.strokeStyle = '#f0efec';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 2; i++) {
    const y = padT + (plotH * i) / 2;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
  }
  const slot = plotW / n;
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
  cols.forEach((c, i) => {
    const x = padL + slot * (i + 0.5);
    const eh = ((c.exp || 0) / max) * plotH;
    const ih = ((c.inc || 0) / max) * plotH;
    if (eh > 0) { ctx.fillStyle = '#e5484d'; round(x - bw - 1, padT + plotH - eh, bw, eh, 2); }
    if (ih > 0) { ctx.fillStyle = '#30a46c'; round(x + 1, padT + plotH - ih, bw, ih, 2); }
    ctx.fillStyle = '#b9bdc5';
    if (c.tick) ctx.fillText(c.label, x, H - 6);
  });
  ctx.textAlign = 'left';
  ctx.fillStyle = '#b9bdc5';
  ctx.font = '10px sans-serif';
  ctx.fillText('¥' + fmt(max), padL + 2, padT + 9);
}

const legendState = { exp: false, inc: false };

function renderStats() {
  const view = $('#view');
  const s = state.stats;
  const main = state.ledgerId === 'main';
  const expCats = s.byCategory.filter((c) => c.type === 'expense');
  const incCats = s.byCategory.filter((c) => c.type === 'income');
  const legendRows = (cats, total) => cats.map((c, i) => `
    <div class="legend-item">
      <div class="legend-line">
        <span class="l-name">${esc(c.icon)} ${esc(c.name)}</span>
        <span class="l-val">¥${fmt(c.amount)}</span>
        <span class="l-pct">${total > 0 ? Math.round((c.amount / total) * 100) : 0}%</span>
      </div>
      <div class="lbar"><i style="width:${total > 0 ? Math.max(2, (c.amount / total) * 100) : 0}%;background:${PALETTE[i % PALETTE.length]}"></i></div>
    </div>`).join('') || '<div class="legend-line" style="color:#b9bdc5">暂无数据</div>';
  const legend = (cats, total, kind) => {
    const collapsible = cats.length > 5;
    const shown = (collapsible && !legendState[kind]) ? cats.slice(0, 5) : cats;
    let html = legendRows(shown, total);
    if (collapsible) {
      html += `<button class="legend-more" data-legend="${kind}">${legendState[kind] ? '收起 ∧' : '展开其余 ' + (cats.length - 5) + ' 个 ∨'}</button>`;
    }
    return html;
  };

  view.innerHTML = `
    <div class="card">
      <div class="chart-title">支出分类占比</div>
      <div class="pie-wrap">
        <canvas id="pie"></canvas>
        <div class="legend">${legend(expCats, s.expense, "exp")}</div>
      </div>
    </div>
    <div class="card">
      <div class="chart-title">${main ? '每日' : '月度'}收支（<span style="color:#e5484d">■ 支出</span> / <span style="color:#30a46c">■ 收入</span>）</div>
      <canvas id="bars"></canvas>
    </div>
    ${incCats.length ? `<div class="card"><div class="chart-title">收入分类</div><div class="legend">${legend(incCats, s.income, "inc")}</div></div>` : ''}`;

  let cols;
  if (main) {
    const [y, m] = state.month.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    const expByDay = {}, incByDay = {};
    for (const d of s.daily) {
      const day = Number(d.date.slice(8, 10));
      expByDay[day] = d.expense; incByDay[day] = d.income;
    }
    cols = [];
    for (let d = 1; d <= days; d++) {
      cols.push({ label: String(d), exp: expByDay[d] || 0, inc: incByDay[d] || 0, tick: d === 1 || d % 5 === 0 || d === days });
    }
  } else {
    cols = s.byMonth.map((b) => ({ label: Number(b.month.slice(5)) + '月', exp: b.expense, inc: b.income, tick: true }));
    if (!cols.length) cols = [{ label: '', exp: 0, inc: 0, tick: false }];
  }

  const pie = view.querySelector('#pie');
  const pieSize = Math.min(260, Math.max(200, (view.clientWidth || 360) - 100));
  const pctx = setupCanvas(pie, pieSize, pieSize);
  const slices = expCats.map((c, i) => ({ value: c.amount, color: PALETTE[i % PALETTE.length] }));
  drawPie(pctx, slices, s.expense, pieSize);

  const bars = view.querySelector('#bars');
  const W = Math.max(200, (view.clientWidth || 360) - 60);
  const bctx = setupCanvas(bars, W, 170);
  drawBars(bctx, cols, W, 170);

  view.querySelectorAll('[data-legend]').forEach((b) => {
    b.onclick = () => { legendState[b.dataset.legend] = !legendState[b.dataset.legend]; renderStats(); };
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
  sfx('save');
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
             ${deferredPrompt ? '<button class="mini" id="btn-install-now" style="margin-bottom:8px">📲 一键安装成应用</button><br>' : ''}
             <b>Chrome / Edge（安卓）</b>：菜单 ⋮ → 「安装应用」。<br>
             <b>QQ浏览器 / UC / 自带浏览器</b>：不支持一键安装，请用菜单 → 「添加至桌面」；想要真正的 App 体验建议装 Edge 或 Chrome。<br>
             <b>iPhone（Safari）</b>：底部分享按钮 → 「添加到主屏幕」。<br>
             <b>都不行？</b>直接下载 <a href="./jizhang.apk">安卓 APK 安装包</a>，装完就是独立 App。<br>
             微信里点开的链接请先选「在浏览器打开」。
           </div>`}
    </div>
    <div class="card">
      <div class="chart-title">小账本汇总</div>
      <div class="frow"><span class="fk" style="width:auto;flex:1">每日汇总进主账本</span>
        <button class="mini" id="mirror-toggle">${settings.mirror ? '已开启' : '已关闭'}</button></div>
      <div class="set-help">开启后，小账本每天的支出会在主账本当天生成一条"🗂️ 活动汇总"（点它跳回小账本看细账）；主账本里备注提到某小账本（如"日本""星邱"）的记录也会带跳转标记。主账本因此=日常+活动的完整全貌。</div>
    </div>
    <div class="card">
      <div class="chart-title">交互体验</div>
      <div class="frow"><span class="fk" style="width:auto;flex:1">音效与震动</span>
        <button class="mini" id="sound-toggle">${settings.sound ? '已开启' : '已关闭'}</button></div>
      <div class="set-help">保存"叮"、删除低响、同步上行琶音、切换轻点；安卓 App 上还有震动反馈。关闭后全部静音。</div>
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
  const inst = view.querySelector('#btn-install-now');
  if (inst) inst.onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (e) { /* ignore */ }
    deferredPrompt = null;
    render();
  };
  view.querySelector('#mirror-toggle').onclick = () => {
    settings.mirror = !settings.mirror;
    saveSettings();
    if (settings.mirror) rebuildMirrors(); else clearMirrors();
    reload();
    scheduleSync();
    toast(settings.mirror ? '已开启每日汇总' : '已关闭并清除汇总记录');
  };
  const snd = view.querySelector('#sound-toggle');
  if (snd) snd.onclick = () => {
    settings.sound = !settings.sound;
    saveSettings();
    if (settings.sound) { sfx('save'); buzz(35); }
    render();
  };
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
  t.onclick = () => {
    sfx('tap');
    state.tab = t.dataset.tab;
    if (t.dataset.tab !== 'stats') state.dayFilter = null;
    state.multiSel = false;
    state.selected.clear();
    render();
  };
});
window.addEventListener('resize', () => { if (state.tab === 'stats') renderStats(); });
window.addEventListener('online', () => { if (settings.token) doSync('auto'); });

/* ---------------- 安装成 App ---------------- */
let deferredPrompt = null;
const isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
  || window.navigator.standalone === true
  || !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (state.tab === 'set') render();
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  if (state.tab === 'set') render();
});

/* ---------------- 启动 ---------------- */
(async function boot() {
  try {
    settings = loadSettings();
    saveSettings();
    const d0 = loadData();
    state.allRecords = d0.records;
    state.allCategories = d0.categories;
    state.allLedgers = d0.ledgers;
    const h = location.hash.replace('#', '');
    if (['add', 'list', 'stats', 'set'].includes(h)) state.tab = h;
    const qs = new URLSearchParams(location.search);
    const lp = qs.get('l');
    if (lp) state.ledgerId = lp;
    const mp = qs.get('m');
    if (mp && /^\d{4}-\d{2}$/.test(mp)) state.month = mp;
    if (settings.token) {
      // 已配置同步：先拉云端账本，避免把示例分类播种进已有数据（防止复活）
      await doSync('boot');
    }
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
    rebuildMirrors();
    reload();
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
      // 部署新版本后自动刷新页面，无需手动刷新
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        location.reload();
      });
    }
  } catch (e) {
    toast('初始化失败：' + e.message, true);
    try { reload(); } catch (_) { /* ignore */ }
  }
})();
