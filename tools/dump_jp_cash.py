# -*- coding: utf-8 -*-
import csv, glob, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
FILES = sorted(glob.glob(r"C:\Users\zhengkaiyu01\Downloads\喵喵记账*.csv"))
def read_rows(path):
    for enc in ("utf-8-sig","utf-8","gbk"):
        try:
            with open(path,"r",encoding=enc,newline="") as f: rows=list(csv.reader(f))
            if rows and "分类" in rows[0][0]: return rows
        except (UnicodeDecodeError, IndexError): pass
    return []
seen=set(); jp=[]; other=[]
for p in FILES:
    for r in read_rows(p)[1:]:
        if len(r)<7: continue
        cat,t,amt,acct,ledger,cur,note=(x.strip() for x in r[:7])
        key=(cat,t,amt,ledger,note)
        if key in seen: continue
        seen.add(key)
        try: a=float(amt)
        except ValueError: continue
        if ledger=="日本":
            jp.append((t,cat,a,note))
            if cat!="现金": other.append((t,cat,a,note))
jp.sort()
print("=== 日本账本 现金 分类 %d 笔 ===" % len([x for x in jp if x[1]=="现金"]))
for t,cat,a,n in jp:
    if cat=="现金": print("%s %8.2f  %s" % (t[:10], a, n or "-"))
print()
print("=== 日本账本其他分类 %d 笔（前12条）===" % len(other))
for t,cat,a,n in sorted(other)[:12]:
    print("%s [%s] %8.2f  %s" % (t[:10], cat, a, n or "-"))
print()
tot_cash=sum(-a for _,c,a,_ in jp if c=="现金")
print("现金分类合计: %.2f 元" % tot_cash)
broken=[x for x in jp if x[1]=="现金" and abs(x[2])<1]
print("其中金额<1元(疑似没换算): %d 笔" % len(broken))
