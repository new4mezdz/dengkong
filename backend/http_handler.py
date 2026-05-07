import http.server
import json
from urllib.parse import urlparse


def create_handler(runtime, config_store):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def _send_json(self, data, status=200):
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

        def end_headers(self):
            self.send_header("Cache-Control", "no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            super().end_headers()

        def _read_body(self):
            length = int(self.headers.get("Content-Length", 0))
            if length == 0:
                return {}
            return json.loads(self.rfile.read(length).decode("utf-8"))

        def log_message(self, fmt, *args):
            pass

        def do_GET(self):
            path = urlparse(self.path).path

            if path in {"/", "/index.html"}:
                # Keep the public URL stable while serving the refactored page shell.
                self.path = "/app.html"
                return super().do_GET()

            if path == "/api/config":
                self._send_json(config_store.load())
                return

            if path == "/api/status":
                self._send_json(runtime.refresh_status())
                return

            super().do_GET()

        def do_POST(self):
            path = urlparse(self.path).path

            try:
                if path == "/api/connect":
                    body = self._read_body()
                    response = runtime.connect_device(body)
                    self._send_json(response)
                    return

                if path == "/api/disconnect":
                    body = self._read_body()
                    ip = body.get("ip")
                    if ip:
                        runtime.disconnect_device(ip)
                    else:
                        runtime.disconnect_all()
                    self._send_json({"ok": True})
                    return

                if path == "/api/toggle":
                    body = self._read_body()
                    response = runtime.toggle_channel(
                        ip=body["ip"],
                        channel=int(body["channel"]),
                        value=bool(body["value"]),
                    )
                    self._send_json(response)
                    return

                if path == "/api/batch":
                    body = self._read_body()
                    response = runtime.batch_toggle(
                        ip=body["ip"],
                        start=int(body["start"]),
                        end=int(body["end"]),
                        value=bool(body["value"]),
                    )
                    self._send_json(response)
                    return

                if path == "/api/config":
                    body = self._read_body()
                    config = config_store.build_config(body)
                    runtime.prune_devices({device["ip"] for device in config["devices"]})
                    if config_store.save(config):
                        self._send_json({"ok": True})
                    else:
                        self._send_json({"ok": False, "error": "保存失败"})
                    return

                self._send_json({"error": "未知接口"}, 404)
            except Exception as error:
                self._send_json({"ok": False, "error": str(error)})

    return Handler
