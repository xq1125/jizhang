# -*- coding: utf-8 -*-
"""景德镇转标签模式：记录移入主账本+tripId=imp-jd，主账本按天显示合并跳转行。"""
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

n = 0
days = defaultdict(lambda: [0, 0])
for r in data["records"]:
    if r.get("deleted") or r.get("ledgerId") != "imp-jd":
        continue
    r["ledgerId"] = "main"
    r["tripId"] = "imp-jd"
    r["updatedAt"] = now
    n += 1
    days[r["date"]][0] += 1
    days[r["date"]][1] += r["amount"]

print("转入主账本并打标签: %d 条" % n)
for d, (c, amt) in sorted(days.items()):
    print("  %s  %d笔  ¥%.2f  → 主账本将显示合并行" % (d, c, amt / 100))

data["syncedAt"] = now + 1
req("PATCH", "/gists/" + g["id"], {"files": {GF: {"content": json.dumps(data, ensure_ascii=False)}}})

live = req("GET", "/gists/" + g["id"])["files"][GF]
t2 = live.get("content")
if t2 is None or live.get("truncated"):
    t2 = urllib.request.urlopen(live["raw_url"], timeout=60).read().decode()
chk = json.loads(t2)
tagged = [r for r in chk["records"] if not r.get("deleted") and r.get("tripId") == "imp-jd"]
total = sum(r["amount"] for r in tagged if r["type"] == "expense") / 100
print("云端确认: 景德镇标签记录 %d 条，合计 ¥%.2f（应=38/1149.99）" % (len(tagged), total))
