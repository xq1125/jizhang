# -*- coding: utf-8 -*-
"""云端迁移：把 7 个旅游账本标记 group=travel（归入旅游虚拟账本）。"""
import io
import json
import os
import sys
import time
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
TOKEN = os.environ.get("GH_TOKEN", "")
GF = "jizhang-ledger.json"
TRAVEL_IDS = ["imp-jp", "imp-jd", "imp-whqd", "imp-cs", "imp-xn", "imp-ly", "imp-cx"]
OFFLINE_IDS = ["imp-xq66", "imp-xq1121"]
OTHERS_IDS = ["imp-bday"]


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
for L in data["ledgers"]:
    want = "travel" if L["id"] in TRAVEL_IDS else ("offline" if L["id"] in OFFLINE_IDS else ("others" if L["id"] in OTHERS_IDS else None))
    if want and L.get("group") != want:
        L["group"] = want
        L["updatedAt"] = now
        n += 1
print("标记分组账本:", n)
if n:
    data["syncedAt"] = now + 1
    req("PATCH", "/gists/" + g["id"], {"files": {GF: {"content": json.dumps(data, ensure_ascii=False)}}})
    live = req("GET", "/gists/" + g["id"])["files"][GF]
    t2 = live.get("content")
    if t2 is None or live.get("truncated"):
        t2 = urllib.request.urlopen(live["raw_url"], timeout=60).read().decode()
    chk = json.loads(t2)
    for gname, key in (("旅游", "travel"), ("线下", "offline"), ("其他", "others")):
        names = [L["name"] for L in chk["ledgers"] if L.get("group") == key and not L.get("deleted")]
        print("云端%s账本:" % gname, "、".join(names))
