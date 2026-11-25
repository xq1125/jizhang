# -*- coding: utf-8 -*-
"""从喵喵记账 CSV 生成导入预览 JSON（只读 CSV、只写本地预览文件，不写云端）。"""
import csv
import datetime
import glob
import io
import json
import os
import sys
from collections import defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

FILES = sorted(glob.glob(r"C:\Users\zhengkaiyu01\Downloads\喵喵记账*.csv"))
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "import_preview.json")

CAT_ICON = {
    "干饭": "🍚", "零食": "🍘", "奶茶": "🧋", "水果": "🍉", "交通": "🚌",
    "游戏": "🎮", "娱乐": "🎪", "谷子": "🎀", "周边": "💿", "礼品": "🎁",
    "追星": "⭐", "线下": "📍", "学习": "📚", "穿的": "👕", "用的": "🧴",
    "电子设备": "💻", "住房": "🏠", "药": "💊", "医院": "🏥", "化妆": "💄",
    "盲盒": "📦", "快递": "🚚", "捐款": "❤️", "捐赠": "🕊️", "比赛": "🏆",
    "现金": "💵", "彩票": "🎫", "工作": "💼", "一些会员": "👑", "景点": "🏞️",
    "红包": "🧧", "外快": "💸", "闲鱼": "🐟", "理财": "📈", "退款": "↩️",
    "记者团": "📰", "工资": "💰", "画加": "🎨",
}

LEDGER_DEF = {
    "日本": ("imp-jp", "日本", "🗾"),
    "星邱线下6.6": ("imp-xq66", "星邱线下6.6", "⭐"),
    "星邱线下11.21": ("imp-xq1121", "星邱线下11.21", "🌟"),
    "江西景德镇": ("imp-jd", "江西景德镇", "🏺"),
    "威海青岛": ("imp-whqd", "威海青岛", "🌊"),
    "长沙": ("imp-cs", "长沙", "🌶️"),
    "川西": ("imp-cx", "川西", "🏔️"),
    "2024生日": ("imp-bday", "2024生日", "🎂"),
    "咸宁": ("imp-xn", "咸宁", "♨️"),
    "洛阳": ("imp-ly", "洛阳", "🌸"),
}

SEED_IDS = ["seed-%d" % i for i in range(1, 17)]


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


seen = set()
records = []
dup = 0
bad = 0
income_skipped = 0
currencies = defaultdict(int)
cat_type = {}
cat_all = defaultdict(int)
cat_count = defaultdict(int)
ledger_count = defaultdict(int)
unknown_cats = set()

for path in FILES:
    for r in read_rows(path)[1:]:
        if len(r) < 7:
            bad += 1
            continue
        cat, t, amt, _acct, ledger, cur, note = (x.strip() for x in r[:7])
        try:
            amt_f = float(amt)
            dt = datetime.datetime.strptime(t, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            bad += 1
            continue
        key = (cat, t, amt, ledger, note)
        if key in seen:
            dup += 1
            continue
        seen.add(key)
        ledger = ledger or "默认账本"
        currencies[cur] += 1
        if cat not in CAT_ICON:
            unknown_cats.add(cat)
        typ = "expense" if amt_f < 0 else "income"
        cat_type[cat] = "expense" if cat_type.get(cat) == "expense" else typ
        cat_all[cat] += 1
        if typ == "income":
            income_skipped += 1
            continue
        cat_count[cat] += 1
        ledger_count[ledger] += 1
        lid = "main" if ledger == "默认账本" else LEDGER_DEF.get(ledger, ("imp-x", ledger, "🗂️"))[0]
        rec = {
            "id": "imp-%05d" % len(records),
            "ledgerId": lid,
            "type": typ,
            "amount": round(abs(amt_f) * 100),
            "catId": "imp-cat-" + cat,
            "catName": cat,
            "catIcon": CAT_ICON.get(cat, "📦"),
            "date": t[:10],
            "updatedAt": int(dt.timestamp() * 1000),
        }
        if note:
            rec["note"] = note[:200]
        records.append(rec)

now_ms = int(datetime.datetime.now().timestamp() * 1000)

categories = [
    {"id": "imp-cat-" + c, "name": c, "type": cat_type[c],
     "icon": CAT_ICON.get(c, "📦"), "updatedAt": now_ms, "deleted": False}
    for c in sorted(cat_all, key=lambda x: -cat_all[x])
]
# 把 App 自带的 16 个种子分类标记为已删除（同步后各设备隐藏，避免与导入分类重复）
categories += [
    {"id": sid, "name": "已合并到导入分类", "type": "expense", "icon": "",
     "updatedAt": now_ms + 1, "deleted": True} for sid in SEED_IDS
]

ledgers = [{"id": "main", "name": "主账本", "icon": "💼", "updatedAt": now_ms, "deleted": False}]
for name, (lid, disp, icon) in LEDGER_DEF.items():
    ledgers.append({"id": lid, "name": disp, "icon": icon, "updatedAt": now_ms, "deleted": False})

payload = {
    "version": 2,
    "syncedAt": now_ms,
    "records": records,
    "categories": categories,
    "ledgers": ledgers,
    "importMeta": {
        "source": "喵喵记账 CSV ×3",
        "generatedAt": datetime.datetime.now().isoformat(timespec="seconds"),
        "note": "仅导入支出记录（历史收入已跳过）；收入分类保留供以后记账使用",
    },
}

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False)

print("=== 生成完成 ===")
print("输出: %s (%.1f KB)" % (OUT, os.path.getsize(OUT) / 1024))
print("支出记录: %d 条 | 跳过历史收入: %d 条 | 跨文件去重: %d 条 | 解析失败: %d 条"
      % (len(records), income_skipped, dup, bad))
print("分类: %d 个 | 账本: %d 个" % (len([c for c in categories if not c['deleted']]), len(ledgers)))
print("货币分布:", dict(currencies))
if unknown_cats:
    print("!! 未映射图标的分类:", unknown_cats)
print()
print("=== 各账本条数 ===")
for name, n in sorted(ledger_count.items(), key=lambda kv: -kv[1]):
    print("%-16s %5d 条" % (name, n))
print()
print("=== 记录抽样（前3 + 后3）===")
for r in records[:3] + records[-3:]:
    print("%s %s %-6s %8.2f [%s] %s" % (r["date"], r["type"][:3], r["catName"],
          r["amount"] / 100, r["ledgerId"], r["note"][:20]))
