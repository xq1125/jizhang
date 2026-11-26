# -*- coding: utf-8 -*-
"""云端清除所有活动汇总镜像记录与 sys-cat-huizong 分类（主账本恢复原始账目）。"""
import io
import json
import os
import sys
import time
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

TOKEN = os.environ.get("GH_TOKEN", "")
API = "https://api.github.com"
GF = "jizhang-ledger.json"


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
gid = next(g["id"] for g in gists if GF in (g.get("files") or {}))
f = req("GET", "/gists/" + gid)["files"][GF]
txt = f.get("content")
if txt is None or f.get("truncated"):
    txt = urllib.request.urlopen(f["raw_url"], timeout=60).read().decode("utf-8")
data = json.loads(txt)
now = int(time.time() * 1000)

rm = 0
for r in data["records"]:
    if (r.get("mirror") or r.get("catId") == "sys-cat-huizong") and not r.get("deleted"):
        r["deleted"] = True
        r["updatedAt"] = now
        rm += 1
cm = 0
for c in data["categories"]:
    if c.get("id") == "sys-cat-huizong" and not c.get("deleted"):
        c["deleted"] = True
        c["updatedAt"] = now
        cm += 1
print("标记删除镜像记录: %d 条 | 活动汇总分类: %d 个" % (rm, cm))

if rm or cm:
    data["syncedAt"] = now + 1
    req("PATCH", "/gists/" + gid, {"files": {GF: {"content": json.dumps(data, ensure_ascii=False)}}})

live = req("GET", "/gists/" + gid)["files"][GF]
txt2 = live.get("content")
if txt2 is None or live.get("truncated"):
    txt2 = urllib.request.urlopen(live["raw_url"], timeout=60).read().decode("utf-8")
check = json.loads(txt2)
alive = [r for r in check["records"] if not r.get("deleted")]
nov = [r for r in alive if r["date"].startswith("2026-11") and (r.get("ledgerId") or "main") == "main"]
mir = [r for r in alive if r.get("mirror")]
print("复查：活跃记录 %d | 残留镜像 %d（应0）| 2026-11 主账本合计 %.2f（应 10019.28）"
      % (len(alive), len(mir), sum(r["amount"] for r in nov) / 100))
