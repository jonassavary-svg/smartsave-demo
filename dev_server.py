#!/usr/bin/env python3
import http.server
import socketserver
import threading
import time
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get('PORT', '8080'))
WATCH_EXTS = {'.html', '.css', '.js', '.webmanifest', '.json'}

state = {'version': 0}


def snapshot_mtimes():
    mtimes = {}
    for p in ROOT.iterdir():
        if p.is_dir():
            continue
        if p.suffix.lower() in WATCH_EXTS:
            try:
                mtimes[str(p)] = p.stat().st_mtime
            except FileNotFoundError:
                pass
    return mtimes


def watcher():
    prev = snapshot_mtimes()
    while True:
        time.sleep(1)
        cur = snapshot_mtimes()
        if cur != prev:
            state['version'] += 1
            prev = cur


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        # Force a fresh response even if the browser sends If-Modified-Since.
        if 'If-Modified-Since' in self.headers:
          del self.headers['If-Modified-Since']
        if self.path == '/__reload':
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'keep-alive')
            self.end_headers()

            last = state['version']
            try:
                while True:
                    time.sleep(0.5)
                    if state['version'] != last:
                        last = state['version']
                        self.wfile.write(b'data: reload\n\n')
                        self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                return
        else:
            return http.server.SimpleHTTPRequestHandler.do_GET(self)


if __name__ == '__main__':
    os.chdir(ROOT)
    threading.Thread(target=watcher, daemon=True).start()

    class ThreadingHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
        daemon_threads = True
        allow_reuse_address = True

    with ThreadingHTTPServer(('0.0.0.0', PORT), Handler) as httpd:
        print(f"Dev server running at http://0.0.0.0:{PORT}")
        httpd.serve_forever()
