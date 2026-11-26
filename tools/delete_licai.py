# -*- coding: utf-8 -*-
"""云端删除 99 笔余额宝自动收益（理财分类），保留分类本身。"""
import io
import json
import os
import sys
import time
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

TOKEN = os.environ.get("GH_TOKEN", "")
API = "https://api.github.com"
GIST_FILE = "jizhang-ledger.json"


def req(method, path, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method, headers={
        "Authorization": "Bearer " + TOKEN,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8") or "null")


gists = req("GET", "/gists?per_page=100")
gid = next((g["id"] for g in gists if GIST_FILE in (g.get("files") or {})), None)
if not gid:
    print("未找到账本 gist")
    sys.exit(1)

f = req("GET", "/gists/" + gid)["files"][GIST_FILE]
txt = f.get("content")
if txt is None or f.get("truncated"):
    txt = urllib.request.urlopen(f["raw_url"], timeout=60).read().decode("utf-8")
data = json.loads(txt)
now = int(time.time() * 1000)

n = 0
for r in data["records"]:
    if r.get("catId") == "imp-cat-理财" and not r.get("deleted"):
        r["deleted"] = True
        r["updatedAt"] = now
        n += 1
print("标记删除理财记录: %d 笔" % n)

data["syncedAt"] = now + 1
req("PATCH", "/gists/" + gid, {"files": {GIST_FILE: {"content": json.dumps(data, ensure_ascii=False)}}})

live = req("GET", "/gists/" + gid)["files"][GIST_FILE]
txt2 = live.get("content")
if txt2 is None or live.get("truncated"):
    txt2 = urllib.request.urlopen(live["raw_url"], timeout=60).read().decode("utf-8")
check = json.loads(txt2)
alive = [r for r in check["records"] if not r.get("deleted")]
licai_alive = [r for r in alive if r.get("catId") == "imp-cat-理财"]
inc = sum(r["amount"] for r in alive if r["type"] == "income") / 100
print("复查：活跃记录 %d 条（应 4119）| 理财残留 %d 笔（应 0）| 收入合计 ¥%.2f" % (len(alive), len(licai_alive), inc))
