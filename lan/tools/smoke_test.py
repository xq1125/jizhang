# -*- coding: utf-8 -*-
"""记账本 API 冒烟测试：假设服务已在 127.0.0.1:8765 运行。"""
import datetime
import http.client
import json
import sys
import urllib.error
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE = "http://127.0.0.1:8765"
fails = []


def req(method, path, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
                               headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=5) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + ((" | " + str(extra)) if extra else ""))
    if not cond:
        fails.append(name)


st, d = req("GET", "/api/ping")
check("ping", st == 200 and d.get("ok"), d)

st, d = req("GET", "/api/categories")
cats = d.get("categories", [])
check("categories seeded", st == 200 and len(cats) >= 16, len(cats))
exp_cat = next(c for c in cats if c["type"] == "expense")
inc_cat = next(c for c in cats if c["type"] == "income")

today = datetime.date.today().isoformat()
st, d = req("POST", "/api/records", {"type": "expense", "amount": "23.5",
              "category_id": exp_cat["id"], "date": today, "note": "smoke 午餐"})
check("create expense", st == 201 and "id" in d, d)
rid1 = d.get("id")
st, d = req("POST", "/api/records", {"type": "income", "amount": "8000",
              "category_id": inc_cat["id"], "date": today, "note": "smoke 工资"})
check("create income", st == 201, d)
rid2 = d.get("id")

st, d = req("POST", "/api/records", {"type": "expense", "amount": "-5",
              "category_id": exp_cat["id"], "date": today})
check("reject negative", st == 400, (st, d))
st, d = req("POST", "/api/records", {"type": "expense", "amount": "1.234",
              "category_id": exp_cat["id"], "date": today})
check("reject 3 decimals", st == 400, (st, d))
st, d = req("POST", "/api/records", {"type": "expense", "amount": "1",
              "category_id": inc_cat["id"], "date": today})
check("reject type mismatch", st == 400, (st, d))
st, d = req("POST", "/api/records", {"type": "expense", "amount": "1",
              "category_id": exp_cat["id"], "date": "2026-13-99"})
check("reject bad date", st == 400, (st, d))

st, d = req("PUT", "/api/records/%s" % rid1, {"type": "expense", "amount": "30",
              "category_id": exp_cat["id"], "date": today, "note": "smoke 改过"})
check("update", st == 200, d)

st, d = req("GET", "/api/records?month=" + today[:7])
recs = d.get("records", [])
mine = [r for r in recs if r["id"] in (rid1, rid2)]
check("list has both", len(mine) == 2, len(mine))
check("updated amount exact", any(abs(r["amount"] - 30.0) < 1e-9 for r in mine))
check("joined category", all(r.get("category_name") for r in mine))

st, d = req("GET", "/api/stats?month=" + today[:7])
check("stats totals", st == 200 and d["income"] >= 8000 and d["expense"] >= 30,
      {k: d.get(k) for k in ("income", "expense", "net")})
check("stats byCategory", len(d.get("byCategory", [])) >= 2)
check("stats daily", len(d.get("daily", [])) >= 2)

st, d = req("POST", "/api/categories", {"name": "smoke分类", "type": "expense", "icon": "🧪"})
check("add category", st in (200, 201), d)

st, d = req("DELETE", "/api/records/%s" % rid1)
check("delete 1", st == 200, d)
st, d = req("DELETE", "/api/records/%s" % rid2)
check("delete 2", st == 200, d)
st, d = req("DELETE", "/api/records/%s" % rid1)
check("delete again -> 404", st == 404, (st, d))

html = urllib.request.urlopen(BASE + "/").read().decode("utf-8")
check("index served", "<title>记账本</title>" in html)
check("app.js served", urllib.request.urlopen(BASE + "/app.js").status == 200)
check("style served", urllib.request.urlopen(BASE + "/style.css").status == 200)
check("sw served", urllib.request.urlopen(BASE + "/sw.js").status == 200)
check("manifest served", urllib.request.urlopen(BASE + "/manifest.webmanifest").status == 200)
check("icon served", urllib.request.urlopen(BASE + "/icons/icon-192.png").status == 200)

conn = http.client.HTTPConnection("127.0.0.1", 8765, timeout=5)
conn.request("GET", "/../server.py")
code = conn.getresponse().status
check("raw traversal blocked", code in (403, 404), code)
conn = http.client.HTTPConnection("127.0.0.1", 8765, timeout=5)
conn.request("GET", "/%2e%2e/server.py")
code = conn.getresponse().status
check("encoded traversal blocked", code in (403, 404), code)

print("RESULT", "OK" if not fails else "FAILED: " + ", ".join(fails))
sys.exit(0 if not fails else 1)
