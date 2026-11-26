# -*- coding: utf-8 -*-
"""云端账本清理：把复活的示例分类（seed-*）重新标记删除，updatedAt 用当前时间压过设备端。"""
import io
import json
import os
import sys
import time
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

TOKEN = os.environ.get("GH_TOKEN", "")
GIST_FILE = "jizhang-ledger.json"
API = "https://api.github.com"


def req(method, path, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method, headers={
        "Authorization": "Bearer " + TOKEN,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8") or "null")


print("=== 找账本 gist")
gists = req("GET", "/gists?per_page=100")
gid = None
for g in gists:
    if GIST_FILE in (g.get("files") or {}):
        gid = g["id"]
        break
if not gid:
    print("未找到账本 gist")
    sys.exit(1)
print("gist:", gid)

f = req("GET", "/gists/" + gid)["files"][GIST_FILE]
content = f.get("content")
if content is None or f.get("truncated"):
    content = urllib.request.urlopen(f["raw_url"], timeout=60).read().decode("utf-8")
data = json.loads(content)

now = int(time.time() * 1000) + 5000
changed = 0
for c in data.get("categories", []):
    if str(c.get("id", "")).startswith("seed-") and not c.get("deleted"):
        c["deleted"] = True
        c["updatedAt"] = now
        changed += 1
data["syncedAt"] = now

print("标记删除示例分类:", changed)
if changed:
    req("PATCH", "/gists/" + gid, {"files": {GIST_FILE: {"content": json.dumps(data, ensure_ascii=False)}}})
    live = req("GET", "/gists/" + gid)["files"][GIST_FILE]
    txt = live.get("content")
    if txt is None or live.get("truncated"):
        txt = urllib.request.urlopen(live["raw_url"], timeout=60).read().decode("utf-8")
    check = json.loads(txt)
    alive = [c for c in check["categories"] if not c.get("deleted")]
    seeds_alive = [c for c in alive if str(c.get("id", "")).startswith("seed-")]
    print("复查：活跃分类 %d 个，其中示例分类 %d 个（应为 0）" % (len(alive), len(seeds_alive)))
    print("记录数:", len([r for r in check["records"] if not r.get("deleted")]))
