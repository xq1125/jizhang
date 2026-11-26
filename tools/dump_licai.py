# -*- coding: utf-8 -*-
"""导出喵喵记账 CSV 里所有"理财"分类的原始记录，供用户审阅。"""
import csv
import glob
import io
import sys
from collections import defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

FILES = sorted(glob.glob(r"C:\Users\zhengkaiyu01\Downloads\喵喵记账*.csv"))
OUT = r"C:\Users\zhengkaiyu01\Downloads\理财流水_原始99笔.csv"


def read_rows(path):
    for enc in ("utf-8-sig", "utf-8", "gbk"):
        try:
            with open(path, "r", encoding=enc, newline="") as f:
                rows = list(csv.reader(f))
            if rows and "分类" in rows[0][0]:
                return rows
        except (UnicodeDecodeError, IndexError):
            continue
    return []


recs = []
seen = set()
for path in FILES:
    for r in read_rows(path)[1:]:
        if len(r) < 7:
            continue
        cat, t, amt, acct, ledger, cur, note = (x.strip() for x in r[:7])
        if cat != "理财":
            continue
        key = (cat, t, amt, ledger, note)
        if key in seen:
            continue
        seen.add(key)
        try:
            a = float(amt)
        except ValueError:
            continue
        recs.append((t, a, ledger, note))

recs.sort()
print("共 %d 笔" % len(recs))
pos = [r for r in recs if r[1] > 0]
neg = [r for r in recs if r[1] < 0]
print("正数(收益) %d 笔 合计 %.2f | 负数 %d 笔 合计 %.2f" % (len(pos), sum(r[1] for r in pos), len(neg), sum(r[1] for r in neg)))
by_month = defaultdict(lambda: [0, 0.0])
for t, a, l, n in recs:
    m = t[:7]
    by_month[m][0] += 1
    by_month[m][1] += a
print("按月: " + "  ".join("%s:%d笔/%.2f" % (m, v[0], v[1]) for m, v in sorted(by_month.items())))

with open(OUT, "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f)
    w.writerow(["时间", "金额", "账本", "备注"])
    for t, a, l, n in recs:
        w.writerow([t, a, l, n])
print("已导出: %s" % OUT)

print()
print("=== 全部明细 ===")
for t, a, l, n in recs:
    print("%s  %8.2f  %s  %s" % (t, a, l, n or "-"))
