import copy
import json

from backend.device_config import normalize_devices
from backend.settings import CONFIG_FILE, DEFAULT_BUILDING, DEFAULT_CONFIG


class ConfigStore:
    def __init__(self, config_path=CONFIG_FILE):
        self.config_path = config_path

    def load(self):
        if self.config_path.exists():
            try:
                with self.config_path.open("r", encoding="utf-8") as handle:
                    data = json.load(handle)
                return self._normalize_loaded_data(data)
            except Exception:
                pass
        return copy.deepcopy(DEFAULT_CONFIG)

    def save(self, config):
        try:
            with self.config_path.open("w", encoding="utf-8") as handle:
                json.dump(config, handle, ensure_ascii=False, indent=2)
            return True
        except Exception:
            return False

    def build_config(self, payload):
        layout = payload.get("layout", {})
        return {
            "devices": normalize_devices(payload.get("devices", [])),
            "lights": payload.get("lights", []),
            "scenes": payload.get("scenes", []),
            "layout": {
                "building": layout.get("building", copy.deepcopy(DEFAULT_BUILDING)),
                "walls": layout.get("walls", []),
                "zones": layout.get("zones", []),
                "pillars": layout.get("pillars", []),
                "doors": layout.get("doors", []),
                "paths": layout.get("paths", []),
                "workstations": layout.get("workstations", []),
                "racks": layout.get("racks", []),
                "safetyStations": layout.get("safetyStations", []),
            },
        }

    def _normalize_loaded_data(self, data):
        if isinstance(data, list):
            return {
                "devices": normalize_devices(data),
                "lights": [],
                "scenes": [],
                "layout": {
                    "building": copy.deepcopy(DEFAULT_BUILDING),
                    "walls": [],
                    "zones": [],
                    "pillars": [],
                    "doors": [],
                    "paths": [],
                    "workstations": [],
                    "racks": [],
                    "safetyStations": [],
                },
            }

        if isinstance(data, dict):
            layout = data.get("layout", {})
            return {
                "devices": normalize_devices(data.get("devices", [])),
                "lights": data.get("lights", []),
                "scenes": data.get("scenes", []),
                "layout": {
                    "building": layout.get("building", copy.deepcopy(DEFAULT_BUILDING)),
                    "walls": layout.get("walls", []),
                    "zones": layout.get("zones", []),
                    "pillars": layout.get("pillars", []),
                    "doors": layout.get("doors", []),
                    "paths": layout.get("paths", []),
                    "workstations": layout.get("workstations", []),
                    "racks": layout.get("racks", []),
                    "safetyStations": layout.get("safetyStations", []),
                },
            }

        return copy.deepcopy(DEFAULT_CONFIG)
