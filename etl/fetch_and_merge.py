# -*- coding: utf-8 -*-
import os, json, math, traceback, ast
from datetime import datetime, timedelta, timezone, date
from dateutil import tz
import pandas as pd
import requests

# ===== Config =====
LAT, LON = 16.3500, 107.9000
LOCAL_TZ = tz.gettz("Asia/Ho_Chi_Minh")

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
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
    # luôn giữ history chỉ đến HÔM QUA
    df = df.copy()
    df["_d"] = df["Vietnam Date"].apply(parse_ddmmyyyy)
    df = df[df["_d"] <= (today_local() - timedelta(days=1))].sort_values("_d").drop(columns=["_d"])
    df.to_csv(HISTORY_CSV, index=False)

def missing_dates(df: pd.DataFrame):
    # chỉ bù tới hôm qua (không đụng hôm nay, hôm qua sẽ còn được ghi đè ở bước "cửa sổ cập nhật")
    end = today_local() - timedelta(days=1)
    if df.empty: start = end - timedelta(days=7)
    else:
        try: start = df["Vietnam Date"].apply(parse_ddmmyyyy).max() + timedelta(days=1)
        except: start = end - timedelta(days=7)
    if start > end: return []
    cur, out = start, []
    while cur <= end: out.append(cur); cur += timedelta(days=1)
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

# ===== Build rows (helper) =====
def aggregate_hours(tides, hours):
    tide_by = {}
    for x in tides:
        d = iso_to_ddmmyyyy(x["time"])
        tide_by.setdefault(d, []).append({"time": iso_to_local(x["time"]),
                                          "height": x.get("height"), "type": x.get("type")})
    g = {}
    for h in hours:
        d = iso_to_ddmmyyyy(h["time"])
        def pick(name):
            v = h.get(name); v = v.get("noaa") if isinstance(v, dict) else v
            try: f=float(v); return f if math.isfinite(f) else None
            except: return None
        rec = g.setdefault(d, {"wt":[], "ws":[], "wd":[], "wh":[], "sl":[], "pres_series":[]})
        rec["pres_series"].append({"time": iso_to_local(h["time"]), "pressure": pick("pressure")})
        rec["wt"].append(pick("waterTemperature"))
        rec["ws"].append(pick("windSpeed"))
        rec["wd"].append(pick("windDirection"))
        rec["wh"].append(pick("waveHeight"))
        rec["sl"].append(pick("seaLevel"))
    return tide_by, g

def build_rows_for_days(days, tide_by, g):
    out = []
    for d in days:
        ds = ddmmyyyy(d); gg = g.get(ds, {})
        sea = mean(gg.get("sl",[])); wt = mean(gg.get("wt",[])); ws = mean(gg.get("ws",[]))
        wd  = circular_mean_deg(gg.get("wd",[])); wh = mean(gg.get("wh",[]))
        pres_series = [p for p in gg.get("pres_series",[]) if p["pressure"] is not None]
        out.append({
            "vietnam_date": ds, "lunar_date": lunar_ddmm(d),
            "tidal_data": tide_by.get(ds, []), "pressure_data": pres_series,
            "sea_level": sea, "water_temperature": wt, "wind_speed": ws,
            "wind_direction": wd, "wave_height": wh
        })
    return out

# ===== Export site/data.json =====
def export_json(hist_df: pd.DataFrame, window_rows: list, window_start: date):
    # parse helpers
    def parse_list(s):
        if not s: return []
        try: return ast.literal_eval(s)
        except: return []
    yesterday = today_local() - timedelta(days=1)

    # 1) lấy lịch sử cho các ngày < window_start (tức trước hôm qua)
    items = []
    for _, r in hist_df.iterrows():
        d = parse_ddmmyyyy(r["Vietnam Date"])
        if d < window_start:
            items.append({
                "vietnam_date": r["Vietnam Date"], "lunar_date": r["Lunar Date"],
                "tidal_data": parse_list(r["Tidal Data"]), "pressure_data": parse_list(r["Pressure Data"]),
                "sea_level": float(r["Sea Level"]) if r["Sea Level"] else None,
                "water_temperature": float(r["Water Temperature"]) if r["Water Temperature"] else None,
                "wind_speed": float(r["Wind Speed"]) if r["Wind Speed"] else None,
                "wind_direction": float(r["Wind Direction"]) if r["Wind Direction"] else None,
                "wave_height": float(r["Wave Height"]) if r["Wave Height"] else None
            })

    # 2) “ghi đè” cửa sổ [hôm qua .. hôm nay+10]
    by_day = {it["vietnam_date"]: it for it in items}
    for it in window_rows or []:
        by_day[it["vietnam_date"]] = it

    out = sorted(by_day.values(), key=lambda x: parse_ddmmyyyy(x["vietnam_date"]))
    with open(SITE_JSON, "w", encoding="utf-8") as f:
        json.dump({"meta":{"generated_at": datetime.now(LOCAL_TZ).isoformat(), "rows": len(out)},
                   "days": out}, f, ensure_ascii=False, indent=2)

# ===== Main =====
def main():
    try:
        df = load_hist()
        # cắt các dòng tương lai lỡ lưu
        save_hist(df)
        df = load_hist()

        # bù dữ liệu thiếu (tới hôm qua)
        miss = missing_dates(df)
        if miss:
            s, e = miss[0], miss[-1]
            tides = fetch_tide(s, e)
            hours = fetch_weather(s, e)
            tide_by, g = aggregate_hours(tides, hours)
            rows = []
            for d in miss:
                rows += build_rows_for_days([d], tide_by, g)
            if rows:
                # convert rows -> REQ_COLS schema để append vào history.csv
                add = pd.DataFrame([{
                    "Vietnam Date": r["vietnam_date"],
                    "Lunar Date": r["lunar_date"],
                    "Tidal Data": str(r["tidal_data"]),
                    "Pressure Data": str(r["pressure_data"]),
                    "Sea Level": "" if r["sea_level"] is None else f"{r['sea_level']:.4f}",
                    "Water Temperature": "" if r["water_temperature"] is None else f"{r['water_temperature']:.4f}",
                    "Wind Speed": "" if r["wind_speed"] is None else f"{r['wind_speed']:.4f}",
                    "Wind Direction": "" if r["wind_direction"] is None else f"{r['wind_direction']:.4f}",
                    "Wave Height": "" if r["wave_height"] is None else f"{r['wave_height']:.4f}",
                    "App Fishing Score":"","User Fishing Score":"","Fish Caught":"","User Notes":"","Pressure":""
                } for r in rows])
                df = pd.concat([df, add], ignore_index=True)
                save_hist(df)
                df = load_hist()

        # cửa sổ cập nhật: hôm qua .. hôm nay+10 (bao gồm cả hôm qua để ghi đè)
        start_win = today_local() - timedelta(days=1)
        end_win = today_local() + timedelta(days=10)   # +10 thay vì +9
        tides = fetch_tide(start_win, end_win)
        hours = fetch_weather(start_win, end_win)
        tide_by, g = aggregate_hours(tides, hours)

        days = []
        cur = start_win
        while cur <= end_win:
            days.append(cur)
            cur += timedelta(days=1)
        window_rows = build_rows_for_days(days, tide_by, g)

        export_json(df, window_rows, start_win)
        print(f"[OK] history={len(df)} window_rows={len(window_rows)} → {SITE_JSON}")
    except Exception as e:
        with open(SITE_JSON,"w",encoding="utf-8") as f:
            json.dump({"error": f"{e}\n{traceback.format_exc()}"}, f, ensure_ascii=False, indent=2)
        raise

if __name__ == "__main__":
    main()
