# -*- coding: utf-8 -*-
"""双记对照表（只读）：主账本已连记录 vs 小账本当天细账，按账本分组列出。"""
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
sub_items = defaultdict(list)
sub_total = defaultdict(int)
for r in recs:
    lid = r.get("ledgerId") or "main"
    if lid != "main" and r["type"] == "expense":
        sub_items[(lid, r["date"])].append(r)
        sub_total[(lid, r["date"])] += r["amount"]

totals = {}
amts = defaultdict(set)
for (lid, d), lst in sub_items.items():
    totals[(lid, d)] = sub_total[(lid, d)]
    for r in lst:
        amts[(lid, d)].add(r["amount"])

def link_of(m):
    if m.get("tripId"):
        return m["tripId"], "标签"
    if m.get("linkLid"):
        return m["linkLid"], "手动"
    d = m["date"]
    for (lid, dd), t in totals.items():
        if dd == d and t == m["amount"]:
            return lid, "合计"
    for (lid, dd), s in amts.items():
        if dd == d and m["amount"] in s:
            return lid, "同额"
    return None, None

by_ledger = defaultdict(list)
for r in recs:
    if (r.get("ledgerId") or "main") != "main" or r["type"] != "expense":
        continue
    lid, how = link_of(r)
    if lid:
        by_ledger[lid].append((r["date"], r, how))

for lid, rows in sorted(by_ledger.items(), key=lambda kv: -len(kv[1])):
    days = defaultdict(list)
    for d, r, how in rows:
        days[d].append((r, how))
    print()
    print("=== %s（%d 天，主账本已连 %d 条）" % (Lname[lid], len(days), len(rows)))
    for d in sorted(days, reverse=True):
        st = sub_total.get((lid, d), 0)
        mt = sum(r["amount"] for r, _ in days[d])
        flag = "✓平" if mt == st else ("差%.2f" % ((st - mt) / 100))
        print("  %s  主账本¥%.2f vs 小账本¥%.2f %s" % (d, mt / 100, st / 100, flag))
        for r, how in sorted(days[d], key=lambda x: -x[0]["amount"]):
            print("      [%s] %s ¥%.2f %s" % (how, r["catName"], r["amount"] / 100, r.get("note") or "-"))
