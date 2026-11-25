# -*- coding: utf-8 -*-
"""喵喵记账 CSV 分析（只读，不导入）：统计账本、分类、金额分布。"""
import csv
import glob
import io
import sys
from collections import defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

FILES = sorted(glob.glob(r"C:\Users\zhengkaiyu01\Downloads\喵喵记账*.csv"))

def read_rows(path):
    for enc in ("utf-8-sig", "utf-8", "gbk"):
        try:
            with open(path, "r", encoding=enc, newline="") as f:
                rows = list(csv.reader(f))
            if rows and "分类" in rows[0][0]:
                return rows
        except (UnicodeDecodeError, IndexError):
            continue
    raise RuntimeError("无法解析: " + path)

ledger_stat = defaultdict(lambda: {"n": 0, "exp": 0.0, "inc": 0.0, "min": "9999", "max": "0000"})
cat_stat = defaultdict(lambda: {"n": 0, "exp": 0.0, "inc": 0.0})
cat_in_ledger = defaultdict(lambda: defaultdict(int))
bad_rows = []
total_rows = 0

for path in FILES:
    rows = read_rows(path)
    n = 0
    for r in rows[1:]:
        if len(r) < 7:
            bad_rows.append((path.split("\\")[-1], r))
            continue
        cat, t, amt, _acct, ledger, _cur, _note = (x.strip() for x in r[:7])
        try:
            amt = float(amt)
        except ValueError:
            bad_rows.append((path.split("\\")[-1], r))
            continue
        date = t[:10]
        ledger = ledger or "默认账本"
        cat = cat or "未分类"
        L = ledger_stat[ledger]
        L["n"] += 1
        L["min"] = min(L["min"], date)
        L["max"] = max(L["max"], date)
        C = cat_stat[cat]
        C["n"] += 1
        if amt < 0:
            L["exp"] += -amt
            C["exp"] += -amt
        else:
            L["inc"] += amt
            C["inc"] += amt
        cat_in_ledger[ledger][cat] += 1
        n += 1
    total_rows += n
    print("文件 %s : %d 条" % (path.split("\\")[-1], n))

print()
print("=== 账本（共 %d 个，%d 条有效记录）===" % (len(ledger_stat), total_rows))
for name, s in sorted(ledger_stat.items(), key=lambda kv: -kv[1]["n"]):
    print("%-22s %5d 条  支出 %10.2f  收入 %9.2f  %s ~ %s"
          % (name, s["n"], s["exp"], s["inc"], s["min"], s["max"]))

print()
print("=== 分类（共 %d 个）===" % len(cat_stat))
for name, s in sorted(cat_stat.items(), key=lambda kv: -kv[1]["exp"]):
    print("%-14s %5d 条  支出 %10.2f  收入 %9.2f" % (name, s["n"], s["exp"], s["inc"]))

print()
print("=== 每个账本里的分类分布 ===")
for name in sorted(ledger_stat, key=lambda k: -ledger_stat[k]["n"]):
    cats = sorted(cat_in_ledger[name].items(), key=lambda kv: -kv[1])
    print("【%s】%s" % (name, "、".join("%s×%d" % (c, n) for c, n in cats[:12])))

if bad_rows:
    print()
    print("=== 解析失败的行 %d 条（示例前5）===" % len(bad_rows))
    for p, r in bad_rows[:5]:
        print(p, r)
