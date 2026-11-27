# -*- coding: utf-8 -*-
"""账本全面体检（只读）：完整性 / 连接状态 / 遗留问题 / 结构健康。"""
import io
import json
import os
import sys
import urllib.request
import csv
import glob
from collections import defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
TOKEN = os.environ.get("GH_TOKEN", "")
GF = "jizhang-ledger.json"


def req(method, path):
    r = urllib.request.Request("https://api.github.com" + path, headers={"Authorization": "Bearer " + TOKEN})
    return json.loads(urllib.request.urlopen(r, timeout=60).read().decode() or "null")


g = next(x for x in req("GET", "/gists?per_page=100") if GF in (x.get("files") or {}))
f = req("GET", "/gists/" + g["id"])["files"][GF]
txt = f.get("content")
if txt is None or f.get("truncated"):
    txt = urllib.request.urlopen(f["raw_url"], timeout=60).read().decode()
data = json.loads(txt)
recs = [r for r in data["records"] if not r.get("deleted")]
ledgers = {x["id"]: x for x in data["ledgers"] if not x.get("deleted")}
cats = {c["id"]: c for c in data["categories"] if not c.get("deleted")}
people = [p for p in data.get("people", []) if not p.get("deleted")]

print("【A 数据完整性】")
print("  活跃记录 %d 条 | 分类 %d | 账本 %d | 同伴 %d" % (len(recs), len(cats), len(ledgers), len(people)))
tot = sum(r["amount"] for r in recs if r["type"] == "expense") / 100
print("  全部支出合计 ¥%.2f" % tot)
bad_cat = [r for r in recs if r["catId"] not in cats]
print("  分类失效的记录: %d 条" % len(bad_cat))
bad_led = [r for r in recs if (r.get("ledgerId") or "main") not in ledgers]
print("  账本失效的记录: %d 条" % len(bad_led))
bad_trip = [r for r in recs if r.get("tripId") and r["tripId"] not in ledgers]
bad_link = [r for r in recs if r.get("linkLid") and r["linkLid"] not in ledgers]
print("  标签指向失效账本: %d 条 | 手动链接指向失效账本: %d 条" % (len(bad_trip), len(bad_link)))
key_cnt = defaultdict(int)
for r in recs:
    key_cnt[(r["date"], r["amount"], r.get("ledgerId") or "main", r.get("note") or "")] += 1
dups = sum(v - 1 for v in key_cnt.values() if v > 1)
print("  疑似完全重复(同日同额同账本同备注): %d 条" % dups)

print()
print("【B 连接状态】（主账本 vs 小账本逐日核对）")
sub_day = defaultdict(int)
for r in recs:
    lid = r.get("ledgerId") or "main"
    if lid != "main" and r["type"] == "expense":
        sub_day[(lid, r["date"])] += r["amount"]
for r in recs:
    if r.get("tripId") and r["type"] == "expense":
        sub_day[(r["tripId"], r["date"])] += r["amount"]
main_day = defaultdict(list)
for r in recs:
    if (r.get("ledgerId") or "main") == "main" and r["type"] == "expense":
        main_day[r["date"]].append(r)
amts = defaultdict(set)
for (lid, d), c in sub_day.items():
    pass
for r in recs:
    lid = r.get("ledgerId") or "main"
    if lid != "main" and r["type"] == "expense":
        amts[(lid, r["date"])].add(r["amount"])
    if r.get("tripId") and r["type"] == "expense":
        amts[(r["tripId"], r["date"])].add(r["amount"])

linked = defaultdict(int)
for d, mlist in main_day.items():
    for m in mlist:
        if m.get("noLink"):
            continue
        lid = m.get("tripId") or m.get("linkLid")
        if not lid:
            for (l2, d2), t in sub_day.items():
                if d2 == d and t == m["amount"]:
                    lid = l2
                    break
        if not lid:
            for (l2, d2), s in amts.items():
                if d2 == d and m["amount"] in s:
                    lid = l2
                    break
        if lid:
            linked[(lid, d)] += m["amount"]
ok = miss = part = over = 0
issues = []
for (lid, d), st in sub_day.items():
    lk = linked.get((lid, d), 0)
    if lk == st:
        ok += 1
    elif lk == 0:
        miss += 1
        issues.append("  ✗ %s %s 缺总账 ¥%.2f" % (d, ledgers[lid]["name"], st / 100))
    elif lk < st:
        part += 1
        issues.append("  △ %s %s 差 ¥%.2f（已连¥%.2f/应¥%.2f）" % (d, ledgers[lid]["name"], (st - lk) / 100, lk / 100, st / 100))
    else:
        over += 1
        issues.append("  ⚠ %s %s 多连 ¥%.2f" % (d, ledgers[lid]["name"], (lk - st) / 100))
print("  小账本共 %d 个活动日：✓平 %d | ✗缺 %d | △差额 %d | ⚠多连 %d" % (len(sub_day), ok, miss, part, over))
for s in sorted(issues):
    print(s)

print()
print("【C 遗留问题】")
tiny = [r for r in recs if r["amount"] == 1 and r["type"] == "expense"]
print("  日本现金问题记录(金额=¥0.01，真值在备注): %d 条" % len(tiny))
for r in sorted(tiny, key=lambda x: x["date"]):
    print("    %s %s ¥0.01 备注:%s" % (r["date"], ledgers.get(r.get("ledgerId") or "main", {}).get("name", "?"), r.get("note") or "-"))

print()
print("【D 结构健康】")
mir = [r for r in recs if r.get("mirror")]
print("  活动镜像记录: %d 条（应为0）" % len(mir))
seed = [c for c in cats.values() if c["id"].startswith("seed-")]
print("  复活种子分类: %d 个（应为0）" % len(seed))
grp = [x for x in ledgers.values() if x["id"].startswith("grp-")]
print("  自定义分类: %d 个" % len(grp))
for lid, x in ledgers.items():
    if lid == "main" or lid.startswith("grp-"):
        continue
    if not x.get("group"):
        print("  ! 账本 %s 未归组" % x["name"])
who_bad = []
for x in ledgers.values():
    for pid in x.get("whoIds", []):
        if not any(p["id"] == pid for p in people):
            who_bad.append((x["name"], pid))
print("  同行人引用失效: %d 处" % len(who_bad))
