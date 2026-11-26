# -*- coding: utf-8 -*-
"""分类体检报告：逐分类统计 + 疑似错记 + 合并/细分建议素材。只读 CSV。"""
import csv
import glob
import io
import sys
from collections import defaultdict
from datetime import datetime

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
    return []


recs = []
seen = set()
for path in FILES:
    for r in read_rows(path)[1:]:
        if len(r) < 7:
            continue
        cat, t, amt, _acct, ledger, cur, note = (x.strip() for x in r[:7])
        try:
            a = float(amt)
            dt = datetime.strptime(t, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
        key = (cat, t, amt, ledger, note)
        if key in seen:
            continue
        seen.add(key)
        recs.append({"cat": cat or "未分类", "t": t, "dt": dt, "amt": a,
                     "ledger": ledger or "默认账本", "note": note})

print("总记录: %d" % len(recs))

# ---------- 1. 分类总表 ----------
stat = defaultdict(lambda: {"n": 0, "exp": 0.0, "inc": 0.0, "max": 0.0, "maxnote": "",
                            "min": 1e18, "dates": [], "amts": [], "ledgers": defaultdict(int)})
for r in recs:
    s = stat[r["cat"]]
    s["n"] += 1
    if r["amt"] < 0:
        s["exp"] += -r["amt"]
    else:
        s["inc"] += r["amt"]
    v = abs(r["amt"])
    if v > s["max"]:
        s["max"], s["maxnote"] = v, r["note"]
    if v < s["min"]:
        s["min"] = v
    s["amts"].append(v)
    s["dates"].append(r["dt"].strftime("%Y-%m-%d"))
    s["ledgers"][r["ledger"]] += 1

print()
print("=== 分类总表（按支出降序）===")
print("%-6s %5s %10s %8s %8s %9s  %s" % ("分类", "笔数", "支出合计", "平均", "最大单笔", "时间跨度", "主要账本"))
for cat, s in sorted(stat.items(), key=lambda kv: -kv[1]["exp"]):
    avg = s["exp"] / max(1, s["n"])
    span = "%s~%s" % (min(s["dates"])[:7], max(s["dates"])[:7])
    led = "、".join("%s×%d" % (k, v) for k, v in sorted(s["ledgers"].items(), key=lambda kv: -kv[1])[:2])
    print("%-6s %5d %10.0f %8.1f %9.0f  %-16s %s" % (cat, s["n"], s["exp"], avg, s["max"], span, led))

# ---------- 2. 疑似重复：同分类同金额同备注，10 分钟内 ----------
print()
print("=== 疑似重复记账（同分类+同金额+同备注，10分钟内）===")
groups = defaultdict(list)
for r in recs:
    if r["amt"] < 0:
        groups[(r["cat"], r["amt"], r["note"], r["t"][:10])].append(r)
dupcnt = 0
for k, g in sorted(groups.items()):
    if len(g) < 2:
        continue
    g.sort(key=lambda x: x["dt"])
    for i in range(1, len(g)):
        if (g[i]["dt"] - g[i - 1]["dt"]).total_seconds() <= 600:
            dupcnt += 1
            print("  %s %s %.2f x%d  备注:%s  账本:%s" % (k[0], k[3], k[1], len(g), k[2] or "-", g[0]["ledger"]))
            break
print("  共 %d 组" % dupcnt)

# ---------- 3. 金额离群：> 该分类中位数 x15 且 > 500 ----------
print()
print("=== 金额离群（远超本分类日常水平）===")
import statistics
for cat, s in sorted(stat.items(), key=lambda kv: -kv[1]["exp"]):
    if s["n"] < 8:
        continue
    med = statistics.median(s["amts"])
    if med <= 0:
        continue
    outs = [r for r in recs if r["cat"] == cat and abs(r["amt"]) > max(500, med * 15)]
    for o in sorted(outs, key=lambda x: -abs(x["amt"]))[:3]:
        print("  %s %.2f（中位数 %.1f）%s  备注:%s" % (cat, o["amt"], med, o["t"][:10], o["note"] or "-"))

# ---------- 4. 备注与分类不匹配 ----------
RULES = [
    (("礼物", "礼盒", "生日礼物"), ("礼品", "人情", "谷子", "周边")),
    (("高铁", "机票", "地铁", "打车", "大巴", "火车", "动车", "加油", "停车", "公交", "船票"), ("交通",)),
    (("外卖", "面", "饭", "餐", "咖啡", "麦当劳", "肯德基", "火锅"), ("干饭", "零食", "奶茶")),
    (("药", "医院", "挂号", "门诊"), ("药", "医院")),
]
print()
print("=== 备注关键词与分类不符（疑似记错）===")
bad = 0
for r in recs:
    if not r["note"]:
        continue
    for kws, expects in RULES:
        if any(k in r["note"] for k in kws) and r["cat"] not in expects:
            bad += 1
            if bad <= 25:
                print("  [%s] %.2f %s 备注:%s  -> 更像 %s" % (r["cat"], r["amt"], r["t"][:10], r["note"], "/".join(expects)))
print("  共 %d 条" % bad)

# ---------- 5. 收入记成支出 ----------
print()
print("=== 疑似收入记成支出（负金额但备注像收入）===")
INC_KW = ("退", "报销", "工资", "返", "收款", "卖出", "中奖", "红包")
n = 0
for r in recs:
    if r["amt"] < 0 and any(k in r["note"] for k in INC_KW):
        n += 1
        if n <= 15:
            print("  [%s] %.2f %s 备注:%s" % (r["cat"], r["amt"], r["t"][:10], r["note"]))
print("  共 %d 条" % n)

# ---------- 6. 理财流水 ----------
licai = [r for r in recs if r["cat"] == "理财"]
print()
print("=== 理财 %d 条，金额合计 %.2f（疑似转入转出流水）===" % (len(licai), sum(r["amt"] for r in licai)))

# ---------- 7. 游戏/交通/学习 备注词频（细分素材）----------
for cat in ("游戏", "交通", "学习", "线下", "谷子"):
    notes = defaultdict(float)
    for r in recs:
        if r["cat"] == cat and r["amt"] < 0:
            key = r["note"][:6] if r["note"] else "(无备注)"
            notes[key] += -r["amt"]
    top = sorted(notes.items(), key=lambda kv: -kv[1])[:8]
    print()
    print("=== %s 备注TOP（细分素材）===" % cat)
    for k, v in top:
        print("  %-10s %10.0f" % (k, v))
