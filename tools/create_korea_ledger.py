# -*- coding: utf-8 -*-
"""新建"韩国"旅游小账本，并把主账本中韩国相关的记录归纳进去。"""
import io
import json
import os
import sys
import time
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
TOKEN = os.environ.get("GH_TOKEN", "")
GF = "jizhang-ledger.json"
KEYWORDS = ["韩国", "首尔", "釜山", "济州", "明洞", "弘大", "韩币"]


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

if any(L["id"] == "imp-kr" for L in data["ledgers"]):
    print("韩国账本已存在，跳过创建")
else:
    data["ledgers"].append({"id": "imp-kr", "name": "韩国", "icon": "🇰🇷",
                            "group": "travel", "updatedAt": now, "deleted": False})
    print("已创建账本: 🇰🇷 韩国（归入旅游）")

moved = []
for r in data["records"]:
    if r.get("deleted") or r.get("mirror"):
        continue
    if (r.get("ledgerId") or "main") != "main":
        continue
    note = r.get("note") or ""
    if any(k in note for k in KEYWORDS):
        r["ledgerId"] = "imp-kr"
        r["updatedAt"] = now
        moved.append(r)

print("归纳记录 %d 条:" % len(moved))
for r in sorted(moved, key=lambda x: x["date"]):
    print("  %s  %-4s %8.2f  %s" % (r["date"], r["catName"], r["amount"] / 100, r.get("note", "")))

if moved:
    data["syncedAt"] = now + 1
    req("PATCH", "/gists/" + g["id"], {"files": {GF: {"content": json.dumps(data, ensure_ascii=False)}}})
    live = req("GET", "/gists/" + g["id"])["files"][GF]
    t2 = live.get("content")
    if t2 is None or live.get("truncated"):
        t2 = urllib.request.urlopen(live["raw_url"], timeout=60).read().decode()
    chk = json.loads(t2)
    kr = [r for r in chk["records"] if not r.get("deleted") and r.get("ledgerId") == "imp-kr"]
    total = sum(r["amount"] for r in kr if r["type"] == "expense") / 100
    print("云端确认: 韩国账本 %d 条，总支出 ¥%.2f" % (len(kr), total))
