# -*- coding: utf-8 -*-
"""咸宁：小账本转标签进主账本 + 删除主账本商品级双记，主账本按天显示小账本总和，差额自动补上。"""
import io
import json
import os
import sys
import time
import urllib.request
from collections import defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
TOKEN = os.environ.get("GH_TOKEN", "")
GF = "jizhang-ledger.json"


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request("https://api.github.com" + path, data=data, method=method, headers={
        "Authorization": "Bearer " + TOKEN,
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.loads(resp.read().decode() or "null")


g = next(x for x in req("GET", "/gists?per_page=100") if GF in (x.get("files") or {}))
f = req("GET", "/gists/" + g["id"])["files"][GF]
txt = f.get("content")
if txt is None or f.get("truncated"):
    txt = urllib.request.urlopen(f["raw_url"], timeout=60).read().decode()
data = json.loads(txt)
now = int(time.time() * 1000)

# 1) 小账本记录集合（转标签前记录 日期->金额列表）
xn = [r for r in data["records"] if not r.get("deleted") and r.get("ledgerId") == "imp-xn"]
sub_amts = defaultdict(list)
for r in xn:
    sub_amts[r["date"]].append(r["amount"])
print("咸宁小账本: %d 条" % len(xn))

# 2) 主账本同日同额的双记（无 tripId 的手工记录）→ 删除
removed = []
for r in data["records"]:
    if r.get("deleted") or r.get("tripId") or r.get("mirror"):
        continue
    if (r.get("ledgerId") or "main") != "main" or r["type"] != "expense":
        continue
    pool = sub_amts.get(r["date"])
    if pool and r["amount"] in pool:
        pool.remove(r["amount"])  # 一对一消耗，防止多删
        r["deleted"] = True
        r["updatedAt"] = now
        removed.append(r)
print("删除主账本双记: %d 条" % len(removed))
for r in removed:
    print("  - %s %s ¥%.2f (%s)" % (r["date"], r["catName"], r["amount"] / 100, r.get("note") or "-"))

# 3) 小账本记录转标签进主账本
for r in xn:
    r["ledgerId"] = "main"
    r["tripId"] = "imp-xn"
    r["updatedAt"] = now

data["syncedAt"] = now + 1
req("PATCH", "/gists/" + g["id"], {"files": {GF: {"content": json.dumps(data, ensure_ascii=False)}}})

# 4) 验证：主账本每天连到咸宁的合计 == 小账本原当天合计
live = req("GET", "/gists/" + g["id"])["files"][GF]
t2 = live.get("content")
if t2 is None or live.get("truncated"):
    t2 = urllib.request.urlopen(live["raw_url"], timeout=60).read().decode()
chk = json.loads(t2)
orig = defaultdict(int)
for r in chk["records"]:
    if r.get("tripId") == "imp-xn" and not r.get("deleted"):
        orig[r["date"]] += r["amount"]
print("云端确认 主账本咸宁合并行:")
tot = 0
for d, c in sorted(orig.items()):
    print("  %s  ¥%.2f" % (d, c / 100))
    tot += c
print("合计 ¥%.2f（原小账本总和 475.70）" % (tot / 100))
