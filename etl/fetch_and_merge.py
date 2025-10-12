# -*- coding: utf-8 -*-
import os, json, math, traceback
from datetime import datetime, timedelta, timezone, date
from dateutil import tz
import pandas as pd
import requests
import ast

# ==== Cấu hình khu vực ====
LAT = 16.3500
LON = 107.9000
LOCAL_TZ = tz.gettz("Asia/Ho_Chi_Minh")

HERE = os.path.abspath(os.path.dirname(__file__))
ROOT = os.path.abspath(os.path.join(HERE))           # script đặt ở repo root
DATA_DIR = os.path.join(ROOT, "data")
SITE_DIR = os.path.join(ROOT, "site")
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(SITE_DIR, exist_ok=True)

HISTORY_CSV = os.path.join(DATA_DIR, "history.csv")
SITE_JSON   = os.path.join(SITE_DIR, "data.json")

SG_BASE = "https://api.stormglass.io/v2"
SG_KEYS = [os.getenv("STORMGLASS_KEY_1",""),
           os.getenv("STORMGLASS_KEY_2",""),
           os.getenv("STORMGLASS_KEY_3","")]

# ==== Helpers thời gian ====
def today_local() -> date:
    return datetime.now(LOCAL_TZ).date()

def to_utc_iso(dt_local: datetime) -> str:
    if dt_local.tzinfo is None:
        dt_local = dt_local.replace(tzinfo=LOCAL_TZ)
    return dt_local.astimezone(timezone.utc).isoformat()

def ddmmyyyy(d: date) -> str:
    return d.strftime("%d/%m/%Y")

def parse_ddmmyyyy(s: str) -> date:
    return datetime.strptime(s.strip(), "%d/%m/%Y").date()

# ==== Lunar (đơn giản hoá – nếu không có lunarcalendar vẫn chạy) ====
def lunar_ddmm(d: date) -> str:
    try:
        from lunarcalendar import Converter, Solar
        solar = Solar(d.year, d.month, d.day)
        lunar = Converter.Solar2Lunar(solar)
        return f"{lunar.day:02d}/{lunar.month:02d}"
    except Exception:
        # fallback (placeholder): cùng ngày/tháng
        return f"{d.day:02d}/{d.month:02d}"

# ==== IO CSV ====
REQ_COLS = ["Vietnam Date","Lunar Date","Tidal Data","Pressure Data",
            "Sea Level","Water Temperature","Wind Speed","Wind Direction","Wave Height",
            "App Fishing Score","User Fishing Score","Fish Caught","User Notes","Pressure"]

def load_history(path: str) -> pd.DataFrame:
    if not os.path.exists(path):
        return pd.DataFrame(columns=REQ_COLS)
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    for c in REQ_COLS:
        if c not in df.columns:
            df[c] = ""
    return df.fillna("")

def save_history(df: pd.DataFrame, path: str):
    df = df.copy()
    df["_d"] = df["Vietnam Date"].apply(parse_ddmmyyyy)
    df = df.sort_values("_d").drop(columns=["_d"])
    df.to_csv(path, index=False)

def missing_dates(df: pd.DataFrame):
    today = today_local()
    if df.empty:
        start = today - timedelta(days=7)
    else:
        try:
            last = df["Vietnam Date"].apply(parse_ddmmyyyy).max()
        except Exception:
            last = today - timedelta(days=7)
        start = last + timedelta(days=1)
    if start > today: return []
    cur, out = start, []
    while cur <= today:
        out.append(cur)
        cur += timedelta(days=1)
    return out

# ==== HTTP Stormglass (fallback nhiều key) ====
def sg_get(path, params):
    err = None
    for i, key in enumerate([k for k in SG_KEYS if k]):
        try:
            r = requests.get(f"{SG_BASE}{path}", headers={"Authorization": key}, params=params, timeout=60)
            if 200 <= r.status_code < 300:
                return r.json()
            err = f"[Key#{i+1}] HTTP {r.status_code}: {r.text[:200]}"
        except Exception as e:
            err = f"[Key#{i+1}] {e}"
    raise RuntimeError(err or "No Stormglass key configured")

# ==== Fetchers ====
def fetch_tide(start_d: date, end_d: date):
    sdt = datetime.combine(start_d, datetime.min.time()).replace(tzinfo=LOCAL_TZ)
    edt = datetime.combine(end_d, datetime.max.time()).replace(tzinfo=LOCAL_TZ)
    j = sg_get("/tide/extremes/point", {"lat": LAT,"lng": LON,"start": to_utc_iso(sdt),"end": to_utc_iso(edt)})
    return j.get("data", [])

def fetch_pressure(start_d: date, end_d: date):
    sdt = datetime.combine(start_d, datetime.min.time()).replace(tzinfo=LOCAL_TZ)
    edt = datetime.combine(end_d, datetime.max.time()).replace(tzinfo=LOCAL_TZ)
    j = sg_get("/weather/point", {
        "lat": LAT, "lng": LON, "params": "pressure",
        "source": "noaa", "start": to_utc_iso(sdt), "end": to_utc_iso(edt)
    })
    return j.get("hours", [])

def iso_to_local(iso):
    if isinstance(iso, str) and iso.endswith("Z"): iso = iso[:-1] + "+00:00"
    return datetime.fromisoformat(iso).astimezone(LOCAL_TZ).isoformat()

def iso_to_ddmmyyyy(iso):
    if isinstance(iso, str) and iso.endswith("Z"): iso = iso[:-1] + "+00:00"
    return datetime.fromisoformat(iso).astimezone(LOCAL_TZ).strftime("%d/%m/%Y")

# ==== Build rows cho phần thiếu (ghi CSV) ====
def rows_for(miss, tides, hours):
    tide_by = {}
    for x in tides:
        d = iso_to_ddmmyyyy(x["time"])
        tide_by.setdefault(d, []).append({"time": iso_to_local(x["time"]),
                                          "height": x.get("height"),
                                          "type": x.get("type")})
    pres_by = {}
    for h in hours:
        d = iso_to_ddmmyyyy(h["time"])
        v = h.get("pressure")
        if isinstance(v, dict): v = v.get("noaa")
        try:
            f = float(v)
            if math.isfinite(f):
                pres_by.setdefault(d, []).append({"time": iso_to_local(h["time"]), "pressure": f})
        except: pass

    out = []
    for d in miss:
        ds = ddmmyyyy(d)
        out.append({
            "Vietnam Date": ds,
            "Lunar Date":   lunar_ddmm(d),
            "Tidal Data":   str(tide_by.get(ds, [])),
            "Pressure Data":str(pres_by.get(ds, [])),
            "Sea Level":"","Water Temperature":"","Wind Speed":"","Wind Direction":"","Wave Height":"",
            "App Fishing Score":"","User Fishing Score":"","Fish Caught":"","User Notes":"","Pressure":""
        })
    return pd.DataFrame(out) if out else None

# ==== Forecast (không ghi CSV) ====
def build_forecast(start_d: date, end_d: date):
    tides = fetch_tide(start_d, end_d)
    hours = fetch_pressure(start_d, end_d)

    tide_by, pres_by = {}, {}
    for x in tides:
        d = iso_to_ddmmyyyy(x["time"])
        tide_by.setdefault(d, []).append({"time": iso_to_local(x["time"]),
                                          "height": x.get("height"), "type": x.get("type")})
    for h in hours:
        d = iso_to_ddmmyyyy(h["time"])
        v = h.get("pressure")
        if isinstance(v, dict): v = v.get("noaa")
        try:
            f = float(v)
            if math.isfinite(f):
                pres_by.setdefault(d, []).append({"time": iso_to_local(h["time"]), "pressure": f})
        except: pass

    cur, out = start_d, []
    while cur <= end_d:
        ds = ddmmyyyy(cur)
        out.append({
            "vietnam_date": ds,
            "lunar_date":   lunar_ddmm(cur),
            "tidal_data":   tide_by.get(ds, []),
            "pressure_data":pres_by.get(ds, []),
            "is_forecast":  True
        })
        cur += timedelta(days=1)
    return out

# ==== Xuất site/data.json ====
def export_json(df: pd.DataFrame, forecast: list):
    def parse_list(s):
        if not s: return []
        try: return ast.literal_eval(s)
        except: return []

    items = []
    for _, r in df.iterrows():
        items.append({
            "vietnam_date": r["Vietnam Date"],
            "lunar_date":   r["Lunar Date"],
            "tidal_data":   parse_list(r["Tidal Data"]),
            "pressure_data":parse_list(r["Pressure Data"]),
            "is_forecast":  False
        })

    # sort + khử trùng lặp theo ngày
    def key_dt(x): return parse_ddmmyyyy(x["vietnam_date"])
    items = sorted(items, key=key_dt)

    # nối forecast và đảm bảo sort tăng dần
    all_days = items + (forecast or [])
    all_days = sorted(all_days, key=key_dt)

    payload = {
        "meta": {
            "generated_at": datetime.now(LOCAL_TZ).isoformat(),
            "rows": len(all_days)
        },
        "days": all_days
    }
    with open(SITE_JSON, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

def main():
    try:
        df = load_history(HISTORY_CSV)
        miss = missing_dates(df)
        if miss:
            s, e = miss[0], miss[-1]
            tides = fetch_tide(s, e)
            hours = fetch_pressure(s, e)
            add = rows_for(miss, tides, hours)
            if add is not None:
                df = pd.concat([df, add], ignore_index=True)
                save_history(df, HISTORY_CSV)

        # forecast 10 ngày tới
        s_fc = today_local() + timedelta(days=1)
        e_fc = s_fc + timedelta(days=9)
        forecast = build_forecast(s_fc, e_fc)

        export_json(df, forecast)
        print(f"[OK] history={len(df)} forecast={len(forecast)} → {SITE_JSON}")
    except Exception as e:
        with open(SITE_JSON, "w", encoding="utf-8") as f:
            json.dump({"error": f"{e}\n{traceback.format_exc()}"}, f, ensure_ascii=False, indent=2)
        raise

if __name__ == "__main__":
    main()
