import os, json, requests, pandas as pd
from datetime import datetime, timedelta, timezone, date
from dateutil import tz
from lunarcalendar import Converter, Solar
import traceback
import math
import ast

# ===== Cấu hình =====
LAT = 16.3500
LON = 107.9000
LOCAL_TZ = tz.gettz("Asia/Ho_Chi_Minh")

ROOT = os.path.dirname(__file__)
HISTORY_CSV = os.path.join(ROOT, "..", "data", "history.csv")
SITE_JSON   = os.path.join(ROOT, "..", "site", "data.json")

# ===== Stormglass Keys (3 secrets, fallback lần lượt) =====
SG_BASE = "https://api.stormglass.io/v2"
SG_KEYS = [os.getenv("STORMGLASS_KEY_1", ""),
           os.getenv("STORMGLASS_KEY_2", ""),
           os.getenv("STORMGLASS_KEY_3", "")]

# ---------- Helpers thời gian ----------
def today_local_date() -> date:
    return datetime.now(LOCAL_TZ).date()

def to_utc_iso(dt_local: datetime) -> str:
    if dt_local.tzinfo is None:
        dt_local = dt_local.replace(tzinfo=LOCAL_TZ)
    return dt_local.astimezone(timezone.utc).isoformat()

def parse_ddmmyyyy(s: str) -> date:
    return datetime.strptime(str(s).strip(), "%d/%m/%Y").date()

def fmt_ddmmyyyy(d: date) -> str:
    return d.strftime("%d/%m/%Y")

def gregorian_to_lunar_ddmm(d: date) -> str:
    solar = Solar(d.year, d.month, d.day)
    lunar = Converter.Solar2Lunar(solar)
    return f"{lunar.day:02d}/{lunar.month:02d}"

# ---------- CSV IO ----------
def load_history(path: str) -> pd.DataFrame:
    cols = ["Vietnam Date","Lunar Date","Tidal Data","Pressure Data",
            "Sea Level","Water Temperature","Wind Speed","Wind Direction","Wave Height",
            "App Fishing Score","User Fishing Score","Fish Caught","User Notes","Pressure"]
    if not os.path.exists(path):
        return pd.DataFrame(columns=cols)
    df = pd.read_csv(path, dtype=str, keep_default_na=False, na_values=[])
    for c in cols:
        if c not in df.columns:
            df[c] = ""
    df = df.replace({"NaN": "", "nan": "", "NONE": "", "None": "", "NULL": "", "null": ""}).fillna("")
    return df

def save_history(df: pd.DataFrame, path: str):
    today = today_local_date()
    df["_d"] = df["Vietnam Date"].apply(parse_ddmmyyyy)
    df = df[df["_d"] <= today].copy().sort_values("_d").drop(columns=["_d"])
    df.to_csv(path, index=False)

def get_missing_dates(df: pd.DataFrame):
    today = today_local_date()
    if df.empty:
        start = today - timedelta(days=7)
    else:
        try:
            maxd = df["Vietnam Date"].apply(parse_ddmmyyyy).max()
        except Exception:
            maxd = today - timedelta(days=7)
        start = maxd + timedelta(days=1)
    if start > today:
        return []
    cur, res = start, []
    while cur <= today:
        res.append(cur)
        cur += timedelta(days=1)
    return res

# ---------- HTTP với fallback keys ----------
def sg_request(path: str, params: dict):
    last_err = None
    for idx, key in enumerate([k for k in SG_KEYS if k], start=1):
        try:
            url = f"{SG_BASE}{path}"
            r = requests.get(url, headers={"Authorization": key}, params=params, timeout=60)
            if 200 <= r.status_code < 300:
                return r.json()
            last_err = f"[Key#{idx}] HTTP {r.status_code}: {r.text[:200]}"
        except Exception as e:
            last_err = f"[Key#{idx}] {e}"
    raise RuntimeError(f"All Stormglass keys failed. Last error: {last_err}")

# ---------- Fetchers ----------
def fetch_tide_extremes(start_date: date, end_date: date):
    start_dt = datetime.combine(start_date, datetime.min.time()).replace(tzinfo=LOCAL_TZ)
    end_dt   = datetime.combine(end_date,   datetime.max.time()).replace(tzinfo=LOCAL_TZ)
    data = sg_request(
        "/tide/extremes/point",
        {"lat": LAT, "lng": LON, "start": to_utc_iso(start_dt), "end": to_utc_iso(end_dt)}
    )
    return data.get("data", [])

def fetch_weather_pressure(start_date: date, end_date: date):
    start_dt = datetime.combine(start_date, datetime.min.time()).replace(tzinfo=LOCAL_TZ)
    end_dt   = datetime.combine(end_date,   datetime.max.time()).replace(tzinfo=LOCAL_TZ)
    data = sg_request(
        "/weather/point",
        {
            "lat": LAT, "lng": LON, "params": "pressure",
            "start": to_utc_iso(start_dt), "end": to_utc_iso(end_dt),
            "source": "noaa"
        }
    )
    return data.get("hours", [])

def to_local_ddmmyyyy_from_iso(iso_s: str) -> str:
    if iso_s.endswith("Z"):
        iso_s = iso_s[:-1] + "+00:00"
    dt_utc = datetime.fromisoformat(iso_s)
    return dt_utc.astimezone(LOCAL_TZ).strftime("%d/%m/%Y")

def to_local_iso(iso_s: str) -> str:
    if iso_s.endswith("Z"):
        iso_s = iso_s[:-1] + "+00:00"
    dt_utc = datetime.fromisoformat(iso_s)
    return dt_utc.astimezone(LOCAL_TZ).isoformat()

# ---------- Build rows từ API cho phần MISSING (ghi CSV) ----------
def build_new_rows(missing_dates, tide_extremes, weather_hours):
    tide_by_day = {}
    for it in tide_extremes:
        d = to_local_ddmmyyyy_from_iso(it["time"])
        tide_by_day.setdefault(d, []).append({
            "height": it.get("height"),
            "time": to_local_iso(it["time"]),
            "type": it.get("type")
        })

    pres_by_day = {}
    for h in weather_hours:
        d = to_local_ddmmyyyy_from_iso(h["time"])
        val = h.get("pressure")
        if isinstance(val, dict):
            val = val.get("noaa")
        if val is None:
            continue
        try:
            fval = float(val)
        except Exception:
            continue
        if math.isfinite(fval):
            pres_by_day.setdefault(d, []).append({"time": to_local_iso(h["time"]), "pressure": fval})

    rows = []
    for d in missing_dates:
        dstr = fmt_ddmmyyyy(d)
        rows.append({
            "Vietnam Date": dstr,
            "Lunar Date":   gregorian_to_lunar_ddmm(d),
            "Tidal Data":   str(tide_by_day.get(dstr, [])),
            "Pressure Data":str(pres_by_day.get(dstr, [])),
            "Sea Level":"", "Water Temperature":"", "Wind Speed":"", "Wind Direction":"", "Wave Height":"",
            "App Fishing Score":"", "User Fishing Score":"", "Fish Caught":"", "User Notes":"", "Pressure":""
        })
    if not rows:
        return None
    return pd.DataFrame(rows)

# ---------- Xuất site/data.json (lịch sử + forecast) ----------
def export_site_json(df_history: pd.DataFrame, forecast_days: list | None = None, error_msg: str | None = None):
    def parse_repr(s):
        if not isinstance(s, str) or not s.strip():
            return []
        try: return ast.literal_eval(s)
        except Exception: return []

    def clean_str(x):
        if x is None: return ""
        if isinstance(x, float) and (math.isnan(x) or math.isinf(x)): return ""
        s = str(x).strip()
        return "" if s.lower() in ("nan", "none", "na", "null") else s

    def clean_num(x):
        try:
            if x is None: return None
            f = float(x)
            if not math.isfinite(f): return None
            return round(f, 4)
        except Exception:
            return None

    if error_msg:
        with open(SITE_JSON, "w", encoding="utf-8") as f:
            json.dump({"error": error_msg}, f, ensure_ascii=False, indent=2)
        return

    try:
        df = df_history.copy()
        df["_d"] = df["Vietnam Date"].apply(parse_ddmmyyyy)
        df = df[df["_d"] <= today_local_date()].sort_values("_d").drop(columns=["_d"])
        df = df.fillna("").replace({"NaN":"","nan":"","NONE":"","None":"","NULL":"","null":""})

        days_out = []
        for _, row in df.iterrows():
            tidal_list = parse_repr(row.get("Tidal Data", ""))
            press_list = parse_repr(row.get("Pressure Data", ""))

            tidal_data, pressure_data = [], []
            for item in tidal_list or []:
                if isinstance(item, dict):
                    tidal_data.append({
                        "time":   clean_str(item.get("time")),
                        "height": clean_num(item.get("height")),
                        "type":   clean_str(item.get("type")),
                    })
            for item in press_list or []:
                if isinstance(item, dict):
                    pressure_data.append({
                        "time":     clean_str(item.get("time")),
                        "pressure": clean_num(item.get("pressure")),
                    })

            days_out.append({
                "vietnam_date": clean_str(row.get("Vietnam Date")),
                "lunar_date":   clean_str(row.get("Lunar Date")),
                "tidal_data":   tidal_data,
                "pressure_data":pressure_data,
                "is_forecast":  False
            })

        payload = {
            "meta": {
                "generated_at": datetime.now(LOCAL_TZ).isoformat(),
                "rows": len(days_out),
            },
            "days": days_out,
        }

        # —— gắn forecast (nếu có) —— 
        if forecast_days:
            payload["forecast"] = forecast_days

        with open(SITE_JSON, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2, allow_nan=False)

    except Exception:
        msg = "ETL error:\n" + traceback.format_exc()
        with open(SITE_JSON, "w", encoding="utf-8") as f:
            json.dump({"error": msg}, f, ensure_ascii=False, indent=2)
        raise

# ---------- Build forecast (không ghi CSV) ----------
def build_forecast_days(start_d: date, end_d: date):
    tide = fetch_tide_extremes(start_d, end_d)
    pres = fetch_weather_pressure(start_d, end_d)

    # group by dd/MM/yyyy
    def group_tide():
        res = {}
        for it in tide:
            d = to_local_ddmmyyyy_from_iso(it["time"])
            res.setdefault(d, []).append({
                "time": to_local_iso(it["time"]),
                "height": it.get("height"),
                "type": it.get("type"),
            })
        return res

    def group_pres():
        res = {}
        for h in pres:
            d = to_local_ddmmyyyy_from_iso(h["time"])
            val = h.get("pressure")
            if isinstance(val, dict): val = val.get("noaa")
            try:
                f = float(val)
                if math.isfinite(f):
                    res.setdef
