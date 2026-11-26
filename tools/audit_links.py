# -*- coding: utf-8 -*-
"""审计金额匹配链接：找出可疑的巧合同额、以及会被合并成总和行的分组。"""
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
KEYWORDS = {"imp-jp": ["日本"], "imp-cx": ["川西"], "imp-whqd": ["青岛", "威海"], "imp-cs": ["长沙"],
            "imp-xn": ["咸宁"], "imp-ly": ["洛阳"], "imp-jd": ["景德镇"], "imp-bday": ["生日"],
            "imp-xq66": ["星邱6.6", "星邱线下6.6"], "imp-xq1121": ["星邱11.21", "星邱线下11.21"]}

day = defaultdict(lambda: {"total": 0, "amts": defaultdict(int)})
for r in data["records"]:
    if r.get("deleted") or r.get("mirror"):
        continue
    lid = r.get("ledgerId") or "main"
    if lid == "main" or r["type"] != "expense":
        continue
    k = (lid, r["date"])
    day[k]["total"] += r["amount"]
    day[k]["amts"][r["amount"]] += 1

groups = defaultdict(list)  # (lid, date) -> [(main rec, match type)]
for r in data["records"]:
    if r.get("deleted") or r.get("mirror") or r["type"] != "expense":
        continue
    if (r.get("ledgerId") or "main") != "main":
        continue
    if r.get("tripId"):
        groups[(r["tripId"], r["date"])].append((r, "标签"))
        continue
    hit = None
    for (lid, d), v in day.items():
        if d != r["date"]:
            continue
        if v["total"] == r["amount"]:
            hit = (lid, "合计")
            break
    if not hit:
        for (lid, d), v in day.items():
            if d != r["date"] or r["amount"] not in v["amts"]:
                continue
            note = r.get("note") or ""
            note_hit = any(k in note for k in KEYWORDS.get(lid, []))
            if r["amount"] >= 5000 or note_hit:
                hit = (lid, "同额")
                break
    if hit:
        groups[(hit[0], r["date"])].append((r, hit[1]))

n_link = sum(len(v) for v in groups.values())
print("会被合并/挂链接的主账本记录: %d 条，共 %d 个总和行" % (n_link, len(groups)))

print()
print("=== 可疑：同额匹配且金额 < ¥50（大概率撞价）")
susp = 0
for (lid, d), lst in sorted(groups.items()):
    for r, t in lst:
        if t == "同额" and r["amount"] < 5000:
            susp += 1
            print("  %s %8.2f [%s] %-12s -> %s (%s)" % (d, r["amount"] / 100, r["catName"], (r.get("note") or "-")[:12], Lname[lid], t))
print("小计: %d 条" % susp)

print()
print("=== 一天多笔合并成同一行的组（检查是否合理）")
for (lid, d), lst in sorted(groups.items()):
    if len(lst) > 1:
        total = sum(r["amount"] for r, _ in lst) / 100
        items = "; ".join("[%s]%.2f(%s)" % (r["catName"], r["amount"] / 100, t) for r, t in lst)
        print("  %s -> %s 合并 ¥%.2f：%s" % (d, Lname[lid], total, items))
