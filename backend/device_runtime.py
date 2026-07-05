import threading

from backend.device_clients import create_device_client
from backend.device_config import DEFAULT_CHANNEL_COUNT, normalize_device_config
from backend.settings import USAGE_FILE
from backend.usage_stats import UsageStats


STATUS_FAILURES_BEFORE_OFFLINE = 3


class DeviceRuntime:
    def __init__(self):
        self._clients = {}
        self._device_states = {}
        self._status_failures = {}
        self._lock = threading.Lock()
        self.usage = UsageStats(USAGE_FILE)

    def connect_device(self, device):
        device = normalize_device_config(device)
        if not device["ip"]:
            return {"ok": False, "error": "Device IP is required"}

        device_key = self._device_key(device["ip"])
        previous_state = self._get_state(device_key)
        previous_device = previous_state.get("device", {})
        if previous_device.get("protocol") and previous_device.get("protocol") != device["protocol"]:
            self._close_client(device_key)

        try:
            client = self._get_or_create_client(device)
            if not client.connect(device):
                raise ConnectionError("Connection failed")
            relay_states = client.read_relays(device)
            self._clear_status_failure(device_key)
            self.usage.observe(device_key, relay_states)
        except Exception as error:
            self._close_client(device_key)
            self._set_state(
                device_key,
                self._build_state(
                    device,
                    connected=False,
                    relay_states=previous_state.get("relay_states"),
                    error=str(error),
                ),
            )
            return {"ok": False, "error": str(error)}

        self._set_state(device_key, self._build_state(device, connected=True, relay_states=relay_states))
        return {"ok": True, "ip": device_key, "relay_states": relay_states}

    def disconnect_device(self, ip):
        device_key = self._device_key(ip)
        self._close_client(device_key)
        self._clear_status_failure(device_key)
        with self._lock:
            state = self._device_states.get(device_key)
            if state:
                state["connected"] = False
                state.pop("error", None)

    def disconnect_all(self):
        with self._lock:
            device_keys = list(set(self._clients.keys()) | set(self._device_states.keys()))

        for device_key in device_keys:
            self.disconnect_device(device_key)

    def refresh_status(self):
        result = {}
        with self._lock:
            items = list(self._device_states.items())

        for device_key, state in items:
            device = normalize_device_config(state.get("device", {}))
            relay_states = self._normalize_relays(device, state.get("relay_states"))
            if state.get("connected"):
                try:
                    relay_states = self._read_relays_with_reconnect(device, device_key)
                    self._clear_status_failure(device_key)
                    self.usage.observe(device_key, relay_states)
                    next_state = self._build_state(device, connected=True, relay_states=relay_states)
                    self._set_state(device_key, next_state)
                    result[device_key] = self._build_public_state(next_state)
                except Exception as error:
                    failure_count = self._record_status_failure(device_key)
                    connected = failure_count < STATUS_FAILURES_BEFORE_OFFLINE
                    if not connected:
                        self._close_client(device_key)
                    next_state = self._build_state(
                        device,
                        connected=connected,
                        relay_states=relay_states,
                        error=str(error),
                    )
                    self._set_state(device_key, next_state)
                    result[device_key] = self._build_public_state(next_state)
            else:
                result[device_key] = self._build_public_state(
                    self._build_state(
                        device,
                        connected=False,
                        relay_states=relay_states,
                        error=state.get("error"),
                    )
                )

        return {"devices": result}

    def toggle_channel(self, ip, channel, value):
        client, state = self._require_connected(ip)
        device = state["device"]
        self._validate_channel_range(device, channel, channel + 1)
        self._write_with_reconnect(
            ip,
            client,
            device,
            lambda active_client: active_client.write_relay(device, channel, value),
        )
        with self._lock:
            state["relay_states"][channel] = value
            states_copy = list(state["relay_states"])
        self.usage.observe(self._device_key(ip), states_copy)
        return {"ok": True}

    def batch_toggle(self, ip, start, end, value):
        client, state = self._require_connected(ip)
        device = state["device"]
        self._validate_channel_range(device, start, end)
        values = [value] * (end - start)
        self._write_with_reconnect(
            ip,
            client,
            device,
            lambda active_client: active_client.write_relays(device, start, values),
        )
        with self._lock:
            for index in range(start, end):
                state["relay_states"][index] = value
            states_copy = list(state["relay_states"])
        self.usage.observe(self._device_key(ip), states_copy)
        return {"ok": True}

    def usage_snapshot(self):
        return self.usage.snapshot()

    def prune_devices(self, valid_ips):
        with self._lock:
            stale_ips = [
                ip
                for ip in list(set(self._clients.keys()) | set(self._device_states.keys()))
                if ip not in valid_ips
            ]

        for ip in stale_ips:
            self._close_client(ip)
            self._clear_status_failure(ip)
            with self._lock:
                self._device_states.pop(ip, None)

    def _get_or_create_client(self, device):
        device_key = self._device_key(device["ip"])
        with self._lock:
            client = self._clients.get(device_key)
            if client is None:
                client = create_device_client(device["protocol"])
                self._clients[device_key] = client
            return client

    def _read_relays_with_reconnect(self, device, device_key):
        with self._lock:
            client = self._clients.get(device_key)
        if client is None:
            client = self._get_or_create_client(device)
            if not client.connect(device):
                raise ConnectionError("Connection failed")

        try:
            return client.read_relays(device)
        except Exception as first_error:
            self._close_client(device_key)
            client = self._get_or_create_client(device)
            try:
                if not client.connect(device):
                    raise ConnectionError("Connection failed")
                return client.read_relays(device)
            except Exception:
                self._close_client(device_key)
                raise first_error

    def _write_with_reconnect(self, ip, client, device, write_action):
        try:
            write_action(client)
            self._clear_status_failure(self._device_key(ip))
            return
        except Exception as first_error:
            device_key = self._device_key(ip)
            self._close_client(device_key)
            client = self._get_or_create_client(device)
            try:
                if not client.connect(device):
                    raise ConnectionError("Connection failed")
                write_action(client)
                self._clear_status_failure(device_key)
            except Exception:
                self._close_client(device_key)
                raise first_error

    def _require_connected(self, ip):
        device_key = self._device_key(ip)
        with self._lock:
            state = self._device_states.get(device_key)
            client = self._clients.get(device_key)
            connected = bool(state and state.get("connected"))
        if not connected:
            raise RuntimeError("Device is not connected")
        if not client:
            client = self._get_or_create_client(state["device"])
            if not client.connect(state["device"]):
                raise RuntimeError("Device is not connected")
        return client, state

    def _build_state(self, device, connected, relay_states=None, error=None):
        device = normalize_device_config(device)
        state = {
            "connected": connected,
            "name": device.get("name", ""),
            "protocol": device.get("protocol", ""),
            "device": device,
            "relay_states": self._normalize_relays(device, relay_states),
        }
        if error:
            state["error"] = error
        return state

    def _build_public_state(self, state):
        payload = {
            "connected": bool(state.get("connected")),
            "name": state.get("name", ""),
            "protocol": state.get("protocol", ""),
            "relay_states": list(state.get("relay_states", [])),
        }
        if state.get("error"):
            payload["error"] = state["error"]
        return payload

    def _normalize_relays(self, device, relay_states):
        count = int(device.get("channel_count") or DEFAULT_CHANNEL_COUNT)
        next_states = list(relay_states or [])
        if len(next_states) < count:
            next_states.extend([False] * (count - len(next_states)))
        elif len(next_states) > count:
            next_states = next_states[:count]
        return next_states

    def _validate_channel_range(self, device, start, end):
        count = int(device.get("channel_count") or DEFAULT_CHANNEL_COUNT)
        if start < 0 or end <= start or end > count:
            raise ValueError("Channel range exceeds the configured device capacity")

    def _close_client(self, device_key):
        with self._lock:
            client = self._clients.pop(device_key, None)
        if client:
            try:
                client.close()
            except Exception:
                pass

    def _get_state(self, device_key):
        with self._lock:
            state = self._device_states.get(device_key)
            return dict(state) if state else {}

    def _set_state(self, device_key, state):
        with self._lock:
            self._device_states[device_key] = state

    def _record_status_failure(self, device_key):
        with self._lock:
            count = self._status_failures.get(device_key, 0) + 1
            self._status_failures[device_key] = count
            return count

    def _clear_status_failure(self, device_key):
        with self._lock:
            self._status_failures.pop(device_key, None)

    def _device_key(self, ip):
        return str(ip or "").strip()
