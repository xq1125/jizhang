# -*- coding: utf-8 -*-
"""尝试用 PWABuilder 云 API 把 jizhang-xq.pages.dev 打包成 Android APK。
步骤：ManifestGather -> ReportLighthouse -> AndroidPackage。结果存到 pwabuilder_result.json。"""
import io
import json
import sys
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = "https://api.pwabuilder.com/api"
SITE = "https://jizhang-xq.pages.dev/"
MANIFEST = SITE + "manifest.webmanifest"


def post(path, body, timeout=120):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except Exception as e:
        try:
            payload = e.read().decode("utf-8", "replace")[:800]
        except Exception:
            payload = ""
        return getattr(e, "code", 0), {"exception": str(e), "body": payload}


print("=== 1. ManifestGather")
st, mg = post("/ManifestGather", {"url": MANIFEST})
print("status:", st, "| success:", mg.get("success"))
if not mg.get("success"):
    print(json.dumps(mg, ensure_ascii=False)[:800])
    sys.exit(1)
mi = mg.get("manifestInfo") or {}
print("app name:", (mi.get("name") or {}).get("value") if isinstance(mi.get("name"), dict) else mi.get("name"))

print("=== 2. ReportLighthouse")
st, lh = post("/ReportLighthouse", {"url": SITE}, timeout=180)
print("status:", st, "| success:", lh.get("success"))

print("=== 3. AndroidPackage")
options = {
    "packageId": "dev.pages.jizhangxq.app",
    "appVersion": "1.0.0",
    "appName": "记账本",
    "packageType": "traditional-webview",
    "generatorVersion": "2.0.0",
    "web_app_asset_url": SITE,
    "appHost": False,
    "signingMode": "generate",
    "keystoreFile": None,
    "keystorePassword": "jizhang123",
    "keyPassword": "jizhang123",
    "keyAlias": "jizhang",
    "display": "standalone",
    "hostType": "mobile",
}
report = {"manifestInfo": mg.get("manifestInfo"), "lighthouseInfo": lh.get("lighthouseInfo")}
st, ap = post("/AndroidPackage", {"report": report, "options": options}, timeout=300)
print("status:", st, "| success:", ap.get("success"))
keys = list(ap.keys())
print("keys:", keys)
with open("pwabuilder_result.json", "w", encoding="utf-8") as f:
    json.dump({"manifest": mg.get("success"), "lh": lh.get("success"), "android": ap}, f, ensure_ascii=False)
res = ap.get("result") or {}
if isinstance(res, dict):
    print("result keys:", list(res.keys()))
    for k in ("downloadFileManifestId", "uri", "url", "fileUri"):
        if k in res:
            print(k, "=", res[k])
if not ap.get("success"):
    print(json.dumps(ap, ensure_ascii=False)[:1200])
