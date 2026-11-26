# -*- coding: utf-8 -*-
"""对账审计：三个喵喵记账 CSV（去重后）vs 云端 Gist 账本，检查导错/导漏/导重。"""
import csv
import glob
import io
import json
import os
import random
import sys
import urllib.request
from collections import defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
TOKEN = os.environ.get("GH_TOKEN", "")
GF = "jizhang-ledger.json"

# 分类合并映射（CSV 原始分类 -> 云端分类）
MERGE = {"捐赠": "捐款", "药": "医疗", "医院": "医疗", "盲盒": "娱乐"}


def read_rows(path):
    for enc in ("utf-8-sig", "utf-8", "gbk"):
        try:
            with open(path, "r", encoding=enc, newline="") as f:
                rows = list(csv.reader(f))
            if rows and "分类" in rows[0][0]:
                return rows
        except (UnicodeDecodeError, IndexError):
            continue
    return []


csv_recs = []
seen = set()
income_skipped = 0
for p in sorted(glob.glob(r"C:\Users\zhengkaiyu01\Downloads\喵喵记账*.csv")):
    for r in read_rows(p)[1:]:
        if len(r) < 7:
            continue
        cat, t, amt, _a, ledger, cur, note = (x.strip() for x in r[:7])
        try:
            a = float(amt)
        except ValueError:
            continue
        key = (cat, t, amt, ledger, note)
        if key in seen:
            continue
        seen.add(key)
        if a >= 0:
            income_skipped += 1
            continue
        csv_recs.append({
            "cat": MERGE.get(cat, cat), "date": t[:10], "cents": round(-a * 100),
            "ledger": "main" if ledger == "默认账本" else ledger, "note": note,
        })

req = urllib.request.Request("https://api.github.com/gists?per_page=100",
                             headers={"Authorization": "Bearer " + TOKEN})
gists = json.loads(urllib.request.urlopen(req, timeout=60).read().decode())
gid = next(g["id"] for g in gists if GF in (g.get("files") or {}))
req = urllib.request.Request("https://api.github.com/gists/" + gid,
                             headers={"Authorization": "Bearer " + TOKEN})
f = json.loads(urllib.request.urlopen(req, timeout=60).read().decode())["files"][GF]
txt = f.get("content")
if txt is None or f.get("truncated"):
    txt = urllib.request.urlopen(f["raw_url"], timeout=60).read().decode()
cloud = json.loads(txt)
NAME2ID = {x["name"]: x["id"] for x in cloud["ledgers"]}
for r in csv_recs:
    if r["ledger"] != "main":
        r["ledger"] = NAME2ID.get(r["ledger"], r["ledger"])
cl = [r for r in cloud["records"] if not r.get("deleted")]
for r in cl:
    r["_ledger"] = r.get("ledgerId") or "main"

print("=== 总量核对")
print("CSV 有效支出记录（去重后）: %d" % len(csv_recs))
print("CSV 跳过收入记录:          %d" % income_skipped)
print("云端活跃记录:              %d" % len(cl))
print("总数一致: %s" % (len(csv_recs) == len(cl)))
print("云端金额合计: %.2f" % (sum(r["amount"] for r in cl) / 100))
print("CSV 金额合计:  %.2f" % (sum(r["cents"] for r in csv_recs) / 100))

print()
print("=== 分账本核对（笔数 | CSV金额 vs 云端金额）")
cs = defaultdict(lambda: [0, 0])
clx = defaultdict(lambda: [0, 0])
for r in csv_recs:
    cs[r["ledger"]][0] += 1
    cs[r["ledger"]][1] += r["cents"]
for r in cl:
    clx[r["_ledger"]][0] += 1
    clx[r["_ledger"]][1] += r["amount"]
ok = True
for k in sorted(set(cs) | set(clx)):
    a, b = cs.get(k, [0, 0]), clx.get(k, [0, 0])
    same = a[0] == b[0] and a[1] == b[1]
    ok = ok and same
    print("%s %-10s %4d笔 %12.2f | %4d笔 %12.2f" % ("✓" if same else "✗", k, a[0], a[1] / 100, b[0], b[1] / 100))

print()
print("=== 分分类核对（含合并映射）")
cc = defaultdict(lambda: [0, 0])
clc = defaultdict(lambda: [0, 0])
for r in csv_recs:
    cc[r["cat"]][0] += 1
    cc[r["cat"]][1] += r["cents"]
for r in cl:
    clc[r["catName"]][0] += 1
    clc[r["catName"]][1] += r["amount"]
for k in sorted(set(cc) | set(clc), key=lambda x: -clc.get(x, [0, 0])[1]):
    a, b = cc.get(k, [0, 0]), clc.get(k, [0, 0])
    same = a[0] == b[0] and a[1] == b[1]
    ok = ok and same
    print("%s %-6s %4d笔 %12.2f | %4d笔 %12.2f" % ("✓" if same else "✗", k, a[0], a[1] / 100, b[0], b[1] / 100))

print()
print("=== 逐条匹配（全量，按 日期+金额+分类+账本+备注 五元组）")
csv_keys = defaultdict(int)
for r in csv_recs:
    csv_keys[(r["date"], r["cents"], r["cat"], r["ledger"], r["note"])] += 1
cl_keys = defaultdict(int)
for r in cl:
    cl_keys[(r["date"], r["amount"], r["catName"], r["_ledger"], r.get("note", ""))] += 1
miss = sum(max(csv_keys[k] - cl_keys.get(k, 0), 0) for k in csv_keys)
extra = sum(max(cl_keys[k] - csv_keys.get(k, 0), 0) for k in cl_keys)
print("CSV 有而云端缺（导漏）: %d 条" % miss)
print("云端有而 CSV 没有（导错/多导）: %d 条" % extra)
if miss:
    shown = 0
    for k, v in csv_keys.items():
        d = v - cl_keys.get(k, 0)
        if d > 0 and shown < 10:
            print("   缺: %s" % (k,))
            shown += 1
if extra:
    shown = 0
    for k, v in cl_keys.items():
        d = v - csv_keys.get(k, 0)
        if d > 0 and shown < 10:
            print("   多: %s" % (k,))
            shown += 1

print()
print("=== 云端重复检测（同五元组出现>1 且 CSV 也确有>1 才对）")
dup_suspect = 0
for k, v in cl_keys.items():
    if v > csv_keys.get(k, 0):
        dup_suspect += 1
print("可疑重复: %d 组" % dup_suspect)

print()
print("=== 游戏虚拟账本核对")
g_csv = [r for r in csv_recs if r["cat"] == "游戏"]
g_cl = [r for r in cl if r["catName"] == "游戏"]
print("CSV 游戏: %d 笔 %.2f | 云端: %d 笔 %.2f | 一致: %s"
      % (len(g_csv), sum(r["cents"] for r in g_csv) / 100,
         len(g_cl), sum(r["amount"] for r in g_cl) / 100,
         len(g_csv) == len(g_cl) and sum(r["cents"] for r in g_csv) == sum(r["amount"] for r in g_cl)))

print()
print("=== 结论: %s" % ("全部一致，无导错导漏" if (ok and not miss and not extra and not dup_suspect) else "存在差异，见上方 ✗/缺/多 标记"))
