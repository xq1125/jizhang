# -*- coding: utf-8 -*-
"""检查备注含账本名的主账本记录：金额是否等于该账本当天合计；等则挂 linkLid（合计匹配已生效的不重复挂）。"""
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
KEYWORDS = {
    "imp-jp": ["日本"], "imp-cx": ["川西"], "imp-whqd": ["青岛", "威海"], "imp-cs": ["长沙"],
    "imp-xn": ["咸宁"], "imp-ly": ["洛阳"], "imp-jd": ["景德镇"], "imp-bday": ["生日"],
    "imp-xq66": ["星邱6.6", "星邱线下6.6"], "imp-xq1121": ["星邱11.21", "星邱线下11.21"],
    "imp-kr": ["韩国"],
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
Lname = {x["id"]: x["name"] for x in data["ledgers"] if not x.get("deleted")}

recs = [r for r in data["records"] if not r.get("deleted") and not r.get("mirror")]
sub_total = defaultdict(int)
for r in recs:
    lid = r.get("ledgerId") or "main"
    if lid != "main" and r["type"] == "expense":
        sub_total[(lid, r["date"])] += r["amount"]

print("=== 06-20 ~ 06-23 主账本当天全部记录 vs 日本小账本合计")
for d in ["2025-06-20", "2025-06-21", "2025-06-22", "2025-06-23"]:
    jp = sub_total.get(("imp-jp", d), 0)
    print("%s  日本小账本合计 ¥%.2f" % (d, jp / 100))
    for r in recs:
        if (r.get("ledgerId") or "main") == "main" and r["date"] == d and r["type"] == "expense":
            mark = "  ← 备注含日本" if "日本" in (r.get("note") or "") else ""
            print("    %s ¥%.2f %s%s" % (r["catName"], r["amount"] / 100, r.get("note") or "-", mark))

print()
print("=== 全库扫描：备注含账本名 且 金额=该账本当天合计 且 尚未挂链接 → 补 linkLid")
added = 0
for r in recs:
    if (r.get("ledgerId") or "main") != "main" or r["type"] != "expense":
        continue
    if r.get("tripId") or r.get("linkLid"):
        continue
    note = r.get("note") or ""
    for lid, kws in KEYWORDS.items():
        if not any(k in note for k in kws):
            continue
        st = sub_total.get((lid, r["date"]), 0)
        if st and st == r["amount"]:
            r["linkLid"] = lid
            r["updatedAt"] = now
            added += 1
            print("  挂: %s %s ¥%.2f (%s) -> %s" % (r["id"], r["catName"], r["amount"] / 100, note, Lname[lid]))
            break
print("新挂 linkLid: %d 条" % added)

if added:
    data["syncedAt"] = now + 1
    req("PATCH", "/gists/" + g["id"], {"files": {GF: {"content": json.dumps(data, ensure_ascii=False)}}})
    print("云端已写入")
