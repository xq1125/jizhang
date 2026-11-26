# -*- coding: utf-8 -*-
"""云端迁移：写入 6 个预置同伴 + 给旅游账本设置 whoIds（替换旧 who 字符串）。"""
import io
import json
import os
import sys
import time
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
TOKEN = os.environ.get("GH_TOKEN", "")
GF = "jizhang-ledger.json"

PEOPLE = [
    {"id": "p-1", "name": "韩佳韵", "avatar": "🌸"},
    {"id": "p-2", "name": "董杰琳", "avatar": "🍀"},
    {"id": "p-3", "name": "gyff", "avatar": "✨"},
    {"id": "p-4", "name": "ycx", "avatar": "🎈"},
    {"id": "p-5", "name": "爸爸", "avatar": "🐻"},
    {"id": "p-6", "name": "妈妈", "avatar": "🌷"},
]
WHOIDS = {
    "imp-jp": ["p-1"],
    "imp-whqd": ["p-6", "p-5"],
    "imp-cx": ["p-2"],
    "imp-ly": ["p-1"],
    "imp-cs": ["p-4"],
    "imp-jd": ["p-4", "p-3"],
    "imp-xn": ["p-1", "p-2"],
}


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

people = data.get("people") or []
have = {p["id"] for p in people}
added = 0
for p in PEOPLE:
    if p["id"] not in have:
        q = dict(p)
        q["updatedAt"] = now
        q["deleted"] = False
        people.append(q)
        added += 1
data["people"] = people

n = 0
for L in data["ledgers"]:
    if L["id"] in WHOIDS:
        L["whoIds"] = WHOIDS[L["id"]]
        L.pop("who", None)
        L["updatedAt"] = now
        n += 1

print("新增同伴: %d | 设置whoIds账本: %d" % (added, n))
data["syncedAt"] = now + 1
req("PATCH", "/gists/" + g["id"], {"files": {GF: {"content": json.dumps(data, ensure_ascii=False)}}})

live = req("GET", "/gists/" + g["id"])["files"][GF]
t2 = live.get("content")
if t2 is None or live.get("truncated"):
    t2 = urllib.request.urlopen(live["raw_url"], timeout=60).read().decode()
chk = json.loads(t2)
print("云端同伴:", "、".join("%s%s" % (p["avatar"], p["name"]) for p in chk.get("people", []) if not p.get("deleted")))
for L in chk["ledgers"]:
    if L.get("whoIds"):
        names = "、".join(p["name"] for p in chk.get("people", []) if p["id"] in L["whoIds"])
        print("  %s 👥 %s" % (L["name"], names))
