# -*- coding: utf-8 -*-
"""给所有小账本补 createdAt = 该账本最早记录日期（用于按时间排序，新的在上）。"""
import io
import json
import os
import sys
import time
import urllib.request
from datetime import datetime

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

for L in data["ledgers"]:
    if L["id"] == "main" or L.get("deleted"):
        continue
    if L.get("virtual"):
        dates = [r["date"] for r in data["records"]
                 if not r.get("deleted") and r.get("tripId") == L["id"]]
    else:
        dates = [r["date"] for r in data["records"]
                 if not r.get("deleted") and not r.get("mirror")
                 and ((r.get("ledgerId") or "main") == L["id"] or r.get("tripId") == L["id"])]
    if dates:
        d = min(dates)
        L["createdAt"] = int(datetime.strptime(d, "%Y-%m-%d").timestamp() * 1000)
        print("%s createdAt = %s" % (L["name"], d))

data["syncedAt"] = now + 1
req("PATCH", "/gists/" + g["id"], {"files": {GF: {"content": json.dumps(data, ensure_ascii=False)}}})
print("完成，云端已写入 createdAt")
