/* 同步模块真实 API 测试（Node 运行，需要 GH_TOKEN 环境变量，token 需有 gist 权限）。
 * 模拟两台设备：A 创建账本 → B 加入 → 各记一笔 → 互相同步 → 删除一笔再同步。
 * 测试结束自动删除临时 Gist。 */
const JZ = require("../sync.js");

const token = process.env.GH_TOKEN;
if (!token) { console.log("NO TOKEN"); process.exit(2); }

const fails = [];
function check(name, cond, extra) {
  console.log((cond ? "PASS " : "FAIL ") + name + (extra !== undefined ? " | " + JSON.stringify(extra) : ""));
  if (!cond) fails.push(name);
}
function mkRec(id, note, ts) {
  return { id, type: "expense", amount: 1234, catId: "seed-1", catName: "餐饮", catIcon: "🍜",
           date: "2026-11-25", note, updatedAt: ts, deleted: false };
}

(async () => {
  const seedCats = [{ id: "seed-1", name: "餐饮", type: "expense", icon: "🍜", updatedAt: 1, deleted: false }];
  const t0 = Date.now();

  // 设备 A：首次同步 → 应创建 Gist
  const A = { records: [mkRec("A-r1", "A设备记的", t0)], categories: seedCats };
  const rA = await JZ.syncNow({ token, gistId: "" }, A);
  check("A 创建云端账本", !!rA.created && !!rA.gistId, { gistId: rA.gistId });
  const gistId = rA.gistId;

  // 设备 B：用同一 token（无 gistId）→ 应自动找到同一个账本并拿到 A 的记录
  const B = { records: [mkRec("B-r1", "B设备记的", t0 + 1000)], categories: seedCats };
  const rB = await JZ.syncNow({ token, gistId: "" }, B);
  check("B 自动发现同一账本", rB.gistId === gistId);
  check("B 拿到 A 的记录", rB.records.some((r) => r.id === "A-r1"), rB.records.map((r) => r.id));
  check("B 保留自己的记录", rB.records.some((r) => r.id === "B-r1"));

  // 设备 A 再同步 → 应拿到 B 的记录
  const rA2 = await JZ.syncNow({ token, gistId }, { records: rA.records, categories: seedCats });
  check("A 拿到 B 的记录", rA2.records.some((r) => r.id === "B-r1"), rA2.records.map((r) => r.id));

  // A 删除 B-r1（tombstone），同步后 B 也应看不到
  const aRecs = rA2.records.map((r) => (r.id === "B-r1" ? Object.assign({}, r, { deleted: true, updatedAt: Date.now() }) : r));
  const rA3 = await JZ.syncNow({ token, gistId }, { records: aRecs, categories: seedCats });
  check("A 端删除生效", rA3.records.find((r) => r.id === "B-r1").deleted === true);
  const rB2 = await JZ.syncNow({ token, gistId }, { records: rB.records, categories: seedCats });
  check("删除同步到 B", rB2.records.find((r) => r.id === "B-r1").deleted === true);

  // 编辑冲突：同一记录两台设备都改，新 updatedAt 胜出
  const editA = Object.assign({}, mkRec("A-r1", "A改的", t0 + 5000), { amount: 5000 });
  await JZ.syncNow({ token, gistId }, { records: [editA], categories: seedCats });
  const stale = Object.assign({}, mkRec("A-r1", "B用旧数据改", t0 + 1000), { amount: 9999 });
  const rC = await JZ.syncNow({ token, gistId }, { records: [stale], categories: seedCats });
  check("冲突以新时间为准", rC.records.find((r) => r.id === "A-r1").amount === 5000,
        rC.records.find((r) => r.id === "A-r1"));

  // 清理：删除测试 Gist
  const res = await fetch("https://api.github.com/gists/" + gistId, {
    method: "DELETE", headers: { Authorization: "Bearer " + token },
  });
  check("清理测试 Gist", res.status === 204, res.status);

  console.log("RESULT", fails.length ? "FAILED: " + fails.join(", ") : "OK");
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.log("ERROR", e.message); process.exit(1); });
