#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
智研 · .docx 导出本地桥

为什么需要它
------------
浏览器不能直接写 Word 文件。要生成真正的 .docx（而不是把 Markdown 改个扩展名），
需要一个能在本机跑 python-docx 的进程。这个脚本提供两个能力：

1. `--serve`（默认）：起一个只监听 127.0.0.1 的小服务。页面点「导出 Word」时
   直接把当前项目数据 POST 过来，返回 .docx 文件流 —— 一次点击即可下载。
2. 纯 CLI：`python export_docx.py --in bundle.json --out 论文.docx`
   批量或脚本化使用，不需要起服务。

安全边界
--------
- 只绑定 127.0.0.1，外网无法访问。
- 校验 Origin，只接受本机页面；非白名单来源直接 403。
- 限制请求体大小，避免内存被塞爆。
- 不落盘保存用户数据：请求体只在内存里转成 docx 后返回。
- 不接受客户端指定的输出路径：服务端自己用临时文件，杜绝路径穿越。

用法
----
    python serve_docx.py                # 默认端口 8766
    python serve_docx.py --port 8770
    python serve_docx.py --print-only   # 只打印用法，不起服务
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_docx import build  # noqa: E402

MAX_BODY = 32 * 1024 * 1024        # 32 MB，足够几千段正文
ALLOWED_ORIGIN_PREFIXES = (
    "file://",
    "http://127.0.0.1",
    "http://localhost",
    "null",
)

DOCX_MIME = ("application/vnd.openxmlformats-officedocument"
             ".wordprocessingml.document")

# 文件名里不允许出现的字符（Windows 与通用安全集）
ILLEGAL_FILENAME_CHARS = set('\\/:*?"<>|')


def origin_allowed(origin):
    """file:// 页面发请求时 Origin 可能是 'null' 或缺失，这两种都要放行。"""
    if not origin:
        return True
    o = origin.strip()
    return any(o.startswith(p) for p in ALLOWED_ORIGIN_PREFIXES)


def safe_filename(title):
    """把标题转成安全的文件名；返回 None 表示不可用。"""
    if not title:
        return None
    kept = []
    for ch in title[:40]:
        if ch in ILLEGAL_FILENAME_CHARS:
            continue
        if ord(ch) < 32:
            continue
        kept.append(ch)
    name = "".join(kept).strip()
    return name or None


class Handler(BaseHTTPRequestHandler):
    server_version = "ZhiyanDocx/1.0"

    def log_message(self, fmt, *args):
        pass  # 安静点，别把控制台刷满

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin and origin != "null":
            self.send_header("Access-Control-Allow-Origin", origin)
        else:
            self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path.rstrip("/") in ("/health", ""):
            self._json(200, {
                "ok": True,
                "service": "zhiyan-docx-bridge",
                "accepts": "POST /docx",
                "maxBodyBytes": MAX_BODY,
            })
        else:
            self._json(404, {
                "ok": False, "code": "NOT_FOUND",
                "message": "只支持 GET /health 与 POST /docx",
            })

    def do_POST(self):
        if self.path.rstrip("/") != "/docx":
            self._json(404, {"ok": False, "code": "NOT_FOUND",
                             "message": "只支持 POST /docx"})
            return

        origin = self.headers.get("Origin")
        if not origin_allowed(origin):
            self._json(403, {
                "ok": False, "code": "ORIGIN_REJECTED",
                "message": "来源被拒绝：%s。本服务只服务本机页面。" % origin,
            })
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._json(400, {"ok": False, "code": "BAD_LENGTH",
                             "message": "Content-Length 不是整数"})
            return
        if length <= 0:
            self._json(400, {"ok": False, "code": "EMPTY_BODY",
                             "message": "请求体为空"})
            return
        if length > MAX_BODY:
            self._json(413, {
                "ok": False, "code": "BODY_TOO_LARGE",
                "message": "请求体 %d 字节超过上限 %d" % (length, MAX_BODY),
            })
            return

        raw = self.rfile.read(length)
        try:
            bundle = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            self._json(400, {
                "ok": False, "code": "BAD_JSON",
                "message": "请求体不是合法 UTF-8 JSON：%s" % e,
            })
            return
        if not isinstance(bundle, dict):
            self._json(400, {"ok": False, "code": "BAD_JSON",
                             "message": "JSON 顶层必须是对象"})
            return

        # 输出到临时文件再读回：不碰用户目录，也不接受任何客户端路径
        tmp = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as fh:
                tmp = Path(fh.name)
            result = build(bundle, tmp)
            data = tmp.read_bytes()
        except Exception as e:  # 导出失败要给出可读原因，不能 500 静默
            self._json(500, {
                "ok": False, "code": "EXPORT_FAILED",
                "message": "生成 .docx 失败：%s: %s" % (type(e).__name__, e),
            })
            return
        finally:
            if tmp is not None:
                try:
                    tmp.unlink()
                except OSError:
                    pass

        filename = safe_filename((bundle.get("meta") or {}).get("title"))
        if not filename:
            filename = "论文初稿"
        filename += ".docx"

        self.send_response(200)
        self.send_header("Content-Type", DOCX_MIME)
        self.send_header("Content-Length", str(len(data)))
        # RFC 5987：文件名可能含中文
        disposition = (
            'attachment; filename="paper.docx"; '
            "filename*=UTF-8''" + quote(filename)
        )
        self.send_header("Content-Disposition", disposition)
        self.send_header("X-Export-Summary",
                         json.dumps(result, ensure_ascii=True))
        self._cors()
        self.end_headers()
        self.wfile.write(data)


USAGE = """智研 · .docx 导出桥已启动
  地址：http://127.0.0.1:{port}
  健康检查：GET  http://127.0.0.1:{port}/health
  导出：    POST http://127.0.0.1:{port}/docx   （body = 项目包 JSON）
  说明：只监听本机回环地址；不保存你的数据；Ctrl+C 停止。
  另：不需要起服务时也可以直接用 CLI ——
      python export_docx.py --in bundle.json --out 论文初稿.docx
"""


def main(argv=None):
    ap = argparse.ArgumentParser(description="智研 · .docx 导出本地桥")
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--print-only", action="store_true",
                    help="只打印说明，不起服务")
    args = ap.parse_args(argv)

    if args.print_only:
        print(USAGE.format(port=args.port))
        return 0

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(USAGE.format(port=args.port))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
