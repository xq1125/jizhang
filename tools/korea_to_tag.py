# -*- coding: utf-8 -*-
"""韩国账本改为标签模式：记录放回主账本，加 tripId 标签；账本标记 virtual。"""
import io
import json
import os
import sys
import time
import urllib.request

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
for r in data["records"]:
    if r.get("ledgerId") == "imp-kr" and not r.get("deleted"):
        r["ledgerId"] = "main"
        r["tripId"] = "imp-kr"
        r["updatedAt"] = now
        n += 1
for L in data["ledgers"]:
    if L["id"] == "imp-kr":
        L["virtual"] = True
        L["updatedAt"] = now
print("放回主账本并打标签:", n, "条")

data["syncedAt"] = now + 1
req("PATCH", "/gists/" + g["id"], {"files": {GF: {"content": json.dumps(data, ensure_ascii=False)}}})

live = req("GET", "/gists/" + g["id"])["files"][GF]
t2 = live.get("content")
if t2 is None or live.get("truncated"):
    t2 = urllib.request.urlopen(live["raw_url"], timeout=60).read().decode()
chk = json.loads(t2)
main_total = sum(r["amount"] for r in chk["records"] if not r.get("deleted") and not r.get("mirror")
                 and (r.get("ledgerId") or "main") == "main" and r["type"] == "expense"
                 and r["date"].startswith("2026-11")) / 100
kr = [r for r in chk["records"] if not r.get("deleted") and r.get("tripId") == "imp-kr"]
print("云端确认: 带韩国标签 %d 条 | 主账本 2026-11 支出 %.2f（应回到 10019.28+? 含韩国11月部分）" % (len(kr), main_total))
