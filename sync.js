/* 记账本同步模块 —— 通过 GitHub 私有 Gist 在多设备间同步账本。
 * 浏览器挂到 window.JZ；Node 里可 require（用于自动化测试）。 */
(function (global) {
  'use strict';

  const API = 'https://api.github.com';
  const GIST_FILE = 'jizhang-ledger.json';

  async function gh(path, opts, token) {
    opts = opts || {};
    const res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
      },
      body: opts.body,
    });
    if (res.status === 404) throw new Error('GitHub 404：Token 无效或账本 Gist 不存在');
    if (res.status === 401) throw new Error('GitHub 401：Token 无效或已过期');
    if (res.status === 403) throw new Error('GitHub 403：Token 权限不足（需要勾选 gist 范围）');
    if (!res.ok) {
      let msg = 'GitHub HTTP ' + res.status;
      try { const j = await res.json(); if (j.message) msg += '：' + j.message; } catch (e) { /* ignore */ }
      throw new Error(msg);
    }
    return res.status === 204 ? null : await res.json();
  }

  /* 按 id 合并两个列表，updatedAt 新的胜出（含删除标记，实现“删除也同步”） */
  function mergeList(a, b) {
    const m = new Map();
    for (const x of a || []) m.set(x.id, x);
    for (const x of b || []) {
      const cur = m.get(x.id);
      if (!cur) { m.set(x.id, x); continue; }
      // createdAt 是不可变元数据：胜方缺失时从负方继承，防止同步覆盖丢失
      if (x.updatedAt > cur.updatedAt) {
        if (!x.createdAt && cur.createdAt) x.createdAt = cur.createdAt;
        m.set(x.id, x);
      } else if (!cur.createdAt && x.createdAt) {
        cur.createdAt = x.createdAt;
      }
    }
    return Array.from(m.values());
  }

  async function findGist(token) {
    const list = await gh('/gists?per_page=100', {}, token);
    const g = (list || []).find((x) => x.files && x.files[GIST_FILE]);
    return g ? g.id : null;
  }

  async function readLedger(gistId, token) {
    const g = await gh('/gists/' + encodeURIComponent(gistId), {}, token);
    const f = g.files && g.files[GIST_FILE];
    if (!f) return { records: [], categories: [], ledgers: [] };
    let text = f.content;
    if (text == null || f.truncated) {
      // 大文件在 API 响应里会被截断，改用 raw 地址读完整内容
      const resp = await fetch(f.raw_url, { headers: { Accept: 'application/vnd.github.raw+json' } });
      if (!resp.ok) throw new Error('读取云端账本内容失败 (HTTP ' + resp.status + ')');
      text = await resp.text();
    }
    if (!text) return { records: [], categories: [], ledgers: [], people: [] };
    let data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error('云端账本内容解析失败，已中止同步以保护数据'); }
    if (!(data && Array.isArray(data.records) && Array.isArray(data.categories))) {
      throw new Error('云端账本格式异常，已中止同步');
    }
    if (!Array.isArray(data.ledgers)) data.ledgers = [];
    if (!Array.isArray(data.people)) data.people = [];
    return data;
  }

  async function writeLedger(gistId, payload, token) {
    await gh('/gists/' + encodeURIComponent(gistId), {
      method: 'PATCH',
      body: JSON.stringify({
        files: { [GIST_FILE]: { content: JSON.stringify(payload) } },
      }),
    }, token);
  }

  async function createLedger(payload, token) {
    const g = await gh('/gists', {
      method: 'POST',
      body: JSON.stringify({
        description: '记账本账本（App 自动同步，请勿手动编辑）',
        public: false,
        files: { [GIST_FILE]: { content: JSON.stringify(payload) } },
      }),
    }, token);
    return g.id;
  }

  /* 一次完整同步：找到/创建 Gist → 拉取远端 → 双向合并 → 写回。
   * settings: {token, gistId}；local: {records, categories}（含删除标记的完整列表） */
  async function syncNow(settings, local) {
    if (!settings.token) throw new Error('未配置 GitHub Token');
    let gistId = settings.gistId || await findGist(settings.token);
    const payload = {
      version: 2,
      syncedAt: Date.now(),
      records: local.records || [],
      categories: local.categories || [],
      ledgers: local.ledgers || [],
      people: local.people || [],
    };
    if (!gistId) {
      gistId = await createLedger(payload, settings.token);
      return { gistId, records: payload.records, categories: payload.categories, ledgers: payload.ledgers, people: payload.people, created: true };
    }
    const remote = await readLedger(gistId, settings.token);
    const records = mergeList(local.records, remote.records);
    const categories = mergeList(local.categories, remote.categories);
    const ledgers = mergeList(local.ledgers, remote.ledgers);
    const people = mergeList(local.people, remote.people);
    /* 系统示例分类（seed-*）：任何一端删除即永久删除，防止新设备播种后复活 */
    const seedDel = {};
    for (const c of (local.categories || [])) {
      if (String(c.id).indexOf('seed-') === 0 && c.deleted) seedDel[c.id] = c.updatedAt || 0;
    }
    for (const c of (remote.categories || [])) {
      if (String(c.id).indexOf('seed-') === 0 && c.deleted) {
        seedDel[c.id] = Math.max(seedDel[c.id] || 0, c.updatedAt || 0);
      }
    }
    for (const c of categories) {
      if (String(c.id).indexOf('seed-') === 0 && seedDel[c.id] != null) {
        c.deleted = true;
        c.updatedAt = Math.max(c.updatedAt || 0, seedDel[c.id]) + 1;
      }
    }
    payload.records = records;
    payload.categories = categories;
    payload.ledgers = ledgers;
    payload.people = people;
    await writeLedger(gistId, payload, settings.token);
    return { gistId, records, categories, ledgers, people, created: false };
  }

  const JZ = { syncNow, mergeList, findGist, readLedger, GIST_FILE };
  if (typeof module !== 'undefined' && module.exports) module.exports = JZ;
  else global.JZ = JZ;
})(typeof window !== 'undefined' ? window : globalThis);
