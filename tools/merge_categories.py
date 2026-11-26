# -*- coding: utf-8 -*-
"""云端分类合并：捐款+捐赠→捐款；药+医院→医疗（新建）。
直接改 GitHub 私有 Gist 账本，设备端下次同步自动生效。"""
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


print("=== 找账本 gist")
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

# 合并计划：目标分类 -> 被并入的分类
PLAN = [
    {"target": {"id": "imp-cat-捐款", "name": "捐款", "icon": "❤️"}, "sources": ["捐赠"]},
    {"target": {"id": "imp-cat-医疗", "name": "医疗", "icon": "🏥", "create": True},
     "sources": ["药", "医院"]},
    {"target": {"id": "imp-cat-娱乐", "name": "娱乐", "icon": "🎪"}, "sources": ["盲盒"]},
]

cats = {c["id"]: c for c in data["categories"]}

for p in PLAN:
    t = p["target"]
    if t.get("create"):
        if t["id"] not in cats:
            newc = {"id": t["id"], "name": t["name"], "type": "expense",
                    "icon": t["icon"], "updatedAt": now, "deleted": False}
            data["categories"].append(newc)
            cats[t["id"]] = newc
            print("新建分类: %s %s" % (t["icon"], t["name"]))
    else:
        if t["id"] not in cats:
            print("!! 目标分类不存在: %s，跳过该组" % t["name"])
            continue
    for src_name in p["sources"]:
        src_id = "imp-cat-" + src_name
        if src_id not in cats:
            print("!! 源分类不存在: %s" % src_name)
            continue
        moved = 0
        for r in data["records"]:
            if r.get("catId") == src_id and not r.get("deleted"):
                r["catId"] = t["id"]
                r["catName"] = t["name"]
                r["catIcon"] = t["icon"]
                r["updatedAt"] = now
                moved += 1
        cats[src_id]["deleted"] = True
        cats[src_id]["updatedAt"] = now + 1
        print("合并 %s -> %s：迁移 %d 条记录，源分类已隐藏" % (src_name, t["name"], moved))

data["syncedAt"] = now + 2

req("PATCH", "/gists/" + gid, {"files": {GIST_FILE: {"content": json.dumps(data, ensure_ascii=False)}}})

live = req("GET", "/gists/" + gid)["files"][GIST_FILE]
txt2 = live.get("content")
if txt2 is None or live.get("truncated"):
    txt2 = urllib.request.urlopen(live["raw_url"], timeout=60).read().decode("utf-8")
check = json.loads(txt2)
alive = [c for c in check["categories"] if not c.get("deleted")]
print()
print("=== 复查")
print("活跃分类数: %d（合并前 38，应剩 36）" % len(alive))
for name in ("捐款", "医疗"):
    n = len([r for r in check["records"] if not r.get("deleted") and r.get("catName") == name])
    tot = sum(r["amount"] for r in check["records"] if not r.get("deleted") and r.get("catName") == name) / 100
    print("%s: %d 条，合计 ¥%.2f" % (name, n, tot))
for name in ("捐赠", "药", "医院"):
    n = len([r for r in check["records"] if not r.get("deleted") and r.get("catId") == "imp-cat-" + name])
    print("残留 %s 记录: %d（应为 0）" % (name, n))
