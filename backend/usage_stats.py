import atexit
import json
import os
import threading
import time
from datetime import date, datetime, timedelta


class UsageStats:
    """按 设备IP#通道 统计继电器(灯)的累计点亮时长与开关次数, 持久化为 JSON。

    计时规则: 每次观察(observe)时, 若某通道上次观察为"开", 把距上次观察的
    间隔累加到总时长和当天的按日桶(再处理本次的开关切换)。继电器在断线/服务
    重启期间物理上保持状态, 因此跨间隔仍计入, 整段归入观察当天。
    """

    SAVE_INTERVAL = 30.0
    DAILY_KEEP_DAYS = 35

    def __init__(self, path):
        self.path = path
        self._lock = threading.Lock()
        self._stats = {}
        self._last_save = 0.0
        self._load()
        atexit.register(self.save)

    def _load(self):
        try:
            with open(self.path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
            stats = data.get("stats") if isinstance(data, dict) else None
            if isinstance(stats, dict):
                self._stats = stats
        except Exception:
            self._stats = {}

    def save(self):
        with self._lock:
            payload = {"version": 1, "stats": self._stats}
            # 先写临时文件再原子替换, 避免崩溃/断电时截断导致全部历史丢失
            tmp_path = str(self.path) + ".tmp"
            try:
                with open(tmp_path, "w", encoding="utf-8") as handle:
                    json.dump(payload, handle, ensure_ascii=False)
                os.replace(tmp_path, self.path)
                self._last_save = time.time()
            except Exception:
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass

    def _entry(self, key):
        entry = self._stats.get(key)
        if not isinstance(entry, dict):
            entry = {
                "total_seconds": 0.0,
                "switch_count": 0,
                "on": False,
                "on_since": None,
                "last_seen": None,
                "daily": {},
            }
            self._stats[key] = entry
        return entry

    def _accrue(self, entry, now, today):
        last_seen = entry.get("last_seen")
        if not entry.get("on") or not isinstance(last_seen, (int, float)):
            return
        delta = now - last_seen
        if delta <= 0:
            return
        entry["total_seconds"] = float(entry.get("total_seconds") or 0.0) + delta
        daily = entry.setdefault("daily", {})
        daily[today] = float(daily.get(today) or 0.0) + delta

    def observe(self, device_ip, relay_states):
        now = time.time()
        today = date.today().isoformat()
        transition = False
        with self._lock:
            for channel, state in enumerate(relay_states or []):
                key = "%s#%d" % (device_ip, channel)
                entry = self._entry(key)
                self._accrue(entry, now, today)
                is_on = bool(state)
                was_on = bool(entry.get("on"))
                if is_on and not was_on:
                    entry["on"] = True
                    entry["on_since"] = now
                    entry["switch_count"] = int(entry.get("switch_count") or 0) + 1
                    transition = True
                elif not is_on and was_on:
                    entry["on"] = False
                    entry["on_since"] = None
                    transition = True
                entry["last_seen"] = now
            self._prune_daily(today)
        if transition or (time.time() - self._last_save) >= self.SAVE_INTERVAL:
            self.save()

    def _prune_daily(self, today):
        try:
            cutoff = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=self.DAILY_KEEP_DAYS)).date().isoformat()
        except Exception:
            return
        for entry in self._stats.values():
            if not isinstance(entry, dict):
                continue
            daily = entry.get("daily")
            if not isinstance(daily, dict):
                continue
            for day in [d for d in daily if d < cutoff]:
                daily.pop(day, None)

    def snapshot(self):
        now = time.time()
        today = date.today().isoformat()
        usage = {}
        with self._lock:
            for key, entry in self._stats.items():
                if not isinstance(entry, dict):
                    continue
                self._accrue(entry, now, today)
                if entry.get("on"):
                    entry["last_seen"] = now
                daily = entry.get("daily") or {}
                usage[key] = {
                    "total_seconds": round(float(entry.get("total_seconds") or 0.0), 1),
                    "today_seconds": round(float(daily.get(today) or 0.0), 1),
                    "switch_count": int(entry.get("switch_count") or 0),
                    "on": bool(entry.get("on")),
                    "on_since": entry.get("on_since"),
                    "daily": {str(d): round(float(v or 0.0), 1) for d, v in daily.items()},
                }
        return {"ok": True, "server_time": now, "today": today, "usage": usage}
