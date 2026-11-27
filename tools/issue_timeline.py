# -*- coding: utf-8 -*-
"""按时间线列出所有连接问题（只读）：复刻 App 链接逻辑，逐日对比小账本合计 vs 主账本已连金额。"""
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
Licon = {x["id"]: x["icon"] for x in data["ledgers"]}

recs = [r for r in data["records"] if not r.get("deleted") and not r.get("mirror")]
sub_day = defaultdict(lambda: [0, 0])   # (lid,date) -> [cents, n]
main_day = defaultdict(list)            # date -> main expense records
for r in recs:
    lid = r.get("ledgerId") or "main"
    if lid == "main":
        if r["type"] == "expense":
            main_day[r["date"]].append(r)
    elif r["type"] == "expense":
        sub_day[(lid, r["date"])][0] += r["amount"]
        sub_day[(lid, r["date"])][1] += 1

# 复刻 findLedgerLink：标签/手动优先，再合计，再同额
totals = {}
amts = defaultdict(set)
for (lid, d), (c, n) in sub_day.items():
    totals[(lid, d)] = c
    pass
for r in recs:
    lid = r.get("ledgerId") or "main"
    if lid != "main" and r["type"] == "expense":
        amts[(lid, r["date"])].add(r["amount"])

# 标签/手动链接先算上
linked = defaultdict(int)   # (lid,date) -> 主账本已连金额
linked_n = defaultdict(int)
for d, mlist in main_day.items():
    for m in mlist:
        if m.get("tripId"):
            linked[(m["tripId"], d)] += m["amount"]
            linked_n[(m["tripId"], d)] += 1
            continue
        if m.get("linkLid"):
            linked[(m["linkLid"], d)] += m["amount"]
            linked_n[(m["linkLid"], d)] += 1
            continue
        hit = None
        for (lid, dd), t in totals.items():
            if dd == d and t == m["amount"]:
                hit = lid
                break
        if not hit:
            for (lid, dd), s in amts.items():
                if dd == d and m["amount"] in s:
                    hit = lid
                    break
        if hit:
            linked[(hit, d)] += m["amount"]
            linked_n[(hit, d)] += 1

rows = []
for (lid, d), (c, n) in sub_day.items():
    lk = linked.get((lid, d), 0)
    diff = c - lk
    if diff == 0:
        status = "✓ 已覆盖"
    elif lk == 0:
        status = "✗ 完全缺总账"
    else:
        status = "△ 部分差额"
    if status != "✓ 已覆盖":
        rows.append((d, lid, n, c, lk, diff, status))
rows.sort()

print("日期        账本              细账  小账本合计    主账本已连    差额      状态")
for d, lid, n, c, lk, diff, status in rows:
    print("%s  %-6s%-8s %3d笔  %10.2f  %10.2f  %10.2f  %s" % (
        d, Licon[lid], Lname[lid], n, c / 100, lk / 100, diff / 100, status))

print()
print("共 %d 个问题日 | 差额总计 ¥%.2f" % (len(rows), sum(r[5] for r in rows) / 100))
