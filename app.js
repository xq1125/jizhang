'use strict';
/* 记账本前端 —— 离线优先：数据存本机 localStorage，联网时经 GitHub Gist 多设备同步 */

const $ = (s) => document.querySelector(s);
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const PALETTE = ['#6C8CE0', '#E08A8F', '#7FBF9A', '#E8B36C', '#9B8FD6', '#6FB7D9',
  '#D68FB8', '#A3B56E', '#8C9AAE', '#E0A5A0', '#7DA6C9', '#B49AD6'];

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
function dayLabel(dateStr, withYear) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${withYear ? d.getFullYear() + '年' : ''}${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`;
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
      people: Array.isArray(d.people) ? d.people : [],
    };
  } catch (e) { return { records: [], categories: [], ledgers: [], people: [] }; }
}
function persist() {
  try {
    localStorage.setItem(LS_DATA, JSON.stringify({
      records: state.allRecords, categories: state.allCategories,
      ledgers: state.allLedgers, people: state.allPeople,
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
  s.mirror = !!s.mirror;
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
  selDate: todayStr(),
  showForm: false,
  gameSel: null,
  dayIdx: null,
  multiSel: false,
  selected: new Set(),
  allRecords: [],
  allCategories: [],
  allLedgers: [],
  allPeople: [],
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
  state.allPeople = d.people;
  state.ledgers = state.allLedgers.filter((L) => !L.deleted);
  if (state.ledgerId !== VIRTUAL_GAMES && state.ledgerId !== VIRTUAL_TRAVELS && state.ledgerId !== VIRTUAL_OFFLINE
    && state.ledgerId !== VIRTUAL_OTHERS
    && !state.ledgers.some((L) => L.id === state.ledgerId)) state.ledgerId = 'main';
  state.categories = state.allCategories.filter((c) => !c.deleted);
  state.dayIdx = buildLedgerDayIndex();
  const month = state.month, lid = state.ledgerId;
  if (lid === VIRTUAL_GAMES) {
    state.records = state.allRecords
      .filter((r) => !r.deleted && (r.ledgerId || 'main') === 'main' && r.catId === GAME_CAT_ID && r.type === 'expense')
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id.localeCompare(a.id)));
  } else if (lid.startsWith('grp-')) {
    const G = state.allLedgers.find((x) => x.id === lid && !x.deleted);
    let rs = [];
    if (G && G.kind === 'cat') {
      rs = state.allRecords.filter((r) => !r.deleted && !r.mirror && (r.ledgerId || 'main') === 'main' && r.catId === G.catId && r.type === 'expense');
    } else if (G) {
      for (const m of state.allLedgers) {
        if (!m.deleted && m.group === G.id) rs = rs.concat(recordsOfLedger(m));
      }
    }
    state.records = rs.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id.localeCompare(a.id)));
  } else if (lid === VIRTUAL_TRAVELS || lid === VIRTUAL_OFFLINE || lid === VIRTUAL_OTHERS) {
    const pred = lid === VIRTUAL_TRAVELS ? isTravel : (lid === VIRTUAL_OFFLINE ? isOffline : isOthers);
    const tids = new Set(state.allLedgers.filter((L) => !L.deleted && pred(L)).map((L) => L.id));
    state.records = state.allRecords
      .filter((r) => !r.deleted && tids.has(r.ledgerId || 'main'))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id.localeCompare(a.id)));
  } else {
    const curL = state.allLedgers.find((L) => L.id === lid) || { id: 'main' };
    const main = lid === 'main';
    state.records = recordsOfLedger(curL)
      .filter((r) => !main || r.date.startsWith(month))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id.localeCompare(a.id)));
  }
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
function hideToast() { const t = $('#toast'); if (t) t.hidden = true; }
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  if (isErr) sfx('error');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 2400);
}
/* 带"撤销"按钮的提示，停留 3 秒 */
function toastUndo(msg, label, fn, ms = 3000) {
  const t = $('#toast');
  t.textContent = '';
  const span = document.createElement('span');
  span.textContent = msg;
  const btn = document.createElement('button');
  btn.className = 'toast-act';
  btn.textContent = label;
  btn.onclick = () => {
    try { fn(); } catch (e) { toast('撤销失败：' + e.message, true); return; }
    sfx('undo');
    buzz([12, 20, 12]);
    hideToast();
  };
  t.appendChild(span);
  t.appendChild(btn);
  t.className = 'toast';
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
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
    state.allPeople = res.people || [];
    persist();
    reload();
    if (kind === 'manual') { toast(res.created ? '已创建云端账本并同步 ✓' : '同步完成 ✓'); sfx('sync'); buzz(20); }
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
    if (name === 'coin') {
      // 收银机：机械咔哒 + 双音高"叮~"金币声
      tone(950, 0, 0.03, 'square', 0.035);
      tone(1720, 0.03, 0.3, 'sine', 0.09);
      tone(2580, 0.03, 0.34, 'sine', 0.055);
    }
    else if (name === 'save') { tone(660, 0, 0.12); tone(880, 0.09, 0.2); }
    else if (name === 'undo') { tone(880, 0, 0.08, 'sine', 0.06); tone(520, 0.07, 0.12, 'sine', 0.06); }
    else if (name === 'key') { tone(1500, 0, 0.02, 'sine', 0.022); }
    else if (name === 'tap') { tone(1200, 0, 0.04, 'triangle', 0.045); }
    else if (name === 'delete') { tone(220, 0, 0.16, 'triangle', 0.09); tone(170, 0.08, 0.14, 'triangle', 0.07); }
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
/* 有日历视图的账本（主账本+真实小账本）才显示月份导航 */
function hasCalendarView() {
  const lid = state.ledgerId;
  if (lid === 'main') return true;
  if (lid === VIRTUAL_GAMES || lid === VIRTUAL_TRAVELS || lid === VIRTUAL_OFFLINE || lid === VIRTUAL_OTHERS) return false;
  if (lid.startsWith('grp-')) return false;
  return !!state.allLedgers.find((L) => L.id === lid && !L.deleted);
}

function renderHeader() {
  const main = state.ledgerId === 'main';
  const virtual = state.ledgerId === VIRTUAL_GAMES;
  const cal = hasCalendarView();
  $('#month-label').textContent = cal ? monthLabel(state.month) + ' ▾' : '全部时间';
  $('#month-label').style.cursor = cal ? 'pointer' : 'default';
  $('#prev-month').style.display = cal ? '' : 'none';
  $('#next-month').style.display = cal ? '' : 'none';
  $('#this-month').style.display = cal ? '' : 'none';
  const grpH = asGroup(state.ledgerId);
  const builtinH = BUILTIN_GROUPS.some((b) => b.id === state.ledgerId);
  $('.hero-k').textContent = main ? '本月支出'
    : (grpH ? grpH.name + '总支出'
      : (builtinH ? groupMeta(state.ledgerId).name + '总支出' : '总支出'));
  const s = state.stats;
  setNum($('#sum-expense'), s.expense);
  setNum($('#sum-income'), s.income);
  const net = $('#sum-net');
  setNum(net, s.net);
  net.classList.toggle('neg', s.net < 0);
  updateSyncChip();
  const hw = $('#hero-who');
  if (hw) {
    const curL = state.allLedgers.find((L) => L.id === state.ledgerId && !L.deleted);
    const isSub = curL && curL.id !== 'main';
    const ids = isSub ? ledgerWhoIds(curL) : [];
    if (isSub) {
      hw.innerHTML = ids.map((id) => { const p = personById(id); return `<span class="hw-item"><span class="avatar" title="${esc(p.name)}">${avatarInner(p)}</span><span class="hw-name">${esc(p.name)}</span></span>`; }).join('')
        + `<span class="hw-ledger">${esc(curL.icon)} ${esc(curL.name)}</span>`;
      hw.onclick = () => openWhoSheet(curL);
      hw.hidden = false;
    } else {
      hw.hidden = true;
      hw.innerHTML = '';
    }
  }
}

/* ---------------- 自定义分类（账本式/账条式） ---------------- */
const BUILTIN_GROUPS = [
  { id: 'virtual-travels', name: '旅游', icon: '🧳' },
  { id: 'virtual-offline', name: '线下', icon: '🌟' },
  { id: 'virtual-others', name: '其他', icon: '📁' },
  { id: 'virtual-games', name: '游戏', icon: '🎮' },
];
function groupMeta(vid) {
  const m = state.allLedgers.find((x) => x.id === vid && !x.deleted);
  if (m) return { name: m.name, icon: m.icon };
  return BUILTIN_GROUPS.find((b) => b.id === vid) || { name: vid, icon: '🗂️' };
}
function ensureBuiltinMeta() {
  let dirty = false;
  BUILTIN_GROUPS.forEach((b, i) => {
    if (!state.allLedgers.some((x) => x.id === b.id)) {
      state.allLedgers.push({ id: b.id, name: b.name, icon: b.icon, builtin: true, ord: i,
        updatedAt: Date.now(), createdAt: Date.now(), deleted: false });
      dirty = true;
    }
  });
  if (dirty) persist();
}
function customGroups() {
  return state.allLedgers.filter((L) => !L.deleted && L.id.startsWith('grp-'));
}
function asGroup(lid) {
  return lid && lid.startsWith('grp-') ? state.allLedgers.find((L) => L.id === lid && !L.deleted) : null;
}
function addNewGroup() {
  openSheet('＋ 新分类 · 选一种', [
    { id: 'ledger', label: '📒 账本式（像旅游：里面放小账本）' },
    { id: 'cat', label: '📄 账条式（像游戏：汇总主账本某分类）' },
  ], '', (kind) => {
    const name = prompt('分类名称（如：宠物、学习）：');
    if (!name || !name.trim()) return;
    const icon = (prompt('图标（表情，可留空）：', '🗂️') || '🗂️').trim() || '🗂️';
    const G = { id: 'grp-' + genId(), name: name.trim().slice(0, 10), icon: icon.slice(0, 8),
      kind, updatedAt: Date.now(), createdAt: Date.now(), deleted: false,
      ord: Math.max(0, ...state.allLedgers.filter((x) => !x.deleted && (x.builtin || x.id.startsWith('grp-'))).map((x) => x.ord ?? 0)) + 1 };
    const finish = () => {
      state.allLedgers.push(G);
      if (!persist()) return;
      navLedger(G.id);
      scheduleSync();
      sfx('coin');
      toast(`已创建分类「${G.name}」`);
    };
    if (kind === 'cat') {
      const opts = state.categories.filter((c) => c.type === 'expense')
        .map((c) => ({ id: c.id, label: c.icon + ' ' + c.name }));
      openSheet('汇总主账本的哪个分类？', opts, '', (cid) => { G.catId = cid; finish(); });
    } else {
      finish();
    }
  });
}
function deleteGroup(id) {
  const G = state.allLedgers.find((L) => L.id === id && !L.deleted);
  if (!G) return;
  if (!confirm(`删除分类「${G.name}」？里面的小账本/记录都不会删，只是不再归组。`)) return;
  G.deleted = true;
  G.updatedAt = Date.now();
  if (G.kind === 'ledger') {
    for (const L of state.allLedgers) {
      if (L.group === G.id) { delete L.group; L.updatedAt = Date.now(); }
    }
  }
  if (state.ledgerId === id) state.ledgerId = 'main';
  persist();
  reload();
  scheduleSync();
  toast('已删除分类');
}

function groupKeyFor(lid) {
  if (lid === VIRTUAL_TRAVELS) return 'travel';
  if (lid === VIRTUAL_OFFLINE) return 'offline';
  if (lid === VIRTUAL_OTHERS) return 'others';
  return lid;
}
function addLedgerToGroup(group) {
  const name = prompt('新账本名称（如：国庆旅行、装修）：');
  if (!name || !name.trim()) return;
  const icon = (prompt('选一个图标（表情，可留空）：', '🗂️') || '🗂️').trim() || '🗂️';
  const L = { id: genId(), name: name.trim().slice(0, 12), icon: icon.slice(0, 8),
    updatedAt: Date.now(), createdAt: Date.now(), deleted: false, group: groupKeyFor(group) };
  const who = prompt('和谁一起？（可留空）', '');
  if (who && who.trim()) L.who = who.trim().slice(0, 20);
  state.allLedgers.push(L);
  if (!persist()) return;
  navLedger(L.id);
  scheduleSync();
  sfx('coin');
  toast(`已创建账本「${L.name}」`);
}

/* ---------------- 分组虚拟账本（旅游/线下） ---------------- */
const VIRTUAL_TRAVELS = 'virtual-travels';
const VIRTUAL_OFFLINE = 'virtual-offline';
const VIRTUAL_OTHERS = 'virtual-others';
const TRAVEL_IDS = ['imp-jp', 'imp-jd', 'imp-whqd', 'imp-cs', 'imp-xn', 'imp-ly', 'imp-cx'];
const OFFLINE_IDS = ['imp-xq66', 'imp-xq1121'];
const OTHERS_IDS = ['imp-bday'];
function isTravel(L) { return L.group === 'travel' || TRAVEL_IDS.includes(L.id); }
function isOffline(L) { return L.group === 'offline' || OFFLINE_IDS.includes(L.id); }
function isOthers(L) { return L.group === 'others' || OTHERS_IDS.includes(L.id); }
/* 账本的记录集合：主账本=所有主账本记录(含带标签的)；小账本=自有记录+主账本里打本账本标签的记录 */
function recordsOfLedger(L) {
  if (!L) return [];
  if (L.id === 'main') {
    return state.allRecords.filter((r) => !r.deleted && !r.mirror && (r.ledgerId || 'main') === 'main');
  }
  return state.allRecords.filter((r) => !r.deleted && !r.mirror
    && ((r.ledgerId || 'main') === L.id || ((r.ledgerId || 'main') === 'main' && r.tripId === L.id)));
}

function ledgerGroups(pred) {
  const out = [];
  for (const L of state.allLedgers) {
    if (L.deleted || !pred(L)) continue;
    let cents = 0, n = 0;
    for (const r of recordsOfLedger(L)) {
      n += 1;
      if (r.type === 'expense') cents += r.amount;
    }
    out.push({ L, cents, n });
  }
  return out.sort((a, b) => ((b.L.createdAt || b.L.updatedAt || 0) - (a.L.createdAt || a.L.updatedAt || 0)));
}
function travelGroups() { return ledgerGroups(isTravel); }
function offlineGroups() { return ledgerGroups(isOffline); }
function othersGroups() { return ledgerGroups(isOthers); }
function groupCardHtml(x) {
  const whoNames = ledgerWhoIds(x.L).map((id) => { const p = personById(id); return p ? p.name : ''; }).filter(Boolean).join('、');
  return `<div class="rrow" data-gledger="${esc(x.L.id)}">
    <span class="rico">${esc(x.L.icon)}</span>
    <span class="rmid"><div class="rname">${esc(x.L.name)}</div>
      <div class="rnote">${x.n} 笔${whoNames ? ' · 👥 ' + esc(whoNames) : ''}</div></span>
    <button class="who-btn" data-who-for="${esc(x.L.id)}" title="同行人">${whoNames ? '✏️' : '👥+'}</button>
    <button class="row-del" data-gdel="${esc(x.L.id)}" title="删除账本">✕</button>
    <span class="ramt expense">¥${fmt(x.cents)}</span>
  </div>`;
}
function bindGroupCardDelete(view) {
  view.querySelectorAll('[data-gledger]').forEach((el) => {
    attachLongPress(el, () => {
      view.querySelectorAll('.rrow.del-armed').forEach((x) => x.classList.remove('del-armed'));
      el.classList.add('del-armed');
      buzz(15);
      sfx('tap');
    });
  });
  view.querySelectorAll('[data-gdel]').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); deleteLedger(b.dataset.gdel); };
  });
}
function bindWhoButtons(view) {
  view.querySelectorAll('[data-who-for]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const L = state.allLedgers.find((x) => x.id === b.dataset.whoFor && !x.deleted);
      if (L) openWhoSheet(L);
    };
  });
}
function virtualIds(L) {
  return isTravel(L) ? VIRTUAL_TRAVELS : (isOffline(L) ? VIRTUAL_OFFLINE
    : (isOthers(L) ? VIRTUAL_OTHERS : (L.group && L.group.startsWith('grp-') ? L.group : null)));
}
function groupTitle(lid) {
  const G = asGroup(lid);
  if (G) return G.kind === 'cat' ? `${G.name}账条 · 主账本该分类的全部支出` : `${G.name}账本 · 点进去看细账`;
  const nm = groupMeta(lid).name;
  return lid === VIRTUAL_TRAVELS ? `${nm}账本 · 点目的地看细账`
    : lid === VIRTUAL_OFFLINE ? `${nm}活动账本 · 点活动看细账`
    : `${nm}账本 · 点进去看细账`;
}
function groupsOf(lid) {
  const G = asGroup(lid);
  if (G) return ledgerGroups((L) => !L.id.startsWith('grp-') && L.group === G.id);
  return lid === VIRTUAL_TRAVELS ? travelGroups() : lid === VIRTUAL_OFFLINE ? offlineGroups() : othersGroups();
}

/* ---------------- 同伴系统 ---------------- */
const PEOPLE_SEED = [['p-1', '韩佳韵', '🌸'], ['p-2', '董杰琳', '🍀'], ['p-3', 'gyff', '✨'],
  ['p-4', 'ycx', '🎈'], ['p-5', '爸爸', '🐻'], ['p-6', '妈妈', '🌷']];
const AVATAR_EMOJIS = ['🌸', '🍀', '✨', '🎈', '🐻', '🌷', '🦄', '🐱', '🐶', '⭐', '🌙', '🍒', '🐰', '🐼'];
function personById(id) {
  return state.allPeople.find((p) => p.id === id && !p.deleted) || null;
}
function avatarInner(p) {
  if (!p) return '👤';
  if (p.avatar && p.avatar.indexOf('data:') === 0) return `<img src="${p.avatar}" alt="">`;
  return esc(p.avatar || '👤');
}
function ledgerWhoIds(L) {
  if (L.whoIds && L.whoIds.length) return L.whoIds.filter((id) => personById(id));
  if (L.who) {
    const ids = [];
    for (const n of L.who.split(/[、,，\s]+/)) {
      const p = state.allPeople.find((x) => !x.deleted && x.name === n);
      if (p) ids.push(p.id);
    }
    return ids;
  }
  return [];
}

function openWhoSheet(L) {
  const sel = new Set(ledgerWhoIds(L));
  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  mask.appendChild(sheet);
  document.body.appendChild(mask);
  requestAnimationFrame(() => mask.classList.add('show'));
  const close = () => {
    mask.classList.remove('show');
    setTimeout(() => mask.remove(), 200);
  };
  mask.onclick = (e) => { if (e.target === mask) close(); };
  const draw = () => {
    let html = `<div class="sheet-title">👥 ${esc(L.name)} 的同行人</div><div class="sheet-list">`;
    for (const p of state.allPeople.filter((x) => !x.deleted)) {
      html += `<div class="sheet-item${sel.has(p.id) ? ' on' : ''}" data-pid="${esc(p.id)}">
        <span class="si-label"><span class="avatar sm">${avatarInner(p)}</span> ${esc(p.name)}</span>
        <span class="si-radio${sel.has(p.id) ? ' checked' : ''}"></span></div>`;
    }
    html += `</div><div class="sheet-foot">
      <button class="mini" id="who-add">＋ 新建同伴</button>
      <button class="mini" id="who-clear">清空</button>
      <button class="sheet-ok" id="who-ok">完成</button></div>`;
    sheet.innerHTML = html;
    sheet.querySelectorAll('[data-pid]').forEach((el) => {
      el.onclick = () => {
        const id = el.dataset.pid;
        if (sel.has(id)) sel.delete(id); else sel.add(id);
        sfx('tap');
        draw();
      };
    });
    sheet.querySelector('#who-add').onclick = () => addPerson().then((p) => { if (p) { sel.add(p.id); draw(); } });
    sheet.querySelector('#who-clear').onclick = () => { sel.clear(); draw(); };
    sheet.querySelector('#who-ok').onclick = () => {
      L.whoIds = Array.from(sel);
      delete L.who;
      L.updatedAt = Date.now();
      persist();
      reload();
      scheduleSync();
      sfx('tap');
      close();
    };
  };
  draw();
}

function addPerson() {
  return new Promise((resolve) => {
    const name = prompt('同伴名字：');
    if (!name || !name.trim()) { resolve(null); return; }
    const opts = AVATAR_EMOJIS.map((e) => ({ id: e, label: e + '　用这个表情' })).concat([{ id: '__img', label: '📷 上传照片' }]);
    openSheet('给 ' + name.trim() + ' 选个头像', opts, '', (pick) => {
      const p = { id: genId(), name: name.trim().slice(0, 12), updatedAt: Date.now(), deleted: false };
      const finish = () => {
        p.avatar = p.avatar || '👤';
        state.allPeople.push(p);
        persist();
        scheduleSync();
        toast(`已添加同伴「${p.name}」`);
        resolve(p);
      };
      if (pick === '__img') {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*';
        inp.onchange = () => {
          const file = inp.files && inp.files[0];
          if (!file) { finish(); return; }
          const img = new Image();
          img.onload = () => {
            const S = 96;
            const c = document.createElement('canvas');
            c.width = S; c.height = S;
            const cx = c.getContext('2d');
            const side = Math.min(img.width, img.height);
            cx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
            try { p.avatar = c.toDataURL('image/jpeg', 0.75); } catch (e) { p.avatar = '📷'; }
            URL.revokeObjectURL(img.src);
            finish();
          };
          img.onerror = () => { p.avatar = '📷'; finish(); };
          img.src = URL.createObjectURL(file);
        };
        inp.click();
      } else {
        p.avatar = pick || '👤';
        finish();
      }
    });
  });
}

function editPerson(id) {
  const p = personById(id);
  if (!p) return;
  const name = prompt('同伴名字：', p.name);
  if (name !== null && name.trim()) {
    p.name = name.trim().slice(0, 12);
    p.updatedAt = Date.now();
    persist();
    reload();
    scheduleSync();
  }
  const opts = AVATAR_EMOJIS.map((e) => ({ id: e, label: e + '　用这个表情' })).concat([{ id: '__img', label: '📷 上传照片' }]);
  openSheet('换头像', opts, '', (pick) => {
    const done = () => { p.updatedAt = Date.now(); persist(); reload(); scheduleSync(); };
    if (pick === '__img') {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.onchange = () => {
        const file = inp.files && inp.files[0];
        if (!file) { done(); return; }
        const img = new Image();
        img.onload = () => {
          const S = 96;
          const c = document.createElement('canvas');
          c.width = S; c.height = S;
          const cx = c.getContext('2d');
          const side = Math.min(img.width, img.height);
          cx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
          try { p.avatar = c.toDataURL('image/jpeg', 0.75); } catch (e) { /* keep old */ }
          URL.revokeObjectURL(img.src);
          done();
        };
        img.onerror = done;
        img.src = URL.createObjectURL(file);
      };
      inp.click();
    } else if (pick) {
      p.avatar = pick;
      done();
    }
  });
}

function deletePerson(id) {
  const p = personById(id);
  if (!p) return;
  if (!confirm(`删除同伴「${p.name}」？各账本的同行人里也会移除。`)) return;
  p.deleted = true;
  p.updatedAt = Date.now();
  for (const L of state.allLedgers) {
    if (L.whoIds && L.whoIds.includes(id)) {
      L.whoIds = L.whoIds.filter((x) => x !== id);
      L.updatedAt = Date.now();
    }
  }
  persist();
  reload();
  scheduleSync();
  toast('已删除同伴');
}

/* ---------------- 游戏虚拟账本 ---------------- */
const VIRTUAL_GAMES = 'virtual-games';
const GAME_CAT_ID = 'imp-cat-游戏';
const GAMES = ['王者荣耀', '蛋仔派对', '桃源深处有人家', '宝可梦', '原神', '星穹铁道', '鸣潮',
  '第五人格', '光遇', '金铲铲', '和平精英', '我的世界', '明日方舟', '阴阳师', '永劫无间', '三角洲'];
function gameOf(r) {
  const n = r.note || '';
  for (const g of GAMES) { if (n.includes(g)) return g; }
  return '未标注';
}
function gameGroups() {
  const m = new Map();
  for (const r of state.records) {
    const g = gameOf(r);
    const e = m.get(g) || { name: g, amount: 0, count: 0 };
    e.amount += r.amount; e.count += 1; m.set(g, e);
  }
  return Array.from(m.values()).sort((a, b) => b.amount - a.amount);
}
function gameCardHtml(g) {
  return `<div class="rrow" data-game="${esc(g.name)}">
    <span class="rico">🎮</span>
    <span class="rmid"><div class="rname">${esc(g.name)}</div><div class="rnote">${g.count} 笔</div></span>
    <span class="ramt expense">¥${fmt(g.amount)}</span>
  </div>`;
}

/* ---------------- 账本切换 ---------------- */
function renderLedgers() {
  const el = $('#ledger-row');
  if (!el) return;
  const cur = state.ledgers.find((L) => L.id === state.ledgerId);
  const inGroup = cur ? virtualIds(cur) : null;
  const plain = state.ledgers.filter((L) => (L.id === 'main' || (!isTravel(L) && !isOffline(L) && !isOthers(L))) && !L.id.startsWith('grp-') && !L.builtin);
  let chips = plain.map((L) => `
    <button class="lchip ${L.id === state.ledgerId ? 'on' : ''}" data-ledger="${esc(L.id)}">${esc(L.icon)} ${esc(L.name)}</button>`).join('');
  const curChip = inGroup ? `<button class="lchip on" data-ledger="${esc(cur.id)}">${esc(cur.icon)} ${esc(cur.name)}</button>` : '';
  for (const G of managedGroups()) {
    chips += `<button class="lchip ${(state.ledgerId === G.id || inGroup === G.id) ? 'on' : ''}" data-ledger="${esc(G.id)}">${esc(G.icon)} ${esc(G.name)}</button>`;
    if (inGroup === G.id) chips += curChip;
  }
  chips += `<button class="lchip lchip-add" id="btn-add-ledger">＋ 新分类</button>`;
  chips += `<button class="lchip lchip-add" id="btn-manage-groups">⚙️ 管理</button>`;
  el.innerHTML = chips;
  el.querySelectorAll('[data-ledger]').forEach((b) => {
    b.onclick = () => {
      if (b.classList.contains('del-armed')) { disarmChip(b); return; }
      sfx('tap'); buzz(8); navLedger(b.dataset.ledger);
    };
    const lid = b.dataset.ledger;
    const deletable = lid !== 'main' && lid !== VIRTUAL_GAMES && lid !== VIRTUAL_TRAVELS
      && lid !== VIRTUAL_OFFLINE && lid !== VIRTUAL_OTHERS;
    if (deletable) {
      attachLongPress(b, () => {
        if (b.classList.contains('del-armed')) {
          disarmChip(b);
          if (lid.startsWith('grp-')) deleteGroup(lid); else deleteLedger(lid);
          return;
        }
        el.querySelectorAll('.lchip.del-armed').forEach(disarmChip);
        b.dataset.orig = b.textContent;
        b.classList.add('del-armed');
        b.textContent = '✕ 删除';
        buzz(15);
        sfx('tap');
      });
    }
  });
  el.querySelector('#btn-add-ledger').onclick = addNewGroup;
  el.querySelector('#btn-manage-groups').onclick = openManageGroups;
}
function disarmChip(b) {
  if (b.dataset.orig) b.textContent = b.dataset.orig;
  b.classList.remove('del-armed');
}
function managedGroups() {
  return state.allLedgers
    .filter((L) => !L.deleted && (L.builtin || L.id.startsWith('grp-')))
    .sort((a, b) => (a.ord ?? 99) - (b.ord ?? 99));
}
function saveGroupsMeta() {
  persist();
  reload();
  scheduleSync();
}
function openManageGroups() {
  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  mask.appendChild(sheet);
  document.body.appendChild(mask);
  requestAnimationFrame(() => mask.classList.add('show'));
  const close = () => {
    mask.classList.remove('show');
    setTimeout(() => mask.remove(), 200);
  };
  mask.onclick = (e) => { if (e.target === mask) close(); };
  const draw = () => {
    const groups = managedGroups();
    let html = `<div class="sheet-title">管理分类 · 点图标换图 · 点✏️改名 · 长按排序</div><div class="sheet-list">`;
    groups.forEach((G, i) => {
      html += `<div class="sheet-item mg-row" data-mgrid="${esc(G.id)}">
        <span class="mg-icon" data-mgicon="${esc(G.id)}">${esc(G.icon)}</span>
        <span class="mg-name">${esc(G.name)}${G.builtin ? '<em class="mg-tag">内置</em>' : ''}</span>
        <span class="mg-ops">
          <button class="mini mg-move" data-mgup="${esc(G.id)}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="mini mg-move" data-mgdn="${esc(G.id)}" ${i === groups.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="mini" data-mgren="${esc(G.id)}">✏️</button>
          ${G.builtin ? '' : `<button class="mini danger" data-mgdel="${esc(G.id)}">🗑</button>`}
        </span></div>`;
    });
    html += `</div><button class="sheet-cancel" id="mg-close">关闭</button>`;
    sheet.innerHTML = html;
    sheet.querySelector('#mg-close').onclick = close;
    sheet.querySelectorAll('[data-mgicon]').forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const G = state.allLedgers.find((x) => x.id === el.dataset.mgicon && !x.deleted);
        if (!G) return;
        pickIcon(G.icon, (icon) => { G.icon = icon; G.updatedAt = Date.now(); saveGroupsMeta(); draw(); });
      };
    });
    sheet.querySelectorAll('[data-mgren]').forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const G = state.allLedgers.find((x) => x.id === el.dataset.mgren && !x.deleted);
        if (!G) return;
        const name = prompt('分类名称：', G.name);
        if (name !== null && name.trim()) {
          G.name = name.trim().slice(0, 10);
          G.updatedAt = Date.now();
          saveGroupsMeta();
          draw();
          toast('已改名');
        }
      };
    });
    sheet.querySelectorAll('[data-mgdel]').forEach((el) => {
      el.onclick = (e) => { e.stopPropagation(); deleteGroup(el.dataset.mgdel); draw(); };
    });
    const move = (id, dir) => {
      const gs = managedGroups();
      const i = gs.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= gs.length) return;
      const a = gs[i].ord ?? i; const b = gs[j].ord ?? j;
      gs[i].ord = b; gs[j].ord = a;
      gs[i].updatedAt = Date.now(); gs[j].updatedAt = Date.now();
      sfx('tap'); buzz(8);
      saveGroupsMeta();
      draw();
    };
    sheet.querySelectorAll('[data-mgup]').forEach((el) => {
      el.onclick = (e) => { e.stopPropagation(); move(el.dataset.mgup, -1); };
    });
    sheet.querySelectorAll('[data-mgdn]').forEach((el) => {
      el.onclick = (e) => { e.stopPropagation(); move(el.dataset.mgdn, 1); };
    });
    sheet.querySelectorAll('.mg-row').forEach((el) => {
      attachLongPress(el, () => {
        const on = el.classList.contains('sorting');
        sheet.querySelectorAll('.mg-row.sorting').forEach((x) => x.classList.remove('sorting'));
        if (!on) el.classList.add('sorting');
        buzz(15); sfx('tap');
      });
    });
  };
  draw();
}

function addLedger() {
  const name = prompt('新账本名称（如：国庆旅行、装修）：');
  if (!name || !name.trim()) return;
  const icon = (prompt('选一个图标（表情，可留空）：', '🗂️') || '🗂️').trim() || '🗂️';
  openSheet('这个账本属于哪类？', [
    { id: 'travel', label: '🧳 旅游' },
    { id: 'offline', label: '🌟 线下活动' },
    { id: 'others', label: '📁 其他' },
  ], 'others', (group) => {
    const L = { id: genId(), name: name.trim().slice(0, 12), icon: icon.slice(0, 8), updatedAt: Date.now(), createdAt: Date.now(), deleted: false };
    if (group) L.group = group;
    const after = () => {
      state.allLedgers.push(L);
      if (!persist()) return;
      state.ledgerId = L.id;
      rebuildMirrors();
      reload();
      scheduleSync();
      toast(`已创建账本「${L.name}」`);
    };
    if (group) {
      const who = prompt('和谁一起？（可留空）', '');
      if (who && who.trim()) L.who = who.trim().slice(0, 20);
      after();
    } else {
      after();
    }
  });
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
  if (L.builtin) { toast('内置分组不能删除，可在"⚙️ 管理"里改名', true); return; }
  const n = state.allRecords.filter((r) => !r.deleted && (r.ledgerId || 'main') === id).length;
  if (!confirm(`删除账本「${L.name}」？其中 ${n} 条记录也会一并删除。`)) return;
  L.deleted = true;
  L.updatedAt = Date.now();
  for (const r of state.allRecords) {
    if (!r.deleted && (r.ledgerId || 'main') === id) { r.deleted = true; r.updatedAt = Date.now(); }
    if (!r.deleted && r.tripId === id) { delete r.tripId; r.updatedAt = Date.now(); }
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
  'imp-xq66': ['星邱6.6', '星邱线下6.6'], 'imp-xq1121': ['星邱11.21', '星邱线下11.21'],
};

function ledgerKeywords(L) {
  return LEDGER_KEYWORDS[L.id] || [L.name];
}

function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* 小账本"账本+日期"索引：当天合计与单条金额集合，用于主账本金额匹配 */
function buildLedgerDayIndex() {
  const idx = new Map();
  for (const L of state.allLedgers) {
    if (L.deleted || L.id === 'main' || L.virtual) continue;
    for (const r of recordsOfLedger(L)) {
      if (r.type !== 'expense') continue;
      const k = L.id + '|' + r.date;
      let e = idx.get(k);
      if (!e) { e = { L, total: 0, amounts: new Set() }; idx.set(k, e); }
      e.total += r.amount;
      e.amounts.add(r.amount);
    }
  }
  return idx;
}

function findLedgerLink(r) {
  if (r.noLink) return null;
  if (r.mirror && r.mirror.ledgerId) {
    const L = state.allLedgers.find((x) => x.id === r.mirror.ledgerId && !x.deleted);
    if (L) return { lid: L.id, date: r.mirror.date, label: L.icon + ' ' + L.name };
  }
  if (r.tripId && r.tripId !== state.ledgerId) {
    const L = state.allLedgers.find((x) => x.id === r.tripId && !x.deleted);
    if (L) return { lid: L.id, date: r.date, label: '🔗 ' + L.name };
  }
  if (r.linkLid && r.linkLid !== state.ledgerId) {
    const L = state.allLedgers.find((x) => x.id === r.linkLid && !x.deleted);
    if (L) return { lid: L.id, date: r.date, label: '🔗 ' + L.name };
  }
  /* 链接只认：同一天 + 金额一致（等于小账本当天合计，或等于其中某一条） */
  if (state.ledgerId === 'main' && !r.mirror && r.type === 'expense' && state.dayIdx) {
    for (const [k, e] of state.dayIdx) {
      if (!k.endsWith('|' + r.date)) continue;
      if (e.total === r.amount) return { lid: e.L.id, date: r.date, label: '🔗 ' + e.L.name + ' 合计' };
    }
    for (const [k, e] of state.dayIdx) {
      if (!k.endsWith('|' + r.date)) continue;
      if (e.amounts.has(r.amount)) return { lid: e.L.id, date: r.date, label: '🔗 ' + e.L.name + ' 同额' };
    }
  }
  return null;
}

function jumpToLedger(lid, date) {
  state.dayFilter = date || null;
  if (date) state.month = date.slice(0, 7);
  state.tab = 'list';
  state.showForm = false;
  sfx('tap');
  navLedger(lid);
}

/* 某天在其他账本（小账本）里的活动概览，用于对照跳转，不产生任何记录 */
function ledgerDaySummary(date) {
  const out = [];
  for (const L of state.allLedgers) {
    if (L.deleted || L.id === 'main' || L.id === state.ledgerId) continue;
    let cents = 0, n = 0;
    for (const r of recordsOfLedger(L)) {
      if (r.date !== date) continue;
      if (r.type === 'expense') cents += r.amount;
      n++;
    }
    if (n) out.push({ L, cents, n });
  }
  return out;
}

function xrefHtml(date) {
  return ledgerDaySummary(date).map((x) =>
    `<div class="xref" data-xref="${esc(x.L.id)}" data-xdate="${esc(date)}">${esc(x.L.icon)} ${esc(x.L.name)} 当天 ¥${fmt(x.cents)} · ${x.n} 笔 →</div>`).join('');
}

function bindXref(view) {
  view.querySelectorAll('.xref').forEach((el) => {
    el.onclick = () => { sfx('tap'); jumpToLedger(el.dataset.xref, el.dataset.xdate); };
  });
}

function ensureHuizongCat() {
  if (!state.allCategories.some((c) => c.id === SYS_HUIZONG.id)) {
    state.allCategories.push(Object.assign({}, SYS_HUIZONG, { updatedAt: Date.now(), deleted: false }));
  }
}

function rebuildMirrors() {
  // 汇总镜像功能已移除：主账本只保留你自己记的账，对照靠 xref 跳转行
  return false;
}

function clearMirrors() {
  let changed = false;
  const now = Date.now();
  for (const r of state.allRecords) {
    if (r.mirror && !r.deleted) { r.deleted = true; r.updatedAt = now; changed = true; }
  }
  if (changed) persist();
}

/* ---------------- 底部弹层选择器（替代原生 select） ---------------- */
function openSheet(title, options, curId, cb) {
  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  let html = `<div class="sheet-title">${esc(title)}</div><div class="sheet-list">`;
  for (const o of options) {
    html += `<div class="sheet-item${o.id === curId ? ' on' : ''}" data-sid="${esc(o.id)}">
      <span class="si-label">${esc(o.label)}</span><span class="si-radio"></span></div>`;
  }
  html += '</div><button class="sheet-cancel">取消</button>';
  sheet.innerHTML = html;
  mask.appendChild(sheet);
  document.body.appendChild(mask);
  requestAnimationFrame(() => mask.classList.add('show'));
  const close = () => {
    mask.classList.remove('show');
    setTimeout(() => mask.remove(), 200);
  };
  mask.onclick = (e) => { if (e.target === mask) close(); };
  sheet.querySelector('.sheet-cancel').onclick = close;
  sheet.querySelectorAll('.sheet-item').forEach((el) => {
    el.onclick = () => { sfx('tap'); close(); cb(el.dataset.sid); };
  });
}

/* 两下式链接：第一下展开显示说明，第二下跳转 */
function bindJLinks(view) {
  view.querySelectorAll('.jlink').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      if (el.classList.contains('open')) {
        jumpToLedger(el.dataset.jump, el.dataset.jdate || null);
        return;
      }
      view.querySelectorAll('.jlink.open').forEach((x) => { x.classList.remove('open'); x.textContent = '🔗'; });
      el.classList.add('open');
      el.textContent = el.dataset.jlabel;
      sfx('tap');
    };
  });
}

function jlinkHtml(link) {
  if (!link) return '';
  return `<button class="jlink" data-jump="${esc(link.lid)}" data-jdate="${esc(link.date || '')}" data-jlabel="${esc(link.label)}">🔗</button>`;
}

/* 长按手势：550ms 触发，移动或提前抬手则取消 */
let lpFired = false;
let swipeTs = 0;
function attachLongPress(el, cb) {
  let timer = null;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  el.addEventListener('touchstart', () => {
    cancel();
    timer = setTimeout(() => { timer = null; lpFired = true; buzz(15); sfx('tap'); cb(); }, 550);
  }, { passive: true });
  el.addEventListener('touchmove', cancel, { passive: true });
  el.addEventListener('touchend', cancel);
  el.addEventListener('touchcancel', cancel);
  el.addEventListener('mousedown', () => {
    cancel();
    timer = setTimeout(() => { timer = null; lpFired = true; cb(); }, 650);
  });
  el.addEventListener('mouseup', cancel);
  el.addEventListener('mouseleave', cancel);
}

/* 导航栈：切账本/下钻时压入历史，返回键逐级退回而不是直接退出 */
let navDepth = 0;
function navLedger(lid, gameSel) {
  state.ledgerId = lid;
  state.gameSel = gameSel || null;
  reload();
  try { history.pushState({ lid: state.ledgerId, gs: state.gameSel }, ''); navDepth += 1; } catch (e) { /* ignore */ }
}
window.addEventListener('popstate', (e) => {
  navDepth = Math.max(0, navDepth - 1);
  const s = e.state;
  if (s && s.lid) {
    state.ledgerId = s.lid;
    state.gameSel = s.gs || null;
    state.showForm = false;
    reload();
  }
});
/* 荣耀/华为等系统返回手势在 Capacitor 壳里走 backButton 事件：自己弹栈，到顶才退出 */
function setupBackHandling() {
  const C = window.Capacitor;
  if (!C || !C.Plugins || !C.Plugins.App) return;
  C.Plugins.App.addListener('backButton', () => {
    if (navDepth > 0) {
      navDepth -= 1;
      history.back();
    } else {
      C.Plugins.App.exitApp();
    }
  });
}

/* ---------------- 拍照识别记一笔 ---------------- */
const _loadedScripts = {};
function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (_loadedScripts[src]) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => { _loadedScripts[src] = 1; resolve(); };
    s.onerror = () => reject(new Error('脚本加载失败'));
    document.head.appendChild(s);
  });
}
function photoCapture() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.onchange = () => {
    const file = inp.files && inp.files[0];
    if (file) recognizeImage(file);
  };
  inp.click();
}
async function recognizeImage(file) {
  toast('📷 正在加载识别引擎（首次稍慢，之后走缓存）…');
  let worker = null;
  try {
    await loadScriptOnce('vendor/tesseract.min.js');
    worker = await Tesseract.createWorker(['chi_sim', 'eng'], 1, {
      workerPath: 'vendor/tesseract.min.js',
      corePath: 'vendor/',
      langPath: 'vendor/lang',
    });
    toast('📷 识别中…');
    const { data } = await worker.recognize(file);
    showRecognizeResult((data && data.text) || '');
  } catch (e) {
    toast('识别组件加载失败（需联网），可把截图发给我代录', true);
    sfx('error');
  } finally {
    if (worker) { try { await worker.terminate(); } catch (e) { /* ignore */ } }
  }
}
function showRecognizeResult(text) {
  const clean = String(text || '').replace(/\r/g, '');
  const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
  const cands = [];
  const seen = new Set();
  const re = /(?:[¥￥]\s*(\d+(?:[.,]\d{1,2})?)|实付[:：]?\s*(\d+(?:[.,]\d{1,2})?)|金额[:：]?\s*(\d+(?:[.,]\d{1,2})?)|合计[:：]?\s*(\d+(?:[.,]\d{1,2})?))/g;
  let m;
  while ((m = re.exec(clean))) {
    let amt = (m[1] || m[2] || m[3] || m[4] || '').replace(/,/g, '.');
    if (!amt || !/^\d+(\.\d{1,2})?$/.test(amt) || Number(amt) <= 0) continue;
    const pos = clean.slice(0, m.index).split('\n').length - 1;
    let label = '';
    for (let i = pos; i >= Math.max(0, pos - 3) && !label; i--) {
      const l = (lines[i] || '').replace(/[¥￥\d.,]+\s*$/, '').trim();
      if (l && l.length >= 2 && !/^[x×*]\d+$/.test(l)) label = l.slice(0, 20);
    }
    const key = amt + '|' + label;
    if (seen.has(key)) continue;
    seen.add(key);
    cands.push({ amt, label });
  }
  if (!cands.length) {
    const opts = lines.slice(0, 12).map((l, i) => ({ id: 'line' + i, label: l.slice(0, 24) }));
    openSheet('没识别到金额，这是识别出的文字（可选一条手动记）', opts.concat([{ id: '__manual', label: '✏️ 手动填写' }]), '', (id) => {
      openForm(null);
      if (id !== '__manual') {
        const idx = Number(id.replace('line', ''));
        state.form.note = (lines[idx] || '').slice(0, 30);
      }
      render();
    });
    return;
  }
  const opts = cands.map((c) => ({ id: c.amt, label: `¥${c.amt}${c.label ? '　' + c.label : ''}` }));
  opts.push({ id: '__manual', label: '✏️ 手动填写' });
  openSheet(`识别到 ${cands.length} 个金额，点一条去记账`, opts, '', (id) => {
    openForm(null);
    if (id !== '__manual') {
      state.form.amount = id;
      const c = cands.find((x) => x.amt === id);
      if (c && c.label) state.form.note = c.label;
    }
    render();
    sfx('tap');
  });
}

/* ---------------- 记一笔 ---------------- */
const EXPAND_LIMIT = 10;
let catsExpanded = false;

function renderAdd() {
  const view = $('#view');
  if (state.showForm) { renderForm(view); return; }
  const grpNow = asGroup(state.ledgerId);
  if (grpNow && grpNow.kind === 'cat') {
    const catName = (state.categories.find((c) => c.id === grpNow.catId) || {}).name || '';
    const rows = dayRowsHtml(state.records.slice(0, 50), false);
    view.innerHTML = `
      <div class="card">
        <div class="chart-title">${esc(grpNow.name)}账条 · 主账本「${esc(catName)}」全部支出</div>
        <button class="btn-primary" id="btn-day-add" style="margin:2px 0 12px">✏️ 记一笔（自动归入该分类）</button>
        ${rows || '<div class="dp-empty">还没有这个分类的支出</div>'}
      </div>`;
    view.querySelector('#btn-day-add').onclick = () => openForm(null);
    view.querySelectorAll('.rrow').forEach((el) => {
      if (el.dataset.tripjump) return;
      el.onclick = () => {
        if (lpFired) { lpFired = false; return; }
        const r = state.records.find((x) => x.id === el.dataset.id);
        if (r) openForm(r);
      };
    });
    bindTripJumps(view);
    return;
  }
  if (grpNow || state.ledgerId === VIRTUAL_TRAVELS || state.ledgerId === VIRTUAL_OFFLINE || state.ledgerId === VIRTUAL_OTHERS) {
    const gs = groupsOf(state.ledgerId);
    view.innerHTML = `
      <div class="card">
        <div class="chart-title">${groupTitle(state.ledgerId)}</div>
        ${gs.map(groupCardHtml).join('') || '<div class="dp-empty">还没有相关账本</div>'}
        <button class="mini" id="btn-group-add" style="margin:10px 0 4px">＋ 新增小账本</button>
      </div>`;
    view.querySelectorAll('[data-gledger]').forEach((el) => {
      el.onclick = () => {
        if (el.classList.contains('del-armed')) { el.classList.remove('del-armed'); return; }
        sfx('tap'); navLedger(el.dataset.gledger);
      };
    });
    view.querySelector('#btn-group-add').onclick = () => addLedgerToGroup(state.ledgerId);
    bindWhoButtons(view);
    bindGroupCardDelete(view);
    return;
  }
  if (state.ledgerId === VIRTUAL_GAMES) {
    const gs = gameGroups();
    view.innerHTML = `
      <div class="card">
        <div class="chart-title">游戏账本 · 实时汇总主账本的"游戏"支出</div>
        <button class="btn-primary" id="btn-day-add" style="margin:2px 0 12px">✏️ 记一笔游戏开销</button>
        ${gs.map(gameCardHtml).join('') || '<div class="dp-empty">还没有游戏开销</div>'}
      </div>`;
    view.querySelector('#btn-day-add').onclick = () => openForm(null);
    view.querySelectorAll('[data-game]').forEach((el) => {
      el.onclick = () => { sfx('tap'); state.tab = 'list'; navLedger(VIRTUAL_GAMES, el.dataset.game); };
    });
    return;
  }
  const lid = state.ledgerId;
  const dayRecs = state.records.filter((r) => r.date === state.selDate);
  let exp = 0, inc = 0;
  for (const r of dayRecs) (r.type === 'expense' ? (exp += r.amount) : (inc += r.amount));
  const rows = dayRowsHtml(dayRecs, false);
  view.innerHTML = `
    <div class="list-tools"><button class="mini" id="btn-photo">📷 拍照记</button><span class="lt-hint">订单截图/小票，识别金额一键入账</span></div>
    <div class="card cal-card">
      <div class="chart-title">日历总览 · 点某天看当天、记账（左右滑换月）</div>
      ${calendarHtml(state.selDate)}
    </div>
    <div class="card">
      <div class="dp-head">
        <div class="dp-date">${dayLabel(state.selDate)}</div>
        <div class="dp-sum">支出 ¥${fmt(exp)}${inc > 0 ? ` · 收入 ¥${fmt(inc)}` : ''}</div>
      </div>
      <button class="btn-primary" id="btn-day-add" style="margin:2px 0 12px">✏️ 记一笔</button>
      ${rows || '<div class="dp-empty">这天还没有记录</div>'}
    </div>`;
  bindXref(view);
  view.querySelectorAll('.cal-cell[data-day]').forEach((el) => {
    el.onclick = () => {
      if (Date.now() - swipeTs < 500) return;
      state.selDate = el.dataset.day; sfx('tap'); buzz(10); render();
    };
  });
  bindTripJumps(view);
  bindJLinks(view);

  /* 左右滑动切换月份 */
  const calCard = view.querySelector('.cal-card');
  if (calCard) {
    let sx = 0, sy = 0, tracking = false;
    calCard.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      sx = t.clientX; sy = t.clientY; tracking = true;
    }, { passive: true });
    calCard.addEventListener('touchend', (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        swipeTs = Date.now();
        sfx('tap'); buzz(8);
        shiftMonth(dx < 0 ? 1 : -1);
      }
    }, { passive: true });
  }
  view.querySelector('#btn-day-add').onclick = () => openForm(null);
  view.querySelector('#btn-photo').onclick = photoCapture;
  view.querySelectorAll('.rrow').forEach((el) => {
    if (el.dataset.tripjump) return;
    el.onclick = () => {
      if (lpFired) { lpFired = false; return; }
      const r = dayRecs.find((x) => x.id === el.dataset.id);
      if (!r) return;
      if (r.mirror) {
        const link = findLedgerLink(r);
        if (link) { jumpToLedger(link.lid, link.date); return; }
      }
      openForm(r);
    };
    const r0 = dayRecs.find((x) => x.id === el.dataset.id);
    if (r0 && !r0.mirror) {
      attachLongPress(el, () => {
        state.dayFilter = state.selDate;
        state.multiSel = true;
        state.selected.clear();
        state.selected.add(el.dataset.id);
        state.tab = 'list';
        render();
      });
    }
  });
}

function openForm(rec) {
  state.showForm = true;
  if (rec) {
    state.form = {
      type: rec.type, categoryId: rec.catId, amount: String(rec.amount / 100),
      note: rec.note || '', date: rec.date, editingId: rec.id, game: '',
      link: rec.tripId || '', linkable: (rec.ledgerId || 'main') === 'main',
    };
  } else if (state.ledgerId === VIRTUAL_GAMES) {
    state.form = {
      type: 'expense', categoryId: GAME_CAT_ID, amount: '', note: '', date: todayStr(), editingId: null,
      game: state.gameSel && state.gameSel !== '未标注' ? state.gameSel : '', link: '', linkable: false,
    };
  } else if (state.ledgerId.startsWith('grp-')) {
    const G = asGroup(state.ledgerId);
    state.form = { type: 'expense', categoryId: G && G.kind === 'cat' ? G.catId : null, amount: '', note: '', date: todayStr(), editingId: null, game: '', link: '', linkable: false };
  } else {
    state.form = { type: 'expense', categoryId: null, amount: '', note: '', date: state.selDate, editingId: null, game: '', link: '', linkable: state.ledgerId === 'main' };
  }
  render();
}

function renderForm(view) {
  const f = state.form;
  const cats = state.categories.filter((c) => c.type === f.type && c.id !== SYS_HUIZONG.id);
  if (f.categoryId && cats.findIndex((c) => c.id === f.categoryId) >= EXPAND_LIMIT) catsExpanded = true;
  const collapsible = cats.length > EXPAND_LIMIT;
  const shown = (collapsible && !catsExpanded) ? cats.slice(0, EXPAND_LIMIT) : cats;
  const editing = f.editingId != null;
  view.innerHTML = `
    <div class="card">
      <div class="form-head">
        <button class="btn-back" id="btn-back">←</button>
        <div class="fh-date">${dayLabel(f.date)}</div>
      </div>
      <div class="seg">
        <button data-type="expense" class="${f.type === 'expense' ? 'on' : ''}">支出</button>
        <button data-type="income" class="${f.type === 'income' ? 'on' : ''}">收入</button>
      </div>
      ${state.ledgerId === VIRTUAL_GAMES && !editing ? `
      <div class="frow"><span class="fk">游戏</span><button class="exp-btn" id="f-game">${esc(f.game || '选哪个游戏')} ▾</button></div>` : ''}
      <div class="amount-row">
        <span class="yen">¥</span>
        <input id="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(f.amount)}" autofocus>
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
          <span class="cico">⚙️</span><span class="cname">管理分类</span>
        </button>
      </div>
      <div class="frow"><span class="fk">日期</span><input type="date" id="f-date" value="${esc(f.date)}"></div>
      <div class="frow"><span class="fk">备注</span><input id="f-note" maxlength="60" placeholder="选填" value="${esc(f.note)}"></div>
      ${f.linkable ? `
      <div class="frow"><span class="fk">关联</span><button class="exp-btn" id="f-link">${esc(f.link ? ((state.ledgers.find((x) => x.id === f.link) || {}).icon || '') + ' ' + ((state.ledgers.find((x) => x.id === f.link) || {}).name || '') : '不关联')} ▾</button></div>` : ''}
      ${editing ? `
        <div class="edit-actions">
          <button class="btn-ghost btn-danger" id="btn-del">删除</button>
          <button class="btn-ghost" id="btn-cancel">取消</button>
          <button class="btn-primary" id="btn-save">更新</button>
        </div>` : `
        <button class="btn-primary" id="btn-save">保存</button>`}
    </div>`;

  view.querySelector('#btn-back').onclick = () => { state.showForm = false; render(); };
  const cancelBtn = view.querySelector('#btn-cancel');
  if (cancelBtn) cancelBtn.onclick = () => { state.showForm = false; resetForm(); render(); };
  view.querySelectorAll('.seg button').forEach((b) => {
    b.onclick = () => { f.type = b.dataset.type; f.categoryId = null; render(); };
  });
  view.querySelectorAll('.cat[data-cat]').forEach((el) => {
    el.onclick = () => { f.categoryId = el.dataset.cat; sfx('tap'); buzz(10); render(); };
  });
  const more = view.querySelector('#cat-more');
  if (more) more.onclick = () => { catsExpanded = !catsExpanded; render(); };
  view.querySelector('[data-addcat]').onclick = () => openCatSheet(state.form.type);
  view.querySelector('#amount').oninput = (e) => {
    f.amount = e.target.value;
    sfx('key');
    buzz(6);
  };
  view.querySelector('#f-date').onchange = (e) => { f.date = e.target.value; };
  view.querySelector('#f-note').oninput = (e) => { f.note = e.target.value; };
  const fl = view.querySelector('#f-link');
  if (fl) fl.onclick = () => {
    const opts = [{ id: '', label: '不关联' }].concat(
      state.ledgers.filter((L) => L.id !== 'main' && !L.id.startsWith('grp-') && !L.builtin)
        .map((L) => ({ id: L.id, label: L.icon + ' ' + L.name })));
    openSheet('关联到哪个小账本', opts, f.link || '', (id) => {
      f.link = id;
      const L = id ? state.ledgers.find((x) => x.id === id) : null;
      fl.textContent = (L ? L.icon + ' ' + L.name : '不关联') + ' ▾';
      sfx('tap');
    });
  };
  view.querySelector('#btn-save').onclick = saveRecord;
  const fg = view.querySelector('#f-game');
  if (fg) fg.onclick = () => {
    const opts = GAMES.map((g) => ({ id: g, label: '🎮 ' + g })).concat([{ id: '__custom', label: '✏️ 其他（手动输入）' }]);
    openSheet('哪个游戏', opts, f.game, (id) => {
      if (id === '__custom') {
        const g = prompt('游戏名称：');
        f.game = g && g.trim() ? g.trim().slice(0, 10) : '';
      } else {
        f.game = id;
      }
      fg.textContent = (f.game || '选哪个游戏') + ' ▾';
    });
  };
  if (editing) view.querySelector('#btn-del').onclick = deleteRecord;
}

function resetForm(keepType = true) {
  const type = keepType ? state.form.type : 'expense';
  state.form = { type, categoryId: null, amount: '', note: '', date: todayStr(), editingId: null };
}

/* ---------------- 分类管理 ---------------- */
const CAT_ICONS = ['🍜', '🚌', '🛍️', '🏠', '🎮', '💊', '📚', '🎁', '📱', '📦', '✈️', '🎬',
  '☕', '🚗', '💄', '🐾', '⚽', '🎵', '🍎', '💡', '🧾', '🏥', '🎓', '💰'];
function pickIcon(current, cb) {
  const opts = CAT_ICONS.map((e) => ({ id: e, label: e })).concat([{ id: '__custom', label: '✏️ 自定义符号' }]);
  openSheet('选图标', opts, current, (id) => {
    if (id === '__custom') {
      const g = prompt('输入一个表情或符号：');
      if (g && g.trim()) cb(g.trim().slice(0, 8));
    } else {
      cb(id);
    }
  });
}

function openCatSheet(type) {
  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  mask.appendChild(sheet);
  document.body.appendChild(mask);
  requestAnimationFrame(() => mask.classList.add('show'));
  const close = () => {
    mask.classList.remove('show');
    setTimeout(() => mask.remove(), 200);
  };
  mask.onclick = (e) => { if (e.target === mask) close(); };
  const draw = () => {
    const cats = state.allCategories.filter((c) => !c.deleted && c.type === type);
    let html = `<div class="sheet-title">${type === 'expense' ? '支出' : '收入'}分类管理</div><div class="sheet-list">`;
    for (const c of cats) {
      const n = state.allRecords.filter((r) => !r.deleted && r.catId === c.id).length;
      html += `<div class="sheet-item">
        <span class="si-label"><span class="cat-ico">${esc(c.icon)}</span> ${esc(c.name)} <em class="cat-cnt">${n} 条</em></span>
        <span class="cat-ops"><button class="mini" data-cedit="${esc(c.id)}">✏️</button><button class="mini danger" data-cdel="${esc(c.id)}">🗑</button></span></div>`;
    }
    html += `</div><div class="sheet-foot"><button class="mini" id="cat-add">＋ 添加分类</button><button class="sheet-ok" id="cat-done">完成</button></div>`;
    sheet.innerHTML = html;
    sheet.querySelectorAll('[data-cedit]').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); editCategory(b.dataset.cedit, draw); };
    });
    sheet.querySelectorAll('[data-cdel]').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); deleteCategory(b.dataset.cdel, draw); };
    });
    sheet.querySelector('#cat-add').onclick = () => addCategoryType(type, draw);
    sheet.querySelector('#cat-done').onclick = close;
  };
  draw();
}

function editCategory(id, redraw) {
  const c = state.allCategories.find((x) => x.id === id && !x.deleted);
  if (!c) return;
  const name = prompt('分类名称：', c.name);
  if (name === null) return;
  if (name.trim()) c.name = name.trim().slice(0, 20);
  pickIcon(c.icon, (icon) => {
    c.icon = icon;
    c.updatedAt = Date.now();
    persist();
    reload();
    scheduleSync();
    if (redraw) redraw();
    sfx('tap');
    toast(`已更新「${c.name}」`);
  });
}

function deleteCategory(id, redraw) {
  const c = state.allCategories.find((x) => x.id === id && !x.deleted);
  if (!c) return;
  const n = state.allRecords.filter((r) => !r.deleted && r.catId === id).length;
  if (n) {
    toast(`「${c.name}」还有 ${n} 条记录在用，不能删（可改名/换图标）`, true);
    sfx('error');
    return;
  }
  if (!confirm(`删除分类「${c.name}」？`)) return;
  c.deleted = true;
  c.updatedAt = Date.now();
  persist();
  reload();
  scheduleSync();
  if (redraw) redraw();
  toast('已删除分类');
}

function addCategoryType(type, redraw) {
  const name = prompt(`新的${type === 'expense' ? '支出' : '收入'}分类名称：`);
  if (!name || !name.trim()) return;
  pickIcon('📦', (icon) => {
    const cat = { id: genId(), name: name.trim().slice(0, 20), type, icon, updatedAt: Date.now(), deleted: false };
    state.allCategories.push(cat);
    if (!persist()) return;
    if (state.form && !state.form.categoryId) state.form.categoryId = cat.id;
    reload();
    scheduleSync();
    if (redraw) redraw();
    toast(`已添加分类「${cat.name}」`);
  });
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
  const f = state.form;
  const data = formPayload();
  if (!data) return;
  const now = Date.now();
  const wasEdit = state.form.editingId != null;
  let undo = null;
  if (wasEdit) {
    const prev = Object.assign({}, state.allRecords.find((r) => r.id === state.form.editingId));
    const rec = Object.assign({}, prev, data, { updatedAt: now });
    if (rec.linkable !== undefined) delete rec.linkable;
    if ((rec.ledgerId || 'main') === 'main') {
      if (f.link) rec.tripId = f.link; else delete rec.tripId;
    }
    const i = state.allRecords.findIndex((r) => r.id === rec.id);
    if (i >= 0) state.allRecords[i] = rec; else state.allRecords.push(rec);
    undo = () => {
      const cur = state.allRecords.find((r) => r.id === prev.id);
      if (cur) Object.assign(cur, prev, { updatedAt: Date.now() });
    };
  } else {
    if (state.ledgerId === VIRTUAL_GAMES) {
      data.catId = GAME_CAT_ID; data.catName = '游戏'; data.catIcon = '🎮';
      if (f.game) data.note = (data.note ? f.game + ' ' + data.note : f.game);
    }
    const curL = state.allLedgers.find((L) => L.id === state.ledgerId && L.id !== 'main');
    const rec = Object.assign({ id: genId(), ledgerId: 'main', deleted: false }, data, { updatedAt: now });
    if (curL && !curL.id.startsWith('grp-')) rec.tripId = curL.id;
    else if (f.link) rec.tripId = f.link;
    state.allRecords.push(rec);
    undo = () => {
      const cur = state.allRecords.find((r) => r.id === rec.id);
      if (cur) { cur.deleted = true; cur.updatedAt = Date.now(); }
    };
  }
  sfx('coin');
  buzz([15, 30, 25]);
  if (!persist()) return;
  rebuildMirrors();
  state.showForm = false;
  state.selDate = data.date;
  resetForm();
  reload();
  scheduleSync();
  toastUndo(wasEdit ? '已更新' : '已记一笔 ✓', '撤销', undo);
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
  sfx('delete');
  buzz([25, 40, 25]);
  resetForm();
  state.showForm = false;
  rebuildMirrors();
  reload();
  scheduleSync();
  toastUndo('已删除', '撤销', () => {
    const r = state.allRecords.find((x) => x.id === id);
    if (r) { r.deleted = false; r.updatedAt = Date.now(); }
  });
}

/* 主账本视图：凡能连到小账本的支出（标签或金额匹配），按"账本+天"合并成一行总和 */
function dayRowsHtml(list, ms) {
  let html = '';
  const mainView = state.ledgerId === 'main' && !ms;
  const agg = new Map();
  const linked = new Set();
  if (mainView) {
    for (const r of list) {
      if (r.mirror || r.type !== 'expense') continue;
      const lk = findLedgerLink(r);
      if (lk && lk.lid) {
        linked.add(r.id);
        const e = agg.get(lk.lid) || { cents: 0, n: 0 };
        e.cents += r.amount; e.n += 1; agg.set(lk.lid, e);
      }
    }
  }
  for (const r of list) {
    if (mainView && linked.has(r.id)) continue;
    const link = findLedgerLink(r);
    const isMirror = !!r.mirror;
    const picked = ms && state.selected.has(r.id);
    html += `<div class="rrow${picked ? ' picked' : ''}${ms && isMirror ? ' mirror-row' : ''}" data-id="${esc(r.id)}" data-mirror="${isMirror ? '1' : ''}">
      ${ms ? `<span class="selbox">${picked ? '✓' : ''}</span>` : `<span class="rico">${esc(r.catIcon)}</span>`}
      <span class="rmid"><div class="rname">${esc(r.catName)}</div>
        ${r.note ? `<div class="rnote">${esc(r.note)}</div>` : ''}</span>
      <span class="ramt ${r.type}">${r.type === 'expense' ? '-' : '+'}¥${fmt(r.amount)}</span>
      ${!ms ? jlinkHtml(link) : ''}
    </div>`;
  }
  if (mainView) {
    for (const [lid, e] of agg) {
      const T = state.allLedgers.find((x) => x.id === lid && !x.deleted);
      if (!T) continue;
      html += `<div class="rrow" data-tripjump="${esc(lid)}" data-tripdate="${esc(list[0].date)}">
        <span class="rico">${esc(T.icon)}</span>
        <span class="rmid"><div class="rname">${esc(T.name)}</div>
          <div class="rnote">${e.n} 笔明细 ›</div></span>
        <span class="ramt expense">-¥${fmt(e.cents)}</span>
      </div>`;
    }
  }
  return html;
}

function bindTripJumps(view) {
  view.querySelectorAll('[data-tripjump]').forEach((el) => {
    el.onclick = () => { sfx('tap'); jumpToLedger(el.dataset.tripjump, el.dataset.tripdate); };
  });
}

/* ---------------- 明细 ---------------- */
let moveState = { date: '', ledger: '' };

function moveBarHtml() {
  const cur = moveState.ledger ? state.ledgers.find((L) => L.id === moveState.ledger) : null;
  const ledgerLabel = cur ? `${cur.icon} ${cur.name}` : '账本不变';
  return `<div class="move-bar">
    <span class="mb-count">已选 ${state.selected.size} 条</span>
    <input type="date" id="mb-date" value="${esc(moveState.date)}" title="新日期，不填则不改">
    <button class="mb-btn" id="mb-ledger">${esc(ledgerLabel)} ▾</button>
    <button id="mb-go">移动</button>
    <button id="mb-del" class="mb-del">删除</button>
  </div>`;
}

function applyMove() {
  const nd = moveState.date;
  const nl = moveState.ledger;
  if (!nd && !nl) { toast('先选个新日期或目标账本', true); return; }
  if (!state.selected.size) { toast('先勾选要移动的记录', true); return; }
  const now = Date.now();
  const snaps = [];
  const T = nl ? state.allLedgers.find((x) => x.id === nl) : null;
  for (const id of state.selected) {
    const r = state.allRecords.find((x) => x.id === id);
    if (!r || r.deleted || r.mirror) continue;
    snaps.push({ id: r.id, date: r.date, ledgerId: r.ledgerId || 'main', tripId: r.tripId || null });
    if (nd) r.date = nd;
    if (nl) {
      if (nl === 'main') { r.ledgerId = 'main'; delete r.tripId; }
      else { r.ledgerId = 'main'; r.tripId = nl; }
    }
    r.updatedAt = now;
  }
  persist();
  rebuildMirrors();
  state.multiSel = false;
  state.selected.clear();
  moveState = { date: '', ledger: '' };
  reload();
  scheduleSync();
  sfx('coin');
  buzz([15, 30, 25]);
  toastUndo(`已移动 ${snaps.length} 条`, '撤销', () => {
    const t = Date.now();
    for (const sp of snaps) {
      const r = state.allRecords.find((x) => x.id === sp.id);
      if (r) {
        r.date = sp.date; r.ledgerId = sp.ledgerId;
        if (sp.tripId) r.tripId = sp.tripId; else delete r.tripId;
        r.updatedAt = t;
      }
    }
    persist();
    rebuildMirrors();
    reload();
    scheduleSync();
  });
}

function applyBatchDelete() {
  if (!state.selected.size) { toast('先勾选要删除的记录', true); return; }
  const targets = [];
  for (const id of state.selected) {
    const r = state.allRecords.find((x) => x.id === id);
    if (r && !r.deleted && !r.mirror) targets.push(r);
  }
  if (!targets.length) return;
  if (!confirm(`确定删除选中的 ${targets.length} 条记录？`)) return;
  if (targets.length > 5 && !confirm(`再次确认：真的要删除这 ${targets.length} 条记录吗？\n（删除后 3 秒内还可撤销）`)) return;
  const now = Date.now();
  targets.forEach((r) => { r.deleted = true; r.updatedAt = now; });
  persist();
  rebuildMirrors();
  state.multiSel = false;
  state.selected.clear();
  moveState = { date: '', ledger: '' };
  reload();
  scheduleSync();
  sfx('delete');
  buzz([25, 40, 25]);
  toastUndo(`已删除 ${targets.length} 条`, '撤销', () => {
    const t = Date.now();
    targets.forEach((r) => { r.deleted = false; r.updatedAt = t; });
    persist();
    rebuildMirrors();
    reload();
    scheduleSync();
  });
}

function renderList() {
  const view = $('#view');
  const grpNow = asGroup(state.ledgerId);
  let recs = state.records;
  let filterBar = '';
  if ((grpNow && grpNow.kind !== 'cat') || state.ledgerId === VIRTUAL_TRAVELS || state.ledgerId === VIRTUAL_OFFLINE || state.ledgerId === VIRTUAL_OTHERS) {
    const ts = groupsOf(state.ledgerId);
    view.innerHTML = `<div class="card list-card">${ts.map(groupCardHtml).join('') || '<div class="dp-empty">还没有相关账本</div>'}<button class="mini" id="btn-group-add" style="margin:10px 0 4px">＋ 新增小账本</button></div>`;
    view.querySelectorAll('[data-gledger]').forEach((el) => {
      el.onclick = () => {
        if (el.classList.contains('del-armed')) { el.classList.remove('del-armed'); return; }
        sfx('tap'); navLedger(el.dataset.gledger);
      };
    });
    view.querySelector('#btn-group-add').onclick = () => addLedgerToGroup(state.ledgerId);
    bindWhoButtons(view);
    bindGroupCardDelete(view);
    return;
  }
  if (state.ledgerId === VIRTUAL_GAMES && !state.gameSel) {
    const gs = gameGroups();
    view.innerHTML = `<div class="card list-card">${gs.map(gameCardHtml).join('') || '<div class="dp-empty">还没有游戏开销</div>'}</div>`;
    view.querySelectorAll('[data-game]').forEach((el) => {
      el.onclick = () => { sfx('tap'); navLedger(VIRTUAL_GAMES, el.dataset.game); };
    });
    return;
  }
  if (state.ledgerId === VIRTUAL_GAMES) {
    recs = recs.filter((r) => gameOf(r) === state.gameSel);
    filterBar = `<div class="day-filter"><span>🎮 ${esc(state.gameSel)}</span><button id="game-back">全部游戏 ✕</button></div>`;
  } else if (state.dayFilter) {
    recs = recs.filter((r) => r.date === state.dayFilter);
    filterBar = `<div class="day-filter"><span>📅 ${dayLabel(state.dayFilter)}</span>
      <button id="clear-day">看全月 ✕</button></div>`;
  }
  const ms = state.multiSel;
  const tools = `<div class="list-tools">
      <button class="mini" id="btn-multi">${ms ? '✕ 退出多选' : '☑ 多选移动'}</button>
      ${ms ? '<span class="lt-hint">勾选记录，底部统一改日期/账本；点日期头全选当天</span>' : '<span class="lt-hint">长按记录可多选</span>'}
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
      <div class="day-head${ms ? ' dayhead-act' : ''}" data-dayall="${esc(date)}"><span>${dayLabel(date, state.ledgerId === VIRTUAL_GAMES && state.gameSel)}</span>
        <span class="day-total">支出 ¥${fmt(exp)}${inc > 0 ? ` · 收入 ¥${fmt(inc)}` : ''}</span></div>`;
    html += dayRowsHtml(list, ms);
    html += '</div>';
  }
  html += '</div>';
  if (ms) html += moveBarHtml();
  view.innerHTML = html;
  bindClearDay(view);
  bindMultiToggle(view);
  bindJLinks(view);
  bindTripJumps(view);
  const gb = view.querySelector('#game-back');
  if (gb) gb.onclick = () => navLedger(VIRTUAL_GAMES);

  if (ms) {
    view.querySelectorAll('.rrow').forEach((el) => {
      el.onclick = () => {
        if (lpFired) { lpFired = false; return; }
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
    view.querySelector('#mb-ledger').onclick = () => {
      const opts = [{ id: '', label: '账本不变' }].concat(
        state.ledgers.filter((L) => !L.id.startsWith('grp-') && !L.builtin).map((L) => ({ id: L.id, label: L.icon + ' ' + L.name })));
      openSheet('移动到哪个账本', opts, moveState.ledger, (id) => {
        moveState.ledger = id;
        const cur = id ? state.ledgers.find((L) => L.id === id) : null;
        view.querySelector('#mb-ledger').textContent = (cur ? `${cur.icon} ${cur.name}` : '账本不变') + ' ▾';
      });
    };
    view.querySelector('#mb-go').onclick = applyMove;
    view.querySelector('#mb-del').onclick = applyBatchDelete;
  } else {
    bindXref(view);
    view.querySelectorAll('.rrow').forEach((el) => {
      if (el.dataset.tripjump) return;
      el.onclick = () => {
        if (lpFired) { lpFired = false; return; }
        const r = state.records.find((x) => x.id === el.dataset.id);
        if (!r) return;
        if (r.mirror) {
          const link = findLedgerLink(r);
          if (link) { jumpToLedger(link.lid, link.date); return; }
        }
        state.selDate = r.date;
        state.tab = 'add';
        openForm(r);
      };
      const r0 = state.records.find((x) => x.id === el.dataset.id);
      if (r0 && !r0.mirror) {
        attachLongPress(el, () => {
          state.multiSel = true;
          state.selected.clear();
          state.selected.add(el.dataset.id);
          render();
        });
      }
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
      ? `<span class="ce${t.exp >= 100000 ? ' long' : ''}">${t.exp ? '-' + fmtDay(t.exp) : ''}</span><span class="ci${t.inc >= 100000 ? ' long' : ''}">${t.inc ? '+' + fmtDay(t.inc) : ''}</span>`
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

function drawPie(ctx, slices, total, size, hi) {
  const cx = size / 2, cy = size / 2, R = size * 0.44, r = size * 0.30;
  let a = -Math.PI / 2;
  if (!slices.length) {
    ctx.fillStyle = '#f2f2ef';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.arc(cx, cy, r, 0, Math.PI * 2, true); ctx.fill();
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  slices.forEach((sl, i) => {
    const a2 = a + (sl.value / total) * Math.PI * 2;
    const isHi = hi === i;
    const rr = isHi ? R + 4 : R;
    ctx.globalAlpha = (hi >= 0 && !isHi) ? 0.35 : 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, rr, a, a2);
    ctx.closePath();
    ctx.fillStyle = sl.color;
    ctx.fill();
    ctx.stroke();
    a = a2;
  });
  ctx.globalAlpha = 1;
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

function drawBars(ctx, cols, W, H, hoverIdx) {
  const padL = 6, padR = 6, padT = 12, padB = 20;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = Math.max(1, cols.length);
  let max = 0;
  for (const c of cols) max = Math.max(max, c.exp || 0, c.inc || 0);
  if (max <= 0) max = 1;
  const slot = plotW / n;
  if (hoverIdx >= 0 && hoverIdx < cols.length) {
    ctx.fillStyle = 'rgba(136, 136, 208, 0.13)';
    ctx.fillRect(padL + slot * hoverIdx, padT - 4, slot, plotH + 4);
  }
  ctx.strokeStyle = '#f0efec';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 2; i++) {
    const y = padT + (plotH * i) / 2;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
  }
  const bw = Math.max(3, Math.min(10, slot * 0.42));
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
  const grpS = asGroup(state.ledgerId);
  const expCats = state.ledgerId === VIRTUAL_GAMES
    ? gameGroups().map((g) => ({ name: g.name, icon: '🎮', type: 'expense', amount: g.amount, count: g.count }))
    : grpS && grpS.kind === 'cat'
      ? s.byCategory.filter((c) => c.type === 'expense')
      : grpS || state.ledgerId === VIRTUAL_TRAVELS || state.ledgerId === VIRTUAL_OFFLINE || state.ledgerId === VIRTUAL_OTHERS
        ? groupsOf(state.ledgerId).map((t) => ({ name: t.L.name, icon: t.L.icon, type: 'expense', amount: t.cents, count: t.n }))
        : s.byCategory.filter((c) => c.type === 'expense');
  const incCats = s.byCategory.filter((c) => c.type === 'income');
  /* 配色：>=3% 的分类按序取色，更小的合并为灰色"其他"，避免彩虹图 */
  const colorOf = new Map();
  const slices = [];
  let otherAmt = 0, otherN = 0;
  for (const c of expCats) {
    const frac = s.expense > 0 ? c.amount / s.expense : 0;
    if (frac >= 0.03) {
      const col = PALETTE[slices.length % PALETTE.length];
      colorOf.set(c, col);
      slices.push({ value: c.amount, color: col, label: `${c.icon} ${c.name}　¥${fmt(c.amount)} · ${Math.round(frac * 100)}%` });
    } else {
      otherAmt += c.amount; otherN++;
      colorOf.set(c, '#c9cdd6');
    }
  }
  if (otherN > 0) {
    const frac = s.expense > 0 ? otherAmt / s.expense : 0;
    slices.push({ value: otherAmt, color: '#c9cdd6', label: `📦 其他 ${otherN} 项　¥${fmt(otherAmt)} · ${Math.round(frac * 100)}%` });
  }
  incCats.forEach((c, i) => colorOf.set(c, PALETTE[i % PALETTE.length]));
  const legendRows = (cats, total) => cats.map((c) => `
    <div class="legend-item">
      <div class="legend-line">
        <span class="l-name">${esc(c.icon)} ${esc(c.name)}</span>
        <span class="l-val">¥${fmt(c.amount)}</span>
        <span class="l-pct">${total > 0 ? Math.round((c.amount / total) * 100) : 0}%</span>
      </div>
      <div class="lbar"><i style="width:${total > 0 ? Math.max(2, (c.amount / total) * 100) : 0}%;background:${colorOf.get(c) || '#c9cdd6'}"></i></div>
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
    const [y2, m2] = state.month.split('-').map(Number);
    const days = new Date(y2, m2, 0).getDate();
    const expByDay = {}, incByDay = {};
    for (const d of s.daily) {
      const day = Number(d.date.slice(8, 10));
      expByDay[day] = d.expense; incByDay[day] = d.income;
    }
    cols = [];
    for (let d = 1; d <= days; d++) {
      cols.push({ label: String(d), tipDate: `${m2}月${d}日`, exp: expByDay[d] || 0, inc: incByDay[d] || 0, tick: d === 1 || d % 5 === 0 || d === days });
    }
  } else {
    const bm = s.byMonth;
    const step = Math.max(1, Math.ceil(bm.length / 12));
    cols = bm.map((b, i) => ({
      label: String(Number(b.month.slice(5))),
      tipDate: b.month.replace("-", "年") + "月",
      exp: b.expense, inc: b.income, tick: i % step === 0,
    }));
    if (!cols.length) cols = [{ label: '', tipDate: '', exp: 0, inc: 0, tick: false }];
  }

  const pie = view.querySelector('#pie');
  const pieSize = Math.min(260, Math.max(200, (view.clientWidth || 360) - 100));
  const pctx = setupCanvas(pie, pieSize, pieSize);
  let pieHi = -1;
  const redrawPie = () => {
    pctx.clearRect(0, 0, pieSize, pieSize);
    drawPie(pctx, slices, s.expense, pieSize, pieHi);
  };
  redrawPie();

  /* 按住色块看金额，松开消失（鼠标悬停亦可） */
  const pieTip = document.createElement('div');
  pieTip.className = 'chart-tip';
  pieTip.hidden = true;
  const pieHost = pie.parentElement;
  pieHost.style.position = 'relative';
  pieHost.appendChild(pieTip);
  const hitSlice = (clientX, clientY) => {
    const rect = pie.getBoundingClientRect();
    const x = clientX - rect.left - pieSize / 2;
    const y = clientY - rect.top - pieSize / 2;
    const dist = Math.hypot(x, y);
    if (dist > pieSize * 0.46 || dist < pieSize * 0.30 || !slices.length || s.expense <= 0) return -1;
    let ang = Math.atan2(y, x) + Math.PI / 2;
    if (ang < 0) ang += Math.PI * 2;
    let acc = 0;
    for (let i = 0; i < slices.length; i++) {
      acc += (slices[i].value / s.expense) * Math.PI * 2;
      if (ang <= acc) return i;
    }
    return slices.length - 1;
  };
  const showPie = (clientX, clientY) => {
    const i = hitSlice(clientX, clientY);
    if (i !== pieHi) { pieHi = i; redrawPie(); }
    if (i >= 0) {
      pieTip.textContent = slices[i].label;
      pieTip.style.left = (pie.offsetLeft + pieSize / 2) + 'px';
      pieTip.style.top = (pie.offsetTop + pieSize / 2 - pieSize * 0.16) + 'px';
      pieTip.hidden = false;
    } else {
      pieTip.hidden = true;
    }
  };
  const hidePie = () => {
    pieTip.hidden = true;
    if (pieHi !== -1) { pieHi = -1; redrawPie(); }
  };
  pie.addEventListener('mousedown', (e) => showPie(e.clientX, e.clientY));
  pie.addEventListener('mousemove', (e) => showPie(e.clientX, e.clientY));
  pie.addEventListener('mouseup', hidePie);
  pie.addEventListener('mouseleave', hidePie);
  pie.addEventListener('touchstart', (e) => { e.preventDefault(); showPie(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
  pie.addEventListener('touchmove', (e) => { e.preventDefault(); showPie(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
  pie.addEventListener('touchend', hidePie);

  const bars = view.querySelector('#bars');
  const W = Math.max(200, (view.clientWidth || 360) - 60);
  const bctx = setupCanvas(bars, W, 170);
  let hoverIdx = -1;
  const redraw = () => {
    bctx.clearRect(0, 0, W, 170);
    drawBars(bctx, cols, W, 170, hoverIdx);
  };
  redraw();

  /* 手指/鼠标滑动查看当天金额 */
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  const host = bars.parentElement;
  host.style.position = 'relative';
  host.appendChild(tip);
  const hideTip = () => {
    tip.hidden = true;
    if (hoverIdx !== -1) { hoverIdx = -1; redraw(); }
  };
  const moveTip = (clientX) => {
    const rect = bars.getBoundingClientRect();
    const x = clientX - rect.left;
    const slot = (rect.width - 12) / cols.length;
    const idx = Math.floor((x - 6) / slot);
    if (idx < 0 || idx >= cols.length) { hideTip(); return; }
    if (idx !== hoverIdx) { hoverIdx = idx; redraw(); }
    const c = cols[idx];
    tip.textContent = `${c.tipDate}　支出 ¥${(c.exp / 100).toFixed(2)}${c.inc ? `　收入 ¥${(c.inc / 100).toFixed(2)}` : ''}`;
    const lx = Math.min(Math.max(6 + slot * (idx + 0.5), 70), rect.width - 70);
    tip.style.left = (bars.offsetLeft + lx) + 'px';
    tip.style.top = (bars.offsetTop + 2) + 'px';
    tip.hidden = false;
  };
  bars.addEventListener('mousemove', (e) => moveTip(e.clientX));
  bars.addEventListener('mouseleave', hideTip);
  bars.addEventListener('touchstart', (e) => { e.preventDefault(); moveTip(e.touches[0].clientX); }, { passive: false });
  bars.addEventListener('touchmove', (e) => { e.preventDefault(); moveTip(e.touches[0].clientX); }, { passive: false });
  bars.addEventListener('touchend', hideTip);

  view.querySelectorAll('[data-legend]').forEach((b) => {
    b.onclick = () => { legendState[b.dataset.legend] = !legendState[b.dataset.legend]; renderStats(); };
  });
}

/* ---------------- 导出账单 ---------------- */
let exportState = null;
function mLabel(m) { return m.replace('-', '年') + '月'; }
function expLedgerLabel() {
  if (exportState.ledger === 'all') return '全部账本';
  const L = state.ledgers.find((x) => x.id === exportState.ledger);
  return L ? L.icon + ' ' + L.name : '全部账本';
}
function initExportState() {
  const months = monthList();
  if (!exportState) exportState = { ledger: 'all', from: months[0], to: months[months.length - 1] };
  if (!months.includes(exportState.from)) exportState.from = months[0];
  if (!months.includes(exportState.to)) exportState.to = months[months.length - 1];
}
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
  const lid = exportState.ledger;
  const from = exportState.from;
  const to = exportState.to;
  if (from > to) { toast('开始时间不能晚于结束时间', true); return; }
  const ledgerName = {};
  for (const L of state.allLedgers) ledgerName[L.id] = L.name;
  const EL = lid === 'all' ? null : state.allLedgers.find((x) => x.id === lid);
  const rows = state.allRecords
    .filter((r) => !r.deleted && (lid === 'all'
      ? true
      : ((r.ledgerId || 'main') === lid || ((r.ledgerId || 'main') === 'main' && r.tripId === lid))))
    .filter((r) => r.date >= from + "-01" && r.date <= to + "-31")
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
  sfx('coin');
  buzz([15, 30, 25]);
}

const APP_VER = 'v78 · 2026-11-27';

/* ---------------- 设置 ---------------- */
function renderSettings() {
  const view = $('#view');
  const lastSync = settings.lastSync ? new Date(settings.lastSync).toLocaleString('zh-CN') : '从未';
  const ledgerRows = state.ledgers.filter((L) => !L.id.startsWith('grp-') && !L.builtin).map((L) => {
    const n = recordsOfLedger(L).length;
    return `<div class="mrow">
      <span class="mico">${esc(L.icon)}</span>
      <span class="mname">${esc(L.name)}<em>${n} 条记录${L.id === 'main' ? ' · 主账本，不可删除' : (isTravel(L) ? ' · 🧳旅游' : (isOffline(L) ? ' · 🌟线下' : (isOthers(L) ? ' · 📁其他' : '')))}${L.who ? ' · 👥' + esc(L.who) : ''}</em></span>
      ${L.id === 'main' ? '' : `<button class="mini" data-who="${esc(L.id)}">同行人</button><button class="mini" data-ren="${esc(L.id)}">改名</button><button class="mini danger" data-del="${esc(L.id)}">删除</button>`}
    </div>`;
  }).join('');
  const groupRows = customGroups().map((G) => `
    <div class="mrow">
      <span class="mico">${esc(G.icon)}</span>
      <span class="mname">${esc(G.name)}<em>${G.kind === 'cat'
    ? '账条式 · 汇总主账本「' + ((state.categories.find((c) => c.id === G.catId) || {}).name || '?') + '」'
    : '账本式 · 含 ' + state.ledgers.filter((L) => L.group === G.id).length + ' 个小账本'}</em></span>
      <button class="mini danger" data-gdel="${esc(G.id)}">删除</button>
    </div>`).join('') || '<div class="dp-empty">还没有自定义分类，用顶部"＋ 新分类"创建</div>';
  const peopleRows = state.allPeople.filter((p) => !p.deleted).map((p) => `
    <div class="mrow">
      <span class="mico">${avatarInner(p)}</span>
      <span class="mname">${esc(p.name)}</span>
      <button class="mini" data-pedit="${esc(p.id)}">编辑</button>
      <button class="mini danger" data-pdel="${esc(p.id)}">删除</button>
    </div>`).join('') || '<div class="dp-empty">还没有同伴，点下面新建</div>';
  initExportState();
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
      <div class="chart-title">交互体验</div>
      <div class="frow"><span class="fk" style="width:auto;flex:1">音效与震动</span>
        <button class="mini" id="sound-toggle">${settings.sound ? '已开启' : '已关闭'}</button></div>
      <div class="set-help">记账"咔哒-叮"金币声、撤销倒播音、删除低响、同步琶音、按键轻音；每个操作都配了震动节奏。关闭后全部静音。</div>
    </div>
    <div class="card">
      <div class="chart-title">账本管理</div>
      ${ledgerRows}
    </div>
    <div class="card">
      <div class="chart-title">分类管理</div>
      ${groupRows}
    </div>
    <div class="card">
      <div class="chart-title">同伴管理</div>
      ${peopleRows}
      <button class="mini" id="btn-add-person" style="margin-top:8px">＋ 新建同伴（可上传照片头像）</button>
    </div>
    <div class="card">
      <div class="chart-title">导出账单</div>
      <div class="frow"><span class="fk">账本</span><button class="exp-btn" id="exp-ledger">${esc(expLedgerLabel())} ▾</button></div>
      <div class="frow"><span class="fk">从</span><button class="exp-btn" id="exp-from">${esc(mLabel(exportState.from))} ▾</button></div>
      <div class="frow"><span class="fk">到</span><button class="exp-btn" id="exp-to">${esc(mLabel(exportState.to))} ▾</button></div>
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
        界面版本：<b style="color:var(--ink)">${APP_VER}</b><br>
        记账本离线版：断网、电脑关机都能记账，联网后自动同步。<br>
        数据双保险：本机一份 + GitHub 私有 Gist 一份（只有你的账号可见）。
      </div>
      <div class="set-actions">
        <button class="btn-ghost" id="btn-reload">🔄 检查更新</button>
        <button class="btn-ghost" id="btn-sound-test">🔔 试听音效</button>
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
  const upd = (id, txt) => { view.querySelector(id).textContent = txt + ' ▾'; };
  view.querySelector('#exp-ledger').onclick = () => {
    const opts = [{ id: 'all', label: '全部账本' }].concat(
      state.ledgers.filter((L) => !L.id.startsWith('grp-') && !L.builtin).map((L) => ({ id: L.id, label: L.icon + ' ' + L.name })));
    openSheet('导出哪个账本', opts, exportState.ledger, (id) => { exportState.ledger = id; upd('#exp-ledger', expLedgerLabel()); });
  };
  view.querySelector('#exp-from').onclick = () => {
    const opts = monthList().map((m) => ({ id: m, label: mLabel(m) }));
    openSheet('开始月份', opts, exportState.from, (id) => { exportState.from = id; upd('#exp-from', mLabel(id)); });
  };
  view.querySelector('#exp-to').onclick = () => {
    const opts = monthList().map((m) => ({ id: m, label: mLabel(m) }));
    openSheet('结束月份', opts, exportState.to, (id) => { exportState.to = id; upd('#exp-to', mLabel(id)); });
  };
  const inst = view.querySelector('#btn-install-now');
  if (inst) inst.onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (e) { /* ignore */ }
    deferredPrompt = null;
    render();
  };
  const snd = view.querySelector('#sound-toggle');
  if (snd) snd.onclick = () => {
    settings.sound = !settings.sound;
    saveSettings();
    if (settings.sound) { sfx('save'); buzz(35); }
    render();
  };
  view.querySelector('#btn-reload').onclick = () => {
    toast('正在检查更新…');
    setTimeout(() => location.reload(), 300);
  };
  view.querySelector('#btn-sound-test').onclick = () => {
    if (!settings.sound) { toast('音效已关闭，先点上面的开关开启', true); return; }
    sfx('coin');
    buzz([15, 30, 25]);
    setTimeout(() => { sfx('sync'); buzz(20); }, 500);
    setTimeout(() => { sfx('undo'); buzz([12, 20, 12]); }, 1200);
  };
  view.querySelectorAll('[data-ren]').forEach((b) => { b.onclick = () => renameLedger(b.dataset.ren); });
  view.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => deleteLedger(b.dataset.del); });
  view.querySelectorAll('[data-who]').forEach((b) => {
    b.onclick = () => {
      const L = state.allLedgers.find((x) => x.id === b.dataset.who && !x.deleted);
      if (L) openWhoSheet(L);
    };
  });
  view.querySelectorAll('[data-pedit]').forEach((b) => { b.onclick = () => editPerson(b.dataset.pedit); });
  view.querySelectorAll('[data-gdel]').forEach((b) => { b.onclick = () => deleteGroup(b.dataset.gdel); });
  view.querySelectorAll('[data-pdel]').forEach((b) => { b.onclick = () => deletePerson(b.dataset.pdel); });
  const bap = view.querySelector('#btn-add-person');
  if (bap) bap.onclick = () => addPerson().then(() => render());
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

/* 年月双列选择器：点标题"2026年9月 ▾"弹出 */
function openMonthPicker() {
  if (!hasCalendarView()) return;
  const ms = monthList();
  if (!ms.length) return;
  const minY = Number(ms[0].slice(0, 4));
  const maxY = Number(ms[ms.length - 1].slice(0, 4));
  let selY = Number(state.month.slice(0, 4));
  let selM = Number(state.month.slice(5, 7));
  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  mask.appendChild(sheet);
  document.body.appendChild(mask);
  requestAnimationFrame(() => mask.classList.add('show'));
  const close = () => {
    mask.classList.remove('show');
    setTimeout(() => mask.remove(), 200);
  };
  mask.onclick = (e) => { if (e.target === mask) close(); };
  const draw = () => {
    let yh = '';
    for (let y = minY; y <= maxY; y++) yh += `<div class="mp-item${y === selY ? ' on' : ''}" data-y="${y}">${y}年</div>`;
    let mh = '';
    for (let m = 1; m <= 12; m++) mh += `<div class="mp-item${m === selM ? ' on' : ''}" data-m="${m}">${m}月</div>`;
    sheet.innerHTML = `<div class="sheet-title">选择年月 · 直达记账</div>
      <div class="mp-body"><div class="mp-col">${yh}</div><div class="mp-col">${mh}</div></div>
      <div class="sheet-foot"><button class="mini" id="mp-cancel">取消</button>
      <button class="sheet-ok" id="mp-ok">跳到 ${selY}年${selM}月</button></div>`;
    sheet.querySelectorAll('[data-y]').forEach((el) => {
      el.onclick = () => { selY = Number(el.dataset.y); sfx('tap'); draw(); };
    });
    sheet.querySelectorAll('[data-m]').forEach((el) => {
      el.onclick = () => { selM = Number(el.dataset.m); sfx('tap'); draw(); };
    });
    sheet.querySelector('#mp-cancel').onclick = close;
    sheet.querySelector('#mp-ok').onclick = () => {
      state.month = `${selY}-${pad2(selM)}`;
      state.dayFilter = null;
      close();
      sfx('tap');
      buzz(10);
      reload();
    };
    const on = sheet.querySelector('.mp-item.on');
    if (on) on.scrollIntoView({ block: 'center' });
  };
  draw();
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
$('#month-label').onclick = openMonthPicker;
$('#this-month').onclick = () => { if (state.month !== thisMonth()) { state.month = thisMonth(); state.dayFilter = null; reload(); } };
document.querySelectorAll('.tab').forEach((t) => {
  t.onclick = () => {
    sfx('tap');
    buzz(8);
    state.tab = t.dataset.tab;
    state.showForm = false;
    state.gameSel = null;
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
    state.allPeople = d0.people;
    const h = location.hash.replace('#', '');
    if (['add', 'list', 'stats', 'set'].includes(h)) state.tab = h;
    const qs = new URLSearchParams(location.search);
    const lp = qs.get('l');
    if (lp) state.ledgerId = lp;
    const mp = qs.get('m');
    if (mp && /^\d{4}-\d{2}$/.test(mp)) state.month = mp;
    const dp = qs.get('d');
    if (dp && /^\d{4}-\d{2}-\d{2}$/.test(dp)) { state.selDate = dp; state.month = dp.slice(0, 7); }
    if (settings.token) {
      // 已配置同步：先拉云端账本，避免把示例分类播种进已有数据（防止复活）
      await doSync('boot');
    }
    let dirty = false;
    if (!state.allPeople.length) {
      const nowP = Date.now();
      state.allPeople = PEOPLE_SEED.map((p) => ({ id: p[0], name: p[1], avatar: p[2], updatedAt: nowP, deleted: false }));
      dirty = true;
    }
    for (const L of state.allLedgers) {
      if (!L.whoIds && L.who) {
        const ids = ledgerWhoIds(L);
        if (ids.length) { L.whoIds = ids; dirty = true; }
      }
    }
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
    ensureBuiltinMeta();
    clearMirrors();
    reload();
    try { history.replaceState({ lid: state.ledgerId, gs: null }, ''); } catch (e) { /* ignore */ }
    setupBackHandling();
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
      // 部署新版本后自动刷新；首次接管不刷新，避免多余重载
      let hadController = !!navigator.serviceWorker.controller;
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) { hadController = true; return; }
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
