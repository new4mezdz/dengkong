import functools
import os
import socketserver
import threading
import webbrowser

from backend.config_store import ConfigStore
from backend.http_handler import create_handler
from backend.device_runtime import DeviceRuntime
from backend.settings import BASE_DIR, PORT


class ReusableThreadingTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main(port=PORT, open_browser=True):
    os.chdir(BASE_DIR)
    runtime = DeviceRuntime()
    config_store = ConfigStore()
    handler = functools.partial(create_handler(runtime, config_store), directory=str(BASE_DIR))

    with ReusableThreadingTCPServer(("", port), handler) as httpd:
        url = f"http://127.0.0.1:{port}"
        print(f"\n服务已启动: {url}")
        print("按 Ctrl+C 停止\n")
        if open_browser:
            threading.Timer(1.0, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止")
