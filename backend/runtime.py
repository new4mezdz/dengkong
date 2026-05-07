import threading

from backend.modbus import ModbusTCP


class DeviceRuntime:
    def __init__(self):
        self._connections = {}
        self._device_states = {}
        self._lock = threading.Lock()

    def connect_device(self, ip, port, unit_id, name=""):
        connection = self._get_or_create_connection(ip)
        if not connection.connect(ip, port):
            return {"ok": False, "error": "连接失败"}

        states = connection.read_coils(unit_id, 0, 16)
        with self._lock:
            self._device_states[ip] = {
                "connected": True,
                "unit_id": unit_id,
                "name": name,
                "relay_states": states,
            }
        return {"ok": True, "ip": ip, "relay_states": states}

    def disconnect_device(self, ip):
        connection = self._connections.get(ip)
        if connection:
            connection.close()
        with self._lock:
            if ip in self._device_states:
                self._device_states[ip]["connected"] = False

    def disconnect_all(self):
        with self._lock:
            ips = list(self._connections.keys())
        for ip in ips:
            try:
                self._connections[ip].close()
            except Exception:
                pass
            with self._lock:
                if ip in self._device_states:
                    self._device_states[ip]["connected"] = False

    def refresh_status(self):
        result = {}
        with self._lock:
            items = list(self._device_states.items())

        for ip, state in items:
            if state.get("connected"):
                try:
                    connection = self._connections.get(ip)
                    states = connection.read_coils(state["unit_id"], 0, 16)
                    with self._lock:
                        state["relay_states"] = states
                    result[ip] = {
                        "connected": True,
                        "name": state.get("name", ""),
                        "relay_states": states,
                    }
                except Exception as error:
                    with self._lock:
                        state["connected"] = False
                    result[ip] = {
                        "connected": False,
                        "name": state.get("name", ""),
                        "relay_states": state.get("relay_states", [False] * 16),
                        "error": str(error),
                    }
            else:
                result[ip] = {
                    "connected": False,
                    "name": state.get("name", ""),
                    "relay_states": state.get("relay_states", [False] * 16),
                }

        return {"devices": result}

    def toggle_channel(self, ip, channel, value):
        connection, state = self._require_connected(ip)
        connection.write_single_coil(state["unit_id"], channel, value)
        with self._lock:
            state["relay_states"][channel] = value
        return {"ok": True}

    def batch_toggle(self, ip, start, end, value):
        connection, state = self._require_connected(ip)
        connection.write_multiple_coils(state["unit_id"], start, [value] * (end - start))
        with self._lock:
            for index in range(start, end):
                state["relay_states"][index] = value
        return {"ok": True}

    def prune_devices(self, valid_ips):
        with self._lock:
            stale_ips = [ip for ip in list(self._connections.keys()) if ip not in valid_ips]

        for ip in stale_ips:
            try:
                self._connections[ip].close()
            except Exception:
                pass
            with self._lock:
                self._connections.pop(ip, None)
                self._device_states.pop(ip, None)

    def _get_or_create_connection(self, ip):
        with self._lock:
            if ip not in self._connections:
                self._connections[ip] = ModbusTCP()
            return self._connections[ip]

    def _require_connected(self, ip):
        connection = self._connections.get(ip)
        with self._lock:
            state = self._device_states.get(ip)
            connected = bool(state and state.get("connected"))
        if not connection or not connected:
            raise RuntimeError("设备未连接")
        return connection, state

