# -*- coding: utf-8 -*-
"""A组疑点核查（只读）：逐条对比小账本当天记录 vs 主账本当天记录，并列出各小账本缺总账的日子。"""
import io
import json
import os
import sys
import urllib.request
from collections import defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
TOKEN = os.environ.get("GH_TOKEN", "")
GF = "jizhang-ledger.json"


def req(method, path):
    r = urllib.request.Request("https://api.github.com" + path, headers={"Authorization": "Bearer " + TOKEN})
    return json.loads(urllib.request.urlopen(r, timeout=60).read().decode() or "null")


g = next(x for x in req("GET", "/gists?per_page=100") if GF in (x.get("files") or {}))
f = req("GET", "/gists/" + g["id"])["files"][GF]
txt = f.get("content")
if txt is None or f.get("truncated"):
    txt = urllib.request.urlopen(f["raw_url"], timeout=60).read().decode()
data = json.loads(txt)
Lname = {x["id"]: x["name"] for x in data["ledgers"] if not x.get("deleted")}

recs = [r for r in data["records"] if not r.get("deleted") and not r.get("mirror")]
sub = defaultdict(list)   # (lid, date) -> records
main = defaultdict(list)  # date -> main records
for r in recs:
    lid = r.get("ledgerId") or "main"
    if lid == "main":
        main[r["date"]].append(r)
    else:
        sub[(lid, r["date"])].append(r)

CASES = [
    ("A2", "imp-jd", "2024-07-09", 300, "交通/惊封"),
    ("A3", "imp-jp", "2025-06-15", 3050, "用的/一次性浴巾"),
    ("A4", "imp-ly", "2026-05-24", 1000, "一些会员/LOFTER"),
    ("A6", "imp-xn", "2025-01-23", 1300, "奶茶/古茗"),
    ("A7", "imp-xn", "2025-01-23", 2080, "用的/充电线"),
    ("A8", "imp-xn", "2025-01-24", 4600, "干饭/午饭"),
    ("A9", "imp-xq1121", "2026-10-22", 1150, "追星/星邱11.21"),
    ("A10", "imp-xq1121", "2026-10-22", 580, "追星/星邱11.21"),
    ("A11", "imp-xq1121", "2026-11-06", 2014, "追星/星邱11.21"),
]

print("=== A组逐条核查")
for tag, lid, d, amt, desc in CASES:
    sl = sub.get((lid, d), [])
    stotal = sum(r["amount"] for r in sl if r["type"] == "expense")
    same_amt = [r for r in sl if r["amount"] == amt]
    same_cat_amt = [r for r in same_amt if any(m["catName"] == r["catName"] for m in main.get(d, []) if m["amount"] == amt)]
    verdict = ("真双记(小账本同日有同额同分类)" if same_cat_amt else
               "同额不同类(可能真可能巧)" if same_amt else "纯撞价(小账本同日无此金额)")
    print("%s %s %s ¥%.2f [%s]" % (tag, d, Lname[lid], amt / 100, desc))
    print("    小账本当天: %d 笔 合计¥%.2f | 同额记录: %s" % (
        len(sl), stotal / 100,
        "; ".join("%s¥%.2f(%s)" % (r["catName"], r["amount"] / 100, r.get("note") or "-") for r in same_amt) or "无"))
    print("    判定: %s" % verdict)

print()
print("=== 各小账本：主账本缺总账的日子（当天合计在主账本找不到等额记录）")
days = defaultdict(set)
for (lid, d), lst in sub.items():
    stotal = sum(r["amount"] for r in lst if r["type"] == "expense")
    if stotal <= 0:
        continue
    has = any(m["amount"] == stotal for m in main.get(d, []))
    if not has:
        days[lid].add((d, stotal))
for lid, ds in sorted(days.items(), key=lambda kv: -len(kv[1])):
    tot = sum(c for _, c in ds) / 100
    print("  %s: %d 天缺总账（合计 ¥%.2f）" % (Lname[lid], len(ds), tot))
    for d, c in sorted(ds)[:8]:
        print("      %s ¥%.2f" % (d, c / 100))
    if len(ds) > 8:
        print("      ...共 %d 天" % len(ds))
