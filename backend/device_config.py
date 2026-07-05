DEFAULT_DEVICE_PROTOCOL = "modbus_tcp"
DEFAULT_CHANNEL_COUNT = 32

PROTOCOL_DEFAULTS = {
    "modbus_tcp": {
        "port": 502,
        "unit_id": 254,
    },
    "siemens_s7": {
        "port": 102,
        "rack": 0,
        "slot": 1,
        "db_number": 1,
        "start_byte": 0,
    },
}


def _coerce_int(value, default, minimum=None, maximum=None):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default

    if minimum is not None:
        parsed = max(minimum, parsed)
    if maximum is not None:
        parsed = min(maximum, parsed)
    return parsed


def normalize_device_config(device):
    source = dict(device or {})
    protocol = source.get("protocol")
    if protocol not in PROTOCOL_DEFAULTS:
        protocol = DEFAULT_DEVICE_PROTOCOL

    defaults = PROTOCOL_DEFAULTS[protocol]
    normalized = {
        "name": str(source.get("name") or "默认设备"),
        "protocol": protocol,
        "channel_count": _coerce_int(
            source.get("channel_count"),
            DEFAULT_CHANNEL_COUNT,
            minimum=1,
            maximum=128,
        ),
    }

    if protocol == "siemens_s7":
        normalized.update(
            {
                "ip": str(source.get("ip") or "").strip(),
                "port": _coerce_int(source.get("port"), defaults["port"], minimum=1, maximum=65535),
                "rack": _coerce_int(source.get("rack"), defaults["rack"], minimum=0, maximum=7),
                "slot": _coerce_int(source.get("slot"), defaults["slot"], minimum=1, maximum=32),
                "db_number": _coerce_int(
                    source.get("db_number"),
                    defaults["db_number"],
                    minimum=1,
                    maximum=65535,
                ),
                "start_byte": _coerce_int(
                    source.get("start_byte"),
                    defaults["start_byte"],
                    minimum=0,
                    maximum=65535,
                ),
            }
        )
    else:
        normalized.update(
            {
                "ip": str(source.get("ip") or "").strip(),
                "port": _coerce_int(source.get("port"), defaults["port"], minimum=1, maximum=65535),
                "unit_id": _coerce_int(
                    source.get("unit_id"),
                    defaults["unit_id"],
                    minimum=0,
                    maximum=255,
                ),
            }
        )

    return normalized


def normalize_devices(devices):
    normalized = []
    for device in devices or []:
        if not isinstance(device, dict):
            continue
        next_device = normalize_device_config(device)
        if next_device["ip"]:
            normalized.append(next_device)
    return normalized
