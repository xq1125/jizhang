# -*- coding: utf-8 -*-
"""修复 2024生日 与主账本的连接：主账本 04-29 的 ¥1.00 礼品记录改为生日当天总额。"""
import io
import json
import os
import sys
import time
import urllib.request
from collections import defaultdict

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

bd = [r for r in data["records"] if not r.get("deleted") and (r.get("ledgerId") or "main") == "imp-bday"]
by_day = defaultdict(int)
for r in bd:
    if r["type"] == "expense":
        by_day[r["date"]] += r["amount"]
print("生日账本 %d 条，按天合计:" % len(bd))
for d, c in sorted(by_day.items()):
    print("  %s  ¥%.2f" % (d, c / 100))

for d, total in sorted(by_day.items()):
    # 主账本该天已有等于总额的记录？
    exist = [r for r in data["records"] if not r.get("deleted") and not r.get("mirror")
             and (r.get("ledgerId") or "main") == "main" and r["date"] == d
             and r["type"] == "expense" and r["amount"] == total]
    if exist:
        print("%s 主账本已有总额记录，跳过" % d)
        continue
    # 找该天的 ¥1.00 礼品记录（撞价那条）替换之
    cand = [r for r in data["records"] if not r.get("deleted")
            and (r.get("ledgerId") or "main") == "main" and r["date"] == d
            and r["amount"] == 100 and r["catName"] == "礼品"]
    if cand:
        r = cand[0]
        r["amount"] = total
        r["note"] = "2024生日"
        r["updatedAt"] = now
        print("%s 已将 ¥1.00 礼品(%s) 替换为生日总额 ¥%.2f" % (d, r["id"], total / 100))
    else:
        gift = next((c for c in data["categories"] if not c.get("deleted")
                     and c["name"] == "礼品" and c["type"] == "expense"), None)
        rec = {"id": "fix-bday-" + d, "ledgerId": "main", "type": "expense", "amount": total,
               "catId": gift["id"] if gift else "imp-cat-礼品",
               "catName": gift["name"] if gift else "礼品",
               "catIcon": gift.get("icon", "🎁") if gift else "🎁",
               "date": d, "note": "2024生日", "updatedAt": now, "deleted": False}
        data["records"].append(rec)
        print("%s 主账本新增生日总额记录 ¥%.2f" % (d, total / 100))

data["syncedAt"] = now + 1
req("PATCH", "/gists/" + g["id"], {"files": {GF: {"content": json.dumps(data, ensure_ascii=False)}}})

live = req("GET", "/gists/" + g["id"])["files"][GF]
t2 = live.get("content")
if t2 is None or live.get("truncated"):
    t2 = urllib.request.urlopen(live["raw_url"], timeout=60).read().decode()
chk = json.loads(t2)
for d, total in sorted(by_day.items()):
    rows = [r for r in chk["records"] if not r.get("deleted")
            and (r.get("ledgerId") or "main") == "main" and r["date"] == d and r["amount"] == total]
    print("云端确认 %s: 主账本总额记录 %d 条 (¥%.2f)" % (d, len(rows), total / 100))
