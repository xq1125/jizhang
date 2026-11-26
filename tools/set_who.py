# -*- coding: utf-8 -*-
"""云端设置同行人：日本=韩佳韵，威海青岛=妈妈、爸爸，川西=董杰琳。"""
import io
import json
import os
import sys
import time
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
TOKEN = os.environ.get("GH_TOKEN", "")
GF = "jizhang-ledger.json"
WHO = {"imp-jp": "韩佳韵", "imp-whqd": "妈妈、爸爸", "imp-cx": "董杰琳"}


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
    if L["id"] in WHO and L.get("who") != WHO[L["id"]]:
        L["who"] = WHO[L["id"]]
        L["updatedAt"] = now
        n += 1
        print("设置 %s -> %s" % (L["name"], WHO[L["id"]]))
print("共更新:", n)
if n:
    data["syncedAt"] = now + 1
    req("PATCH", "/gists/" + g["id"], {"files": {GF: {"content": json.dumps(data, ensure_ascii=False)}}})
    live = req("GET", "/gists/" + g["id"])["files"][GF]
    t2 = live.get("content")
    if t2 is None or live.get("truncated"):
        t2 = urllib.request.urlopen(live["raw_url"], timeout=60).read().decode()
    chk = json.loads(t2)
    for L in chk["ledgers"]:
        if L.get("who"):
            print("云端确认: %s 👥 %s" % (L["name"], L["who"]))
