'use strict';
/* 记账本前端 —— 无外部依赖 */

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
function fmt(n) {
  return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const state = {
  month: thisMonth(),
  tab: 'add',
  categories: [],
  records: [],
  stats: null,
  form: { type: 'expense', categoryId: null, amount: '', note: '', date: todayStr(), editingId: null },
};

/* ---------------- API ---------------- */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (_) { /* ignore */ }
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

async function loadAll() {
  const [cats, recs, stats] = await Promise.all([
    api('/api/categories'),
    api(`/api/records?month=${state.month}`),
    api(`/api/stats?month=${state.month}`),
  ]);
  state.categories = cats.categories;
  state.records = recs.records;
  state.stats = stats;
  render();
}

/* ---------------- toast ---------------- */
let toastTimer = null;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

/* ---------------- 顶栏 ---------------- */
function renderHeader() {
  $('#month-label').textContent = monthLabel(state.month);
  const s = state.stats || { income: 0, expense: 0, net: 0 };
  $('#sum-expense').textContent = '¥' + fmt(s.expense);
  $('#sum-income').textContent = '¥' + fmt(s.income);
  const net = $('#sum-net');
  net.textContent = (s.net < 0 ? '-¥' : '¥') + fmt(Math.abs(s.net));
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
          <div class="cat ${c.id === f.categoryId ? 'sel' : ''}" data-cat="${c.id}">
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
    el.onclick = () => { f.categoryId = Number(el.dataset.cat); render(); };
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
  try {
    const r = await api('/api/categories', { method: 'POST', body: { name: name.trim(), type: state.form.type, icon } });
    state.categories.push(r.category);
    state.form.categoryId = r.category.id;
    render();
    toast(r.existed ? '已有同名分类，已选中' : `已添加分类「${name.trim()}」`);
  } catch (e) { toast(e.message, true); }
}

function formPayload() {
  const f = state.form;
  const amount = f.amount.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) { toast('请输入正确的金额（大于0，最多两位小数）', true); return null; }
  if (!f.categoryId) { toast('请选择一个分类', true); return null; }
  if (!f.date) { toast('请选择日期', true); return null; }
  return { type: f.type, amount, category_id: f.categoryId, date: f.date, note: f.note.trim() };
}

async function saveRecord() {
  const body = formPayload();
  if (!body) return;
  try {
    if (state.form.editingId != null) {
      await api(`/api/records/${state.form.editingId}`, { method: 'PUT', body });
      toast('已更新');
      resetForm();
      state.tab = 'list';
    } else {
      await api('/api/records', { method: 'POST', body });
      toast('已记一笔 ✓');
      resetForm();
    }
    await loadAll();
  } catch (e) { toast(e.message, true); }
}

async function deleteRecord() {
  if (state.form.editingId == null) return;
  if (!confirm('确定删除这条记录吗？')) return;
  try {
    await api(`/api/records/${state.form.editingId}`, { method: 'DELETE' });
    toast('已删除');
    resetForm();
    state.tab = 'list';
    await loadAll();
  } catch (e) { toast(e.message, true); }
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
      html += `<div class="rec" data-id="${r.id}">
        <div class="ico">${esc(r.category_icon)}</div>
        <div class="mid"><div class="name">${esc(r.category_name)}</div>
          <div class="note">${esc(r.note) || '无备注'}</div></div>
        <div class="amt ${r.type}">${r.type === 'expense' ? '-' : '+'}¥${fmt(r.amount)}</div>
      </div>`;
    }
    html += '</div>';
  }
  view.innerHTML = html;
  view.querySelectorAll('.rec').forEach((el) => {
    el.onclick = () => {
      const r = state.records.find((x) => x.id === Number(el.dataset.id));
      if (!r) return;
      state.form = {
        type: r.type, categoryId: r.category_id, amount: String(r.amount),
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
    const frac = s.value / total;
    const a2 = a + frac * Math.PI * 2;
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
  ctx.fillStyle = '#8a90a6';
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
  if (!s) { view.innerHTML = '<div class="empty">加载中…</div>'; return; }
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
    (d.type === 'expense' ? expByDay : incByDay)[day] = (d.type === 'expense' ? expByDay[day] || 0 : incByDay[day] || 0) + d.amount;
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

/* ---------------- 渲染入口 ---------------- */
function render() {
  renderHeader();
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === state.tab));
  if (state.tab === 'add') renderAdd();
  else if (state.tab === 'list') renderList();
  else renderStats();
}

/* ---------------- 事件 ---------------- */
function shiftMonth(delta) {
  const [y, m] = state.month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  state.month = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  loadAll().catch((e) => toast(e.message, true));
}

$('#prev-month').onclick = () => shiftMonth(-1);
$('#next-month').onclick = () => shiftMonth(1);
$('#this-month').onclick = () => { if (state.month !== thisMonth()) { state.month = thisMonth(); loadAll(); } };
document.querySelectorAll('.tab').forEach((t) => {
  t.onclick = () => { state.tab = t.dataset.tab; render(); };
});
window.addEventListener('resize', () => { if (state.tab === 'stats') renderStats(); });

/* ---------------- 启动 ---------------- */
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* 离线缓存不可用也不影响使用 */ });
}
loadAll().catch((e) => {
  toast('连接服务失败：' + e.message, true);
  render();
});
