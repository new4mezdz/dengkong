from pathlib import Path

from backend.device_config import DEFAULT_CHANNEL_COUNT


PORT = 8888
BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_FILE = BASE_DIR / "dam1600d_devices.json"

DEFAULT_BUILDING = {
    "width": 60,
    "depth": 40,
    "wallH": 28,
    "ridgeH": 50,
}

DEFAULT_CONFIG = {
    "devices": [
        {
            "name": "默认设备",
            "ip": "192.168.1.100",
            "protocol": "modbus_tcp",
            "port": 502,
            "unit_id": 254,
            "channel_count": DEFAULT_CHANNEL_COUNT,
        }
    ],
    "lights": [],
    "scenes": [],
    "layout": {
        "building": dict(DEFAULT_BUILDING),
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
