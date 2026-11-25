# -*- coding: utf-8 -*-
"""把记账本部署到 Cloudflare Pages（Direct Upload，无需 git 集成）。

用法：设置环境变量 CF_ACCOUNT_ID、CF_API_TOKEN 后运行。
幂等：项目不存在则创建；每次运行上传一个新版本。
"""
import io
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
import zipfile

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ACC = os.environ.get("CF_ACCOUNT_ID", "").strip()
TOK = os.environ.get("CF_API_TOKEN", "").strip()
if not ACC or not TOK:
    print("缺少 CF_ACCOUNT_ID / CF_API_TOKEN")
    sys.exit(2)

API = "https://api.cloudflare.com/client/v4"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT = "jizhang"
FILES = [
    "index.html", "style.css", "app.js", "sync.js", "sw.js", "manifest.webmanifest",
    "icons/icon-192.png", "icons/icon-180.png", "icons/icon-512.png",
]


def api(method, path, body=None, raw_headers=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers={
        "Authorization": "Bearer " + TOK,
        "Content-Type": "application/json",
        **(raw_headers or {}),
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8"))
        except ValueError:
            return {"success": False, "errors": [{"message": "HTTP %d" % e.code}]}


# 1. 确保项目存在
proj = api("GET", "/accounts/%s/pages/projects/%s" % (ACC, PROJECT))
if not proj.get("success"):
    proj = api("POST", "/accounts/%s/pages/projects" % ACC,
               {"name": PROJECT, "production_branch": "main"})
    if not proj.get("success"):
        print("创建项目失败:", proj.get("errors"))
        sys.exit(1)
    print("已创建 Pages 项目:", PROJECT)
else:
    print("项目已存在:", PROJECT)

# 2. 打包应用文件
zbuf = io.BytesIO()
with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as z:
    for rel in FILES:
        p = os.path.join(ROOT, rel)
        if not os.path.isfile(p):
            print("缺少文件:", rel)
            sys.exit(1)
        z.write(p, rel)
zip_bytes = zbuf.getvalue()
print("打包完成: %.1f KB（%d 个文件）" % (len(zip_bytes) / 1024, len(FILES)))

# 3. multipart 上传部署
boundary = uuid.uuid4().hex
meta = json.dumps({"branch": "main", "commit_message": "deploy via script"}).encode()
parts = []
parts.append(("--%s\r\nContent-Disposition: form-data; name=\"metadata\"\r\n\r\n" % boundary).encode() + meta + b"\r\n")
parts.append(("--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"bundle.zip\"\r\nContent-Type: application/zip\r\n\r\n" % boundary).encode() + zip_bytes + b"\r\n")
parts.append(("--%s--\r\n" % boundary).encode())
body = b"".join(parts)

req = urllib.request.Request(
    API + "/accounts/%s/pages/projects/%s/deployments" % (ACC, PROJECT),
    data=body, method="POST",
    headers={"Authorization": "Bearer " + TOK,
             "Content-Type": "multipart/form-data; boundary=" + boundary},
)
try:
    with urllib.request.urlopen(req, timeout=120) as resp:
        res = json.loads(resp.read().decode("utf-8"))
except urllib.error.HTTPError as e:
    print("部署失败 HTTP %d:" % e.code, e.read().decode("utf-8", "replace")[:500])
    sys.exit(1)

if not res.get("success"):
    print("部署失败:", res.get("errors"))
    sys.exit(1)

d = res["result"]
print("部署成功!")
print("  预览地址:", d.get("url"))
print("  正式地址: https://%s.pages.dev" % PROJECT)

# 4. 验证正式域名
try:
    with urllib.request.urlopen("https://%s.pages.dev/" % PROJECT, timeout=30) as r:
        html = r.read().decode("utf-8", "replace")
    print("  验证:", "OK 首页可访问" if "记账本" in html else "已访问但内容异常 (HTTP %d)" % r.status)
except Exception as e:
    print("  验证访问失败:", e)
