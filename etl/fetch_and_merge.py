# -*- coding: utf-8 -*-
import os, json, math, traceback, ast
from datetime import datetime, timedelta, timezone, date
from dateutil import tz
import pandas as pd
import requests

# ===== Config =====
LAT, LON = 16.3500, 107.9000
LOCAL_TZ = tz.gettz("Asia/Ho_Chi_Minh")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))  # trỏ lên root repo
DATA_DIR = os.path.join(ROOT, "data")
SITE_DIR = os.path.join(ROOT, "site")
os.makedirs(DATA_DIR, exist_ok=True); os.makedirs(SITE_DIR, exist_ok=True)
HISTORY_CSV = os.path.join(DATA_DIR, "history.csv")
SITE_JSON   = os.path.join(SITE_DIR, "data.json")

SG_BASE = "https://api.stormglass.io/v2"
SG_KEYS = [os.getenv("STORMGLASS_KEY_1",""),
           os.getenv("STORMGLASS_KEY_2",""),
           os.getenv("STORMGLASS_KEY_3","")]

REQ_COLS = ["Vietnam Date","Lunar Date","Tidal Data","Pressure Data",
            "Sea Level","Water Temperature","Wind Speed","Wind Direction","Wave Height",
            "App Fishing Score","User Fishing Score","Fish Caught","User Notes","Pressure"]

# ===== Time helpers =====
def today_local() -> date: return datetime.now(LOCAL_TZ).date()
def ddmmyyyy(d: date) -> str: return d.strftime("%d/%m/%Y")
def parse_ddmmyyyy(s: str) -> date: return datetime.strptime(s.strip(), "%d/%m/%Y").date()
def to_utc_iso(dt_local: datetime) -> str:
    if dt_local.tzinfo is None: dt_local = dt_local.replace(tzinfo=LOCAL_TZ)
    return dt_local.astimezone(timezone.utc).isoformat()
def iso_to_local(iso):
    if isinstance(iso, str) and iso.endswith("Z"): iso = iso[:-1] + "+00:00"
    return datetime.fromisoformat(iso).astimezone(LOCAL_TZ).isoformat()
def iso_to_ddmmyyyy(iso):
    if isinstance(iso, str) and iso.endswith("Z"): iso = iso[:-1] + "+00:00"
    return datetime.fromisoformat(iso).astimezone(LOCAL_TZ).strftime("%d/%m/%Y")

# ===== Lunar (fallback nếu thiếu lib) =====
def lunar_ddmm(d: date) -> str:
    try:
        from lunarcalendar import Converter, Solar
        solar = Solar(d.year, d.month, d.day); lunar = Converter.Solar2Lunar(solar)
        return f"{lunar.day:02d}/{lunar.month:02d}"
    except Exception:
        return f"{d.day:02d}/{d.month:02d}"

# ===== CSV IO =====
def load_hist():
    if not os.path.exists(HISTORY_CSV): return pd.DataFrame(columns=REQ_COLS)
    df = pd.read_csv(HISTORY_CSV, dtype=str, keep_default_na=False).fillna("")
    for c in REQ_COLS:
        if c not in df.columns: df[c] = ""
    return df

def save_hist(df: pd.DataFrame):
    df = df.copy()
    df["_d"] = df["Vietnam Date"].apply(parse_ddmmyyyy)
    df = df.sort_values("_d").drop(columns=["_d"])
    df.to_csv(HISTORY_CSV, index=False)

def missing_dates(df: pd.DataFrame):
    today = today_local()
    if df.empty: start = today - timedelta(days=7)
    else:
        try: start = df["Vietnam Date"].apply(parse_ddmmyyyy).max() + timedelta(days=1)
        except: start = today - timedelta(days=7)
    if start > today: return []
    cur, out = start, []
    while cur <= today: out.append(cur); cur += timedelta(days=1)
    return out

# ===== HTTP =====
def sg_get(path, params):
    last = None
    for i, key in enumerate([k for k in SG_KEYS if k]):
        try:
            r = requests.get(f"{SG_BASE}{path}", headers={"Authorization": key}, params=params, timeout=60)
            if 200 <= r.status_code < 300: return r.json()
            last = f"[Key#{i+1}] HTTP {r.status_code}: {r.text[:200]}"
        except Exception as e:
            last = f"[Key#{i+1}] {e}"
    raise RuntimeError(last or "No API key")

# ===== Fetchers =====
def fetch_tide(start_d: date, end_d: date):
    sdt = datetime.combine(start_d, datetime.min.time()).replace(tzinfo=LOCAL_TZ)
    edt = datetime.combine(end_d, datetime.max.time()).replace(tzinfo=LOCAL_TZ)
    j = sg_get("/tide/extremes/point", {"lat": LAT,"lng": LON,"start": to_utc_iso(sdt),"end": to_utc_iso(edt)})
    return j.get("data", [])

def fetch_weather(start_d: date, end_d: date):
    sdt = datetime.combine(start_d, datetime.min.time()).replace(tzinfo=LOCAL_TZ)
    edt = datetime.combine(end_d, datetime.max.time()).replace(tzinfo=LOCAL_TZ)
    params = "pressure,waterTemperature,windSpeed,windDirection,waveHeight,seaLevel"
    j = sg_get("/weather/point", {
        "lat": LAT, "lng": LON, "params": params,
        "source": "noaa", "start": to_utc_iso(sdt), "end": to_utc_iso(edt)
    })
    return j.get("hours", [])

# ===== Aggregations =====
def mean(vals):
    arr = [float(v) for v in vals if v is not None and math.isfinite(float(v))]
    return sum(arr)/len(arr) if arr else None

def circular_mean_deg(deg_list):
    arr = [float(v) for v in deg_list if v is not None and math.isfinite(float(v))]
    if not arr: return None
    x = sum(math.cos(math.radians(a)) for a in arr)
    y = sum(math.sin(math.radians(a)) for a in arr)
    ang = math.degrees(math.atan2(y, x))
    if ang < 0: ang += 360
    return ang

# ===== Build rows for history (new days) =====
def rows_for(miss, tides, hours):
    tide_by = {}
    for x in tides:
        d = iso_to_ddmmyyyy(x["time"])
        tide_by.setdefault(d, []).append({"time": iso_to_local(x["time"]),
                                          "height": x.get("height"), "type": x.get("type")})

    # group hourly values by day
    g = {}
    for h in hours:
        d = iso_to_ddmmyyyy(h["time"])
        def pick(name):
            v = h.get(name)
            if isinstance(v, dict): v = v.get("noaa")
            try:
                f = float(v)
                return f if math.isfinite(f) else None
            except: return None
        rec = g.setdefault(d, {"pressure":[], "wt":[], "ws":[], "wd":[], "wh":[], "sl":[] , "pres_series":[]})
        rec["pres_series"].append({"time": iso_to_local(h["time"]), "pressure": pick("pressure")})
        rec["wt"].append(pick("waterTemperature"))
        rec["ws"].append(pick("windSpeed"))
        rec["wd"].append(pick("windDirection"))
        rec["wh"].append(pick("waveHeight"))
        rec["sl"].append(pick("seaLevel"))

    out = []
    for d in miss:
        ds = ddmmyyyy(d)
        gg = g.get(ds, {})
        sea  = mean(gg.get("sl",[]))
        wt   = mean(gg.get("wt",[]))
        ws   = mean(gg.get("ws",[]))
        wd   = circular_mean_deg(gg.get("wd",[]))
        wh   = mean(gg.get("wh",[]))
        pres_series = [p for p in gg.get("pres_series",[]) if p["pressure"] is not None]

        out.append({
            "Vietnam Date": ds,
            "Lunar Date":   lunar_ddmm(d),
            "Tidal Data":   str(tide_by.get(ds, [])),
            "Pressure Data":str(pres_series),
            "Sea Level": "" if sea is None else f"{sea:.4f}",
            "Water Temperature": "" if wt is None else f"{wt:.4f}",
            "Wind Speed": "" if ws is None else f"{ws:.4f}",
            "Wind Direction": "" if wd is None else f"{wd:.4f}",
            "Wave Height": "" if wh is None else f"{wh:.4f}",
            "App Fishing Score":"","User Fishing Score":"","Fish Caught":"","User Notes":"","Pressure":""
        })
    return pd.DataFrame(out) if out else None

# ===== Forecast build (also with daily means) =====
def build_forecast(start_d: date, end_d: date):
    tides = fetch_tide(start_d, end_d)
    hours = fetch_weather(start_d, end_d)

    tide_by = {}
    for x in tides:
        d = iso_to_ddmmyyyy(x["time"])
        tide_by.setdefault(d, []).append({"time": iso_to_local(x["time"]),
                                          "height": x.get("height"), "type": x.get("type")})
    g = {}
    for h in hours:
        d = iso_to_ddmmyyyy(h["time"])
        def pick(name):
            v = h.get(name);  v = v.get("noaa") if isinstance(v, dict) else v
            try: f=float(v);  return f if math.isfinite(f) else None
            except: return None
        rec = g.setdefault(d, {"pressure":[], "wt":[], "ws":[], "wd":[], "wh":[], "sl":[], "pres_series":[]})
        rec["pres_series"].append({"time": iso_to_local(h["time"]), "pressure": pick("pressure")})
        rec["wt"].append(pick("waterTemperature"))
        rec["ws"].append(pick("windSpeed"))
        rec["wd"].append(pick("windDirection"))
        rec["wh"].append(pick("waveHeight"))
        rec["sl"].append(pick("seaLevel"))

    out, cur = [], start_d
    while cur <= end_d:
        ds = ddmmyyyy(cur); gg = g.get(ds, {})
        sea  = mean(gg.get("sl",[])); wt = mean(gg.get("wt",[])); ws = mean(gg.get("ws",[]))
        wd   = circular_mean_deg(gg.get("wd",[])); wh = mean(gg.get("wh",[]))
        pres_series = [p for p in gg.get("pres_series",[]) if p["pressure"] is not None]
        out.append({
            "vietnam_date": ds, "lunar_date": lunar_ddmm(cur), "is_forecast": True,
            "tidal_data": tide_by.get(ds, []), "pressure_data": pres_series,
            "sea_level": sea, "water_temperature": wt, "wind_speed": ws,
            "wind_direction": wd, "wave_height": wh
        })
        cur += timedelta(days=1)
    return out

# ===== Export site/data.json =====
def export_json(df: pd.DataFrame, forecast: list):
    def parse_list(s):
        if not s: return []
        try: return ast.literal_eval(s)
        except: return []
    days = []
    for _, r in df.iterrows():
        days.append({
            "vietnam_date": r["Vietnam Date"],
            "lunar_date":   r["Lunar Date"],
            "tidal_data":   parse_list(r["Tidal Data"]),
            "pressure_data":parse_list(r["Pressure Data"]),
            "sea_level": float(r["Sea Level"]) if r["Sea Level"] else None,
            "water_temperature": float(r["Water Temperature"]) if r["Water Temperature"] else None,
            "wind_speed": float(r["Wind Speed"]) if r["Wind Speed"] else None,
            "wind_direction": float(r["Wind Direction"]) if r["Wind Direction"] else None,
            "wave_height": float(r["Wave Height"]) if r["Wave Height"] else None,
            "is_forecast":  False
        })
    # sort + nối forecast
    def k(x): return parse_ddmmyyyy(x["vietnam_date"])
    days = sorted(days, key=k)
    all_days = sorted(days + (forecast or []), key=k)
    with open(SITE_JSON, "w", encoding="utf-8") as f:
        json.dump({"meta":{"generated_at": datetime.now(LOCAL_TZ).isoformat(),
                           "rows": len(all_days)},
                   "days": all_days}, f, ensure_ascii=False, indent=2)

# ===== Main =====
def main():
    try:
        df = load_hist()
        miss = missing_dates(df)
        if miss:
            s, e = miss[0], miss[-1]
            add = rows_for(miss, fetch_tide(s,e), fetch_weather(s,e))
            if add is not None:
                df = pd.concat([df, add], ignore_index=True)
                save_hist(df)

        s_fc = today_local() + timedelta(days=1)
        e_fc = s_fc + timedelta(days=9)
        forecast = build_forecast(s_fc, e_fc)

        export_json(df, forecast)
        print(f"[OK] history={len(df)} forecast={len(forecast)} → {SITE_JSON}")
    except Exception as e:
        with open(SITE_JSON,"w",encoding="utf-8") as f:
            json.dump({"error": f"{e}\n{traceback.format_exc()}"}, f, ensure_ascii=False, indent=2)
        raise

if __name__ == "__main__":
    main()
