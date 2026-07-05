import json
import threading
import time
import urllib.request

CITY_NAME = "西昌"
LATITUDE = 27.8983
LONGITUDE = 102.2641
API_URL = (
    "https://api.open-meteo.com/v1/forecast"
    "?latitude=27.8983&longitude=102.2641"
    "&current_weather=true"
    "&daily=temperature_2m_max,temperature_2m_min"
    "&timezone=Asia%2FShanghai&forecast_days=1"
)
REQUEST_TIMEOUT = 6
CACHE_TTL = 600.0
FAILURE_BACKOFF = 60.0  # 上游失败后的重试退避, 期间直接返回旧缓存/错误, 避免每次请求都阻塞 6 秒

WEATHER_CODE_TEXT = {
    0: "晴",
    1: "晴间多云",
    2: "多云",
    3: "阴",
    45: "雾",
    48: "雾凇",
    51: "毛毛雨",
    53: "毛毛雨",
    55: "毛毛雨",
    56: "冻雨",
    57: "冻雨",
    61: "小雨",
    63: "中雨",
    65: "大雨",
    66: "冻雨",
    67: "冻雨",
    71: "小雪",
    73: "中雪",
    75: "大雪",
    77: "霰",
    80: "阵雨",
    81: "阵雨",
    82: "强阵雨",
    85: "阵雪",
    86: "阵雪",
    95: "雷阵雨",
    96: "雷阵雨伴冰雹",
    99: "雷阵雨伴冰雹",
}

_cache_lock = threading.Lock()
_cache = {"data": None, "fetched_at": 0.0, "failed_at": 0.0, "last_error": ""}


def _fetch_weather():
    request = urllib.request.Request(API_URL, headers={"User-Agent": "dengkong/1.0"})
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:
        payload = json.loads(response.read().decode("utf-8"))

    current = payload.get("current_weather") or {}
    daily = payload.get("daily") or {}
    weather_code = current.get("weathercode")
    try:
        weather_code = int(weather_code)
    except (TypeError, ValueError):
        weather_code = None

    highs = daily.get("temperature_2m_max") or []
    lows = daily.get("temperature_2m_min") or []
    return {
        "ok": True,
        "city": CITY_NAME,
        "temperature": current.get("temperature"),
        "high": highs[0] if highs else None,
        "low": lows[0] if lows else None,
        "weather_code": weather_code,
        "weather_text": WEATHER_CODE_TEXT.get(weather_code, "—"),
        "updated_at": time.time(),
    }


def get_weather():
    now = time.time()
    with _cache_lock:
        cached = _cache["data"]
        if cached and (now - _cache["fetched_at"]) < CACHE_TTL:
            return dict(cached)
        # 退避窗口内不重试上游, 直接给旧缓存/错误, 避免每个请求都阻塞到超时
        if (now - _cache["failed_at"]) < FAILURE_BACKOFF:
            if cached:
                stale = dict(cached)
                stale["stale"] = True
                return stale
            return {"ok": False, "error": _cache["last_error"] or "weather upstream unavailable"}

        try:
            data = _fetch_weather()
        except Exception as error:
            _cache["failed_at"] = now
            _cache["last_error"] = str(error)
            if cached:
                stale = dict(cached)
                stale["stale"] = True
                return stale
            return {"ok": False, "error": str(error)}

        _cache["data"] = data
        _cache["fetched_at"] = now
        _cache["failed_at"] = 0.0
        return dict(data)
