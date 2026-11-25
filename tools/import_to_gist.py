# -*- coding: utf-8 -*-
"""把 import_preview.json 合并写入云端账本（GitHub 私有 Gist）。
需要环境变量 GH_TOKEN（gist 权限）。与现有云端数据按 id+updatedAt 合并，不覆盖更新的数据。"""
import io
import json
import os
import sys
import urllib.error
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

TOKEN = os.environ.get("GH_TOKEN") or ""
if not TOKEN:
    print("缺少 GH_TOKEN")
    sys.exit(2)

API = "https://api.github.com"
GIST_FILE = "jizhang-ledger.json"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREVIEW = os.path.join(HERE, "import_preview.json")


def gh(path, method="GET", body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers={
        "Authorization": "Bearer " + TOKEN,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8") or "{}")


def merge_lists(local, remote):
    m = {}
    for x in local or []:
        m[x["id"]] = x
    for x in remote or []:
        cur = m.get(x["id"])
        if not cur or x.get("updatedAt", 0) > cur.get("updatedAt", 0):
            m[x["id"]] = x
    return list(m.values())


with open(PREVIEW, "r", encoding="utf-8") as f:
    payload = json.load(f)

# 找现有账本 Gist
code, gists = gh("/gists?per_page=100")
assert code == 200, (code, gists)
gist_id = None
for g in gists:
    if GIST_FILE in (g.get("files") or {}):
        gist_id = g["id"]
        break

if gist_id:
    code, g = gh("/gists/" + gist_id)
    assert code == 200, (code, g)
    try:
        remote = json.loads(g["files"][GIST_FILE]["content"])
    except (KeyError, ValueError):
        remote = {}
    merged = {
        "version": 2,
        "syncedAt": payload["syncedAt"],
        "records": merge_lists(remote.get("records"), payload["records"]),
        "categories": merge_lists(remote.get("categories"), payload["categories"]),
        "ledgers": merge_lists(remote.get("ledgers"), payload["ledgers"]),
    }
    code, res = gh("/gists/" + gist_id, "PATCH", {"files": {GIST_FILE: {"content": json.dumps(merged, ensure_ascii=False)}}})
    action = "合并写入已有云端账本"
else:
    merged = payload
    code, res = gh("/gists", "POST", {
        "description": "记账本账本（App 自动同步，请勿手动编辑）",
        "public": False,
        "files": {GIST_FILE: {"content": json.dumps(merged, ensure_ascii=False)}},
    })
    gist_id = res.get("id")
    action = "创建云端账本"

assert code in (200, 201), (code, res)

live = gh("/gists/" + gist_id)[1]
f = live["files"][GIST_FILE]
if f.get("truncated"):
    raw = urllib.request.urlopen(f["raw_url"], timeout=60).read().decode("utf-8")
    check = json.loads(raw)
else:
    check = json.loads(f["content"])
n_exp = len([r for r in check["records"] if not r.get("deleted") and r["type"] == "expense"])
n_del = len([r for r in check["records"] if r.get("deleted")])
print("=== 导入完成 ===")
print("%s | gist id: %s" % (action, gist_id))
print("云端现有：支出记录 %d 条（另有删除标记 %d 条）| 分类 %d 个 | 账本 %d 个"
      % (n_exp, n_del, len([c for c in check["categories"] if not c.get("deleted")]),
         len([L for L in check["ledgers"] if not L.get("deleted")])))
print("手机/电脑打开 App 联网同步后即可看到全部历史账。")
