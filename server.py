#!/usr/bin/env python3
"""Unofficial local dashboard: static files + /api/* proxy to technocore.chat.

    python3 server.py
    open http://127.0.0.1:8080/

Does not mint keys, does not cache secrets, binds localhost only by default.
"""
from __future__ import annotations

import argparse
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

DIR = os.path.dirname(os.path.abspath(__file__))
UPSTREAM = "https://technocore.chat"
UA = "technocore-viz/1.0 (unofficial public-telemetry dashboard; local)"

# Only these path prefixes are proxied. Prevents the local server being used as an open proxy.
ALLOWED = (
    "/rooms",
    "/r/",
    "/openapi.json",
    "/config",
    "/healthz",
    "/.well-known/",
    "/llms.txt",
    "/humans",
)


def allowed_path(path: str) -> bool:
    raw = path.split("?", 1)[0]
    if ".." in raw or raw.startswith("//"):
        return False
    return any(raw == p.rstrip("/") or raw.startswith(p) for p in ALLOWED) or raw in (
        "/rooms",
        "/openapi.json",
        "/config",
        "/healthz",
        "/llms.txt",
        "/humans",
    )


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def do_GET(self) -> None:
        if self.path == "/api" or self.path.startswith("/api/"):
            self.proxy()
            return
        super().do_GET()

    def do_HEAD(self) -> None:
        if self.path == "/api" or self.path.startswith("/api/"):
            self.proxy()
            return
        super().do_HEAD()

    def proxy(self) -> None:
        rest = self.path[len("/api") :] or "/"
        if not rest.startswith("/"):
            rest = "/" + rest
        if not allowed_path(rest):
            body = b"proxy refused: path not in allowlist\n"
            self.send_response(403)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        url = UPSTREAM + rest
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname != "technocore.chat":
            body = b"proxy refused: host mismatch\n"
            self.send_response(403)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)
            return

        req = Request(
            url,
            headers={
                "User-Agent": UA,
                "Accept": "application/json, text/plain;q=0.9, */*;q=0.1",
            },
            method="GET",
        )
        try:
            with urlopen(req, timeout=20) as resp:
                data = resp.read()
                status = resp.getcode() or 200
                ctype = resp.headers.get("Content-Type", "application/octet-stream")
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(data)
        except HTTPError as e:
            err = e.read() if e.fp else (e.reason or str(e)).encode("utf-8")
            self.send_response(e.code)
            self.send_header(
                "Content-Type", e.headers.get("Content-Type", "text/plain; charset=utf-8")
            )
            self.send_header("Content-Length", str(len(err)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(err)
        except URLError as e:
            msg = ("upstream error: %s\n" % e.reason).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(msg)
        except Exception as e:
            msg = ("proxy error: %s\n" % e).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(msg)


def main() -> None:
    parser = argparse.ArgumentParser(description="Technocore live viz (unofficial)")
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8080")))
    args = parser.parse_args()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print("TECHNOCORE LIVE  (unofficial public telemetry)", file=sys.stderr)
    print("  static  %s" % DIR, file=sys.stderr)
    print("  listen  http://%s:%s/" % (args.host, args.port), file=sys.stderr)
    print("  proxy   /api/*  ->  %s" % UPSTREAM, file=sys.stderr)
    print("  not Flop Labs, not airdrop advice, room names untrusted", file=sys.stderr)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye", file=sys.stderr)


if __name__ == "__main__":
    main()
