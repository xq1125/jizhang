#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
记账本 —— 零依赖本地记账服务（只用 Python 标准库）。

- 电脑：浏览器打开 http://localhost:8765
- 手机：连同一个 Wi-Fi，打开 http://<电脑IP>:8765，可“添加到主屏幕”当 App 用
- 数据：SQLite 单文件，保存在 data/ledger.db

启动：python server.py   （或双击 启动记账.bat）
"""

import datetime
import json
import os
import re
import shutil
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import traceback
from decimal import Decimal, InvalidOperation
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "ledger.db")
BACKUP_DIR = os.path.join(BASE_DIR, "backups")
BACKUP_DB = os.path.join(BACKUP_DIR, "ledger.db")
PORT = int(os.environ.get("JIZHANG_PORT", "8765"))

# 自动备份：每次改动后静候几秒，把账本快照 commit + push 到 GitHub（origin/main）
AUTO_SYNC = os.environ.get("JIZHANG_AUTO_BACKUP", "1") != "0"
QUIET_SECONDS = float(os.environ.get("JIZHANG_SYNC_QUIET", "8"))
RETRY_SECONDS = 60
NO_WINDOW = 0x08000000 if os.name == "nt" else 0

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MONTH_RE = re.compile(r"^\d{4}-\d{2}$")
TYPES = ("income", "expense")

DEFAULT_CATEGORIES = [
    ("餐饮", "expense", "🍜"),
    ("交通", "expense", "🚌"),
    ("购物", "expense", "🛍️"),
    ("居住", "expense", "🏠"),
    ("娱乐", "expense", "🎮"),
    ("医疗", "expense", "💊"),
    ("教育", "expense", "📚"),
    ("人情", "expense", "🎁"),
    ("数码", "expense", "📱"),
    ("其他", "expense", "📦"),
    ("工资", "income", "💰"),
    ("奖金", "income", "🧧"),
    ("兼职", "income", "🛠️"),
    ("理财", "income", "📈"),
    ("报销", "income", "🧾"),
    ("其他", "income", "💵"),
]

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}

_db_lock = threading.Lock()
_db = None


# ---------------------------------------------------------------- database

def now_str():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def init_db():
    global _db
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(DB_PATH) and os.path.isfile(BACKUP_DB):
        shutil.copy2(BACKUP_DB, DB_PATH)
        print("[恢复] 账本不存在，已从 GitHub 备份还原 data/ledger.db", flush=True)
    _db = sqlite3.connect(DB_PATH, check_same_thread=False)
    _db.row_factory = sqlite3.Row
    with _db_lock:
        _db.executescript(
            """
            CREATE TABLE IF NOT EXISTS categories(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('income','expense')),
                icon TEXT NOT NULL DEFAULT '📦',
                UNIQUE(name, type)
            );
            CREATE TABLE IF NOT EXISTS records(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL CHECK(type IN ('income','expense')),
                amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
                category_id INTEGER NOT NULL REFERENCES categories(id),
                date TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_records_date ON records(date);
            CREATE INDEX IF NOT EXISTS idx_records_cat ON records(category_id);
            """
        )
        if _db.execute("SELECT COUNT(*) FROM categories").fetchone()[0] == 0:
            _db.executemany(
                "INSERT INTO categories(name, type, icon) VALUES(?,?,?)",
                DEFAULT_CATEGORIES,
            )
        _db.commit()


def q(sql, args=()):
    with _db_lock:
        return [dict(r) for r in _db.execute(sql, args).fetchall()]


def x(sql, args=()):
    with _db_lock:
        cur = _db.execute(sql, args)
        _db.commit()
        return cur


# ---------------------------------------------------------------- helpers

def parse_amount(value):
    """把用户输入的金额字符串转成“分”（整数），最多两位小数。"""
    try:
        d = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        raise ValueError("金额格式不正确")
    if d != d.quantize(Decimal("0.01")):
        raise ValueError("金额最多保留两位小数")
    cents = int(d * 100)
    if cents <= 0:
        raise ValueError("金额必须大于 0")
    if cents > 10_000_000_000:
        raise ValueError("金额太大了")
    return cents


def valid_date(s):
    if not DATE_RE.match(s or ""):
        return False
    try:
        datetime.date.fromisoformat(s)
        return True
    except ValueError:
        return False


def valid_month(s):
    if not MONTH_RE.match(s or ""):
        return False
    try:
        datetime.date.fromisoformat(s + "-01")
        return True
    except ValueError:
        return False


def record_rows(month=None, type_=None):
    sql = (
        "SELECT r.id, r.type, r.amount_cents, r.date, r.note, r.created_at, r.updated_at,"
        " c.id AS category_id, c.name AS category_name, c.icon AS category_icon"
        " FROM records r JOIN categories c ON c.id = r.category_id WHERE 1=1"
    )
    args = []
    if month:
        sql += " AND r.date LIKE ?"
        args.append(month + "-%")
    if type_ in TYPES:
        sql += " AND r.type = ?"
        args.append(type_)
    sql += " ORDER BY r.date DESC, r.id DESC"
    rows = q(sql, args)
    for r in rows:
        r["amount"] = r.pop("amount_cents") / 100.0
    return rows


def validate_record(body, existing=None):
    t = body.get("type")
    if t not in TYPES:
        raise ValueError("类型必须是 income 或 expense")
    cents = parse_amount(body.get("amount"))
    date = body.get("date")
    if not valid_date(date):
        raise ValueError("日期格式应为 YYYY-MM-DD")
    note = str(body.get("note") or "").strip()[:200]
    cat_id = body.get("category_id")
    try:
        cat_id = int(cat_id)
    except (TypeError, ValueError):
        raise ValueError("请选择分类")
    row = q("SELECT * FROM categories WHERE id=?", (cat_id,))
    if not row:
        raise ValueError("分类不存在")
    if row[0]["type"] != t:
        raise ValueError("分类与收支类型不匹配")
    return {
        "type": t,
        "amount_cents": cents,
        "category_id": cat_id,
        "date": date,
        "note": note,
    }


# ---------------------------------------------------------------- api

def api_get(path, qs, handler):
    if path == "/api/ping":
        return 200, {"ok": True, "time": now_str()}
    if path == "/api/categories":
        return 200, {"categories": q("SELECT * FROM categories ORDER BY type, id")}
    m = re.match(r"^/api/records$", path)
    if m:
        month = (qs.get("month") or [None])[0]
        type_ = (qs.get("type") or [None])[0]
        if month and not valid_month(month):
            raise ValueError("month 格式应为 YYYY-MM")
        return 200, {"records": record_rows(month, type_)}
    m = re.match(r"^/api/stats$", path)
    if m:
        month = (qs.get("month") or [None])[0]
        if not month:
            month = datetime.date.today().strftime("%Y-%m")
        if not valid_month(month):
            raise ValueError("month 格式应为 YYYY-MM")
        like = month + "-%"
        totals = q(
            "SELECT type, SUM(amount_cents) AS cents, COUNT(*) AS n"
            " FROM records WHERE date LIKE ? GROUP BY type",
            (like,),
        )
        income = next((t["cents"] for t in totals if t["type"] == "income"), 0) or 0
        expense = next((t["cents"] for t in totals if t["type"] == "expense"), 0) or 0
        by_cat = q(
            "SELECT c.name, c.icon, r.type, SUM(r.amount_cents) AS cents, COUNT(*) AS n"
            " FROM records r JOIN categories c ON c.id = r.category_id"
            " WHERE r.date LIKE ? GROUP BY r.category_id, r.type ORDER BY cents DESC",
            (like,),
        )
        daily = q(
            "SELECT date, type, SUM(amount_cents) AS cents FROM records"
            " WHERE date LIKE ? GROUP BY date, type ORDER BY date",
            (like,),
        )
        return 200, {
            "month": month,
            "income": income / 100.0,
            "expense": expense / 100.0,
            "net": (income - expense) / 100.0,
            "byCategory": [
                {
                    "name": b["name"],
                    "icon": b["icon"],
                    "type": b["type"],
                    "amount": b["cents"] / 100.0,
                    "count": b["n"],
                }
                for b in by_cat
            ],
            "daily": [
                {"date": d["date"], "type": d["type"], "amount": d["cents"] / 100.0}
                for d in daily
            ],
        }
    raise NotFound()


def api_post(path, body, handler):
    if path == "/api/records":
        data = validate_record(body)
        ts = now_str()
        cur = x(
            "INSERT INTO records(type, amount_cents, category_id, date, note, created_at, updated_at)"
            " VALUES(?,?,?,?,?,?,?)",
            (data["type"], data["amount_cents"], data["category_id"], data["date"], data["note"], ts, ts),
        )
        SYNC.notify()
        return 201, {"ok": True, "id": cur.lastrowid}
    if path == "/api/categories":
        name = str(body.get("name") or "").strip()[:20]
        t = body.get("type")
        icon = str(body.get("icon") or "📦").strip()[:8]
        if not name:
            raise ValueError("分类名称不能为空")
        if t not in TYPES:
            raise ValueError("类型必须是 income 或 expense")
        cur = x(
            "INSERT OR IGNORE INTO categories(name, type, icon) VALUES(?,?,?)",
            (name, t, icon),
        )
        if cur.rowcount == 0:
            row = q("SELECT * FROM categories WHERE name=? AND type=?", (name, t))[0]
            return 200, {"ok": True, "category": row, "existed": True}
        row = q("SELECT * FROM categories WHERE id=?", (cur.lastrowid,))[0]
        SYNC.notify()
        return 201, {"ok": True, "category": row}
    raise NotFound()


def api_put(path, body, handler):
    m = re.match(r"^/api/records/(\d+)$", path)
    if m:
        rid = int(m.group(1))
        if not q("SELECT id FROM records WHERE id=?", (rid,)):
            raise NotFound("记录不存在")
        data = validate_record(body)
        x(
            "UPDATE records SET type=?, amount_cents=?, category_id=?, date=?, note=?, updated_at=?"
            " WHERE id=?",
            (data["type"], data["amount_cents"], data["category_id"], data["date"], data["note"], now_str(), rid),
        )
        SYNC.notify()
        return 200, {"ok": True, "id": rid}
    raise NotFound()


def api_delete(path, handler):
    m = re.match(r"^/api/records/(\d+)$", path)
    if m:
        rid = int(m.group(1))
        cur = x("DELETE FROM records WHERE id=?", (rid,))
        if cur.rowcount == 0:
            raise NotFound("记录不存在")
        SYNC.notify()
        return 200, {"ok": True, "id": rid}
    raise NotFound()


class NotFound(Exception):
    pass


# ---------------------------------------------------------------- http

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "JiZhang/1.0"

    def log_message(self, fmt, *args):
        sys.stdout.write("[%s] %s\n" % (datetime.datetime.now().strftime("%H:%M:%S"), fmt % args))

    # -- plumbing
    def send_json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > 64 * 1024:
            raise ValueError("请求体过大")
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("请求体不是合法 JSON")

    def handle_one(self, method):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path.startswith("/api/"):
            qs = parse_qs(parsed.query)
            try:
                if method == "GET":
                    code, obj = api_get(path, qs, self)
                elif method == "POST":
                    code, obj = api_post(path, self.read_body(), self)
                elif method == "PUT":
                    code, obj = api_put(path, self.read_body(), self)
                elif method == "DELETE":
                    code, obj = api_delete(path, self)
                else:
                    raise NotFound()
                self.send_json(code, obj)
            except NotFound as e:
                self.send_json(404, {"error": str(e) or "不存在"})
            except ValueError as e:
                self.send_json(400, {"error": str(e)})
            except Exception as e:  # noqa: BLE001
                self.send_json(500, {"error": "服务器错误: %s" % e})
            return
        if method != "GET" and method != "HEAD":
            self.send_json(405, {"error": "method not allowed"})
            return
        self.serve_static(path)

    # -- static files
    def serve_static(self, url_path):
        rel = url_path.lstrip("/") or "index.html"
        full = os.path.normpath(os.path.join(WEB_DIR, rel))
        if full != WEB_DIR and not full.startswith(WEB_DIR + os.sep):
            self.send_json(403, {"error": "forbidden"})
            return
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        if not os.path.isfile(full):
            self.send_json(404, {"error": "not found"})
            return
        ext = os.path.splitext(full)[1].lower()
        ctype = MIME.get(ext, "application/octet-stream")
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        if ext in (".html", ".js", ".webmanifest"):
            self.send_header("Cache-Control", "no-store")
        else:
            self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def do_GET(self):
        self.handle_one("GET")

    def do_HEAD(self):
        self.handle_one("HEAD")

    def do_POST(self):
        self.handle_one("POST")

    def do_PUT(self):
        self.handle_one("PUT")

    def do_DELETE(self):
        self.handle_one("DELETE")


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        # 客户端提前断开（手机切后台、浏览器关页等）很常见，忽略这类噪声
        if isinstance(exc, (ConnectionError, TimeoutError)):
            return
        traceback.print_exc()


# ---------------------------------------------------------------- auto sync

def _git(*args, timeout=60):
    r = subprocess.run(
        ["git"] + list(args), cwd=BASE_DIR, capture_output=True,
        timeout=timeout, creationflags=NO_WINDOW,
    )
    out = (r.stdout + r.stderr).decode("utf-8", errors="replace").strip()
    return r.returncode, out


def backup_and_push():
    """把账本做成一致性快照，提交并推送。返回 (成功?, 说明)。"""
    if not os.path.isfile(DB_PATH):
        return True, "无数据"
    os.makedirs(BACKUP_DIR, exist_ok=True)
    tmp = os.path.join(BACKUP_DIR, "ledger.tmp.db")
    dst = sqlite3.connect(tmp)
    try:
        with _db_lock:
            _db.backup(dst)
    finally:
        dst.close()
    os.replace(tmp, BACKUP_DB)

    code, out = _git("add", "backups/ledger.db")
    if code != 0:
        return False, "git add 失败: " + out
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    code, out = _git("commit", "-m", "auto backup " + ts)
    if code != 0 and "nothing to commit" not in out and "nothing added" not in out:
        return False, "git commit 失败: " + out
    code, out = _git("push", "origin", "main")
    if code != 0:
        return False, "git push 失败: " + out
    return True, ""


class SyncWorker(threading.Thread):
    """后台线程：改动后静候 QUIET_SECONDS 再备份；失败每 RETRY_SECONDS 重试。"""

    def __init__(self):
        super().__init__(daemon=True, name="auto-sync")
        self.cond = threading.Condition()
        self.dirty = False
        self.last_change = 0.0
        self.disabled = False

    def notify(self):
        if self.disabled:
            return
        with self.cond:
            self.dirty = True
            self.last_change = time.time()
            self.cond.notify()

    def run(self):
        while True:
            with self.cond:
                while not self.dirty:
                    self.cond.wait()
                while time.time() - self.last_change < QUIET_SECONDS:
                    self.cond.wait(QUIET_SECONDS)
                self.dirty = False
            try:
                ok, msg = backup_and_push()
            except FileNotFoundError:
                print("[自动备份] 找不到 git 命令，自动备份已关闭", flush=True)
                self.disabled = True
                return
            except Exception as e:  # noqa: BLE001
                ok, msg = False, str(e)
            if ok:
                print("[%s] [自动备份] 已同步到 GitHub" % datetime.datetime.now().strftime("%H:%M:%S"), flush=True)
            else:
                print("[%s] [自动备份] 失败: %s（%d 秒后重试）"
                      % (datetime.datetime.now().strftime("%H:%M:%S"), msg, RETRY_SECONDS), flush=True)
                with self.cond:
                    self.dirty = True
                    self.last_change = time.time() + RETRY_SECONDS - QUIET_SECONDS


SYNC = SyncWorker()


def start_sync_if_enabled():
    if not AUTO_SYNC:
        return False
    try:
        code, _ = _git("remote", "get-url", "origin", timeout=10)
    except FileNotFoundError:
        return False
    if code != 0:
        return False
    SYNC.start()
    return True


# ---------------------------------------------------------------- main

def lan_ips():
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    return ips


def main():
    init_db()
    sync_on = start_sync_if_enabled()
    httpd = Server(("0.0.0.0", PORT), Handler)
    print("=" * 52)
    print("  记账本已启动  (Ctrl+C 或关闭窗口即停止)")
    print("=" * 52)
    print("  电脑浏览器:  http://localhost:%d" % PORT)
    ips = lan_ips()
    if ips:
        print("  手机(同Wi-Fi):")
        for ip in ips:
            print("      http://%s:%d" % (ip, PORT))
        print("  手机上打开后可用浏览器菜单“添加到主屏幕”，")
        print("  像 App 一样全屏使用，数据与电脑实时共享。")
    else:
        print("  未检测到局域网 IP（手机可能无法连接）")
    print("  数据文件: %s" % DB_PATH)
    if sync_on:
        print("  自动备份: 已开启，改动后约 %d 秒自动同步到 GitHub" % QUIET_SECONDS)
    else:
        print("  自动备份: 未开启（找不到 git 或 origin 远程仓库）")
    print("  首次运行若 Windows 防火墙弹窗询问，请勾选“专用网络”并允许。")
    print("=" * 52, flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")


if __name__ == "__main__":
    main()
