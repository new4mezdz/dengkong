"""
DAM1600D 3D控制中心 - 后端(多设备版)
运行: python server.py
自动打开浏览器访问控制界面
"""

import http.server
import socketserver
import json
import socket
import struct
import threading
import webbrowser
import os
from urllib.parse import urlparse

PORT = 8888
CONFIG_FILE = "dam1600d_devices.json"


# ========== Modbus TCP ==========
class ModbusTCP:
    def __init__(self):
        self.sock = None
        self.transaction_id = 0
        self.lock = threading.Lock()

    def connect(self, ip, port, timeout=3):
        try:
            if self.sock:
                self.close()
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.settimeout(timeout)
            self.sock.connect((ip, port))
            return True
        except:
            self.sock = None
            return False

    def close(self):
        if self.sock:
            try:
                self.sock.close()
            except:
                pass
            self.sock = None

    def _send_receive(self, unit_id, pdu):
        with self.lock:
            if not self.sock:
                raise ConnectionError("未连接")
            self.transaction_id = (self.transaction_id + 1) % 65536
            mbap = struct.pack('>HHHB', self.transaction_id, 0, len(pdu) + 1, unit_id)
            self.sock.sendall(mbap + pdu)
            header = self._recv_exact(7)
            resp_len = struct.unpack('>H', header[4:6])[0]
            return self._recv_exact(resp_len - 1)

    def _recv_exact(self, n):
        buf = b''
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("连接断开")
            buf += chunk
        return buf

    def read_coils(self, unit_id, address, count):
        pdu = struct.pack('>BHH', 0x01, address, count)
        data = self._send_receive(unit_id, pdu)
        if data[0] == 0x81:
            raise Exception(f"错误码 {data[1]}")
        bits = []
        for byte_val in data[2:2 + data[1]]:
            for bit in range(8):
                bits.append(bool(byte_val & (1 << bit)))
        return bits[:count]

    def write_single_coil(self, unit_id, address, value):
        pdu = struct.pack('>BHH', 0x05, address, 0xFF00 if value else 0x0000)
        data = self._send_receive(unit_id, pdu)
        if data[0] == 0x85:
            raise Exception(f"错误码 {data[1]}")

    def write_multiple_coils(self, unit_id, address, values):
        count = len(values)
        byte_count = (count + 7) // 8
        coil_bytes = [0] * byte_count
        for i, val in enumerate(values):
            if val:
                coil_bytes[i // 8] |= (1 << (i % 8))
        pdu = struct.pack('>BHHB', 0x0F, address, count, byte_count) + bytes(coil_bytes)
        data = self._send_receive(unit_id, pdu)
        if data[0] == 0x8F:
            raise Exception(f"错误码 {data[1]}")


# ========== 全局状态 ==========
connections = {}   # { ip: ModbusTCP 实例 }
dev_states = {}    # { ip: {"connected","unit_id","name","relay_states"} }
state_lock = threading.Lock()


def get_or_create_conn(ip):
    with state_lock:
        if ip not in connections:
            connections[ip] = ModbusTCP()
        return connections[ip]


# ========== 配置文件 ==========
def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
            # 向下兼容旧格式(纯数组)
            if isinstance(data, list):
                return {
                    "devices": data,
                    "lights": [],
                    "layout": {
                        "building": {"width": 60, "depth": 40, "wallH": 28, "ridgeH": 50},
                        "walls": [],
                        "zones": []
                    }
                }
            if isinstance(data, dict):
                layout = data.get("layout", {})
                return {
                    "devices": data.get("devices", []),
                    "lights": data.get("lights", []),
                    "layout": {
                        "building": layout.get("building", {"width": 60, "depth": 40, "wallH": 28, "ridgeH": 50}),
                        "walls": layout.get("walls", []),
                        "zones": layout.get("zones", [])
                    }
                }
        except:
            pass
    return {
        "devices": [{"name": "默认设备", "ip": "192.168.1.100", "port": 502, "unit_id": 254}],
        "lights": [],
        "layout": {
            "building": {"width": 60, "depth": 40, "wallH": 28, "ridgeH": 50},
            "walls": [],
            "zones": []
        }
    }


def save_config(config):
    try:
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        return True
    except:
        return False


# ========== HTTP 处理器 ==========
class Handler(http.server.SimpleHTTPRequestHandler):
    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length).decode('utf-8'))

    def log_message(self, format, *args):
        pass

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/" or path == "/index.html":
            self.path = "/index.html"
            return super().do_GET()

        if path == "/api/config":
            self._send_json(load_config())
            return

        if path == "/api/status":
            result = {}
            with state_lock:
                items = list(dev_states.items())
            for ip, st in items:
                if st.get("connected"):
                    try:
                        conn = connections.get(ip)
                        states = conn.read_coils(st["unit_id"], 0, 16)
                        with state_lock:
                            st["relay_states"] = states
                        result[ip] = {
                            "connected": True,
                            "name": st.get("name", ""),
                            "relay_states": states
                        }
                    except Exception as e:
                        with state_lock:
                            st["connected"] = False
                        result[ip] = {
                            "connected": False,
                            "name": st.get("name", ""),
                            "relay_states": st.get("relay_states", [False] * 16),
                            "error": str(e)
                        }
                else:
                    result[ip] = {
                        "connected": False,
                        "name": st.get("name", ""),
                        "relay_states": st.get("relay_states", [False] * 16)
                    }
            self._send_json({"devices": result})
            return

        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            if path == "/api/connect":
                body = self._read_body()
                ip = body["ip"]
                port = int(body["port"])
                unit_id = int(body["unit_id"])
                name = body.get("name", "")

                conn = get_or_create_conn(ip)
                if conn.connect(ip, port):
                    states = conn.read_coils(unit_id, 0, 16)
                    with state_lock:
                        dev_states[ip] = {
                            "connected": True,
                            "unit_id": unit_id,
                            "name": name,
                            "relay_states": states
                        }
                    self._send_json({"ok": True, "ip": ip, "relay_states": states})
                else:
                    self._send_json({"ok": False, "error": "连接失败"})

            elif path == "/api/disconnect":
                body = self._read_body()
                ip = body.get("ip")
                if ip:
                    conn = connections.get(ip)
                    if conn:
                        conn.close()
                    with state_lock:
                        if ip in dev_states:
                            dev_states[ip]["connected"] = False
                else:
                    # ip 为空 = 断开全部
                    with state_lock:
                        ips = list(connections.keys())
                    for _ip in ips:
                        try:
                            connections[_ip].close()
                        except:
                            pass
                        with state_lock:
                            if _ip in dev_states:
                                dev_states[_ip]["connected"] = False
                self._send_json({"ok": True})

            elif path == "/api/toggle":
                body = self._read_body()
                ip = body["ip"]
                channel = int(body["channel"])
                value = bool(body["value"])

                conn = connections.get(ip)
                with state_lock:
                    st = dev_states.get(ip)
                    connected = bool(st and st.get("connected"))
                if not conn or not connected:
                    self._send_json({"ok": False, "error": "设备未连接"})
                    return

                conn.write_single_coil(st["unit_id"], channel, value)
                with state_lock:
                    st["relay_states"][channel] = value
                self._send_json({"ok": True})

            elif path == "/api/batch":
                body = self._read_body()
                ip = body["ip"]
                start = int(body["start"])
                end = int(body["end"])
                value = bool(body["value"])

                conn = connections.get(ip)
                with state_lock:
                    st = dev_states.get(ip)
                    connected = bool(st and st.get("connected"))
                if not conn or not connected:
                    self._send_json({"ok": False, "error": "设备未连接"})
                    return

                conn.write_multiple_coils(st["unit_id"], start,
                                          [value] * (end - start))
                with state_lock:
                    for i in range(start, end):
                        st["relay_states"][i] = value
                self._send_json({"ok": True})

            elif path == "/api/config":
                body = self._read_body()
                config = {
                    "devices": body.get("devices", []),
                    "lights": body.get("lights", []),
                    "layout": {
                        "building": body.get("layout", {}).get("building", {"width": 60, "depth": 40, "wallH": 28, "ridgeH": 50}),
                        "walls": body.get("layout", {}).get("walls", []),
                        "zones": body.get("layout", {}).get("zones", [])
                    }
                }
                # 清理被删除设备的连接
                valid_ips = set(d["ip"] for d in config["devices"])
                with state_lock:
                    stale_ips = [ip for ip in list(connections.keys())
                                 if ip not in valid_ips]
                for ip in stale_ips:
                    try:
                        connections[ip].close()
                    except:
                        pass
                    with state_lock:
                        connections.pop(ip, None)
                        dev_states.pop(ip, None)

                if save_config(config):
                    self._send_json({"ok": True})
                else:
                    self._send_json({"ok": False, "error": "保存失败"})

            else:
                self._send_json({"error": "未知接口"}, 404)

        except Exception as e:
            self._send_json({"ok": False, "error": str(e)})


class ReusableThreadingTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    with ReusableThreadingTCPServer(("", PORT), Handler) as httpd:
        url = f"http://127.0.0.1:{PORT}"
        print(f"\n服务已启动: {url}")
        print("按 Ctrl+C 停止\n")
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止")


if __name__ == "__main__":
    main()
