# -*- coding: utf-8 -*-
import os, json, math, traceback, ast
from datetime import datetime, timedelta, timezone, date
from dateutil import tz
import pandas as pd
import requests

# ===== Config =====
# Đồng bộ tọa độ với bản PC
LAT, LON = 16.224044, 108.084327
LOCAL_TZ = tz.gettz("Asia/Ho_Chi_Minh")

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA_DIR = os.path.join(ROOT, "data")
SITE_DIR = os.path.join(ROOT, "site")
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(SITE_DIR, exist_ok=True)

HISTORY_CSV = os.path.join(DATA_DIR, "history.csv")
SITE_JSON = os.path.join(SITE_DIR, "data.json")

SG_BASE = "https://api.stormglass.io/v2"
SG_KEYS = [os.getenv("STORMGLASS_KEY_1",""),
           os.getenv("STORMGLASS_KEY_2",""),
           os.getenv("STORMGLASS_KEY_3","")]

REQ_COLS = ["Vietnam Date","Lunar Date","Tidal Data","Pressure Data",
            "Sea Level","Water Temperature","Wind Speed","Wind Direction","Wave Height",
            "App Fishing Score","User Fishing Score","Fish Caught","User Notes","Pressure"]

# ===== Time helpers =====
def today_local() -> date:
    return datetime.now(LOCAL_TZ).date()

def ddmmyyyy(d: date) -> str:
    return f"{d.day:02d}/{d.month:02d}/{d.year}"

def parse_ddmmyyyy(s: str) -> date:
    return datetime.strptime(s.strip(), "%d/%m/%Y").date()

def to_utc_iso(dt_local: datetime) -> str:
    if dt_local.tzinfo is None:
        dt_local = dt_local.replace(tzinfo=LOCAL_TZ)
    return dt_local.astimezone(timezone.utc).isoformat()

def iso_to_local(iso):
    if isinstance(iso, str) and iso.endswith("Z"):
        iso = iso[:-1] + "+00:00"
    return datetime.fromisoformat(iso).astimezone(LOCAL_TZ).isoformat()

def iso_to_ddmmyyyy(iso):
    if isinstance(iso, str) and iso.endswith("Z"):
        iso = iso[:-1] + "+00:00"
    return datetime.fromisoformat(iso).astimezone(LOCAL_TZ).strftime("%d/%m/%Y")

# ===== Lunar (fallback nếu thiếu lib) =====
def lunar_ddmm(d: date) -> str:
    try:
        from lunarcalendar import Converter, Solar
        solar = Solar(d.year, d.month, d.day)
        lunar = Converter.Solar2Lunar(solar)
        return f"{lunar.day:02d}/{lunar.month:02d}"
    except Exception:
        return f"{d.day:02d}/{d.month:02d}"

# ===== CSV IO =====
def load_hist():
    if not os.path.exists(HISTORY_CSV):
        return pd.DataFrame(columns=REQ_COLS)
    df = pd.read_csv(HISTORY_CSV, dtype=str, keep_default_na=False).fillna("")
    for c in REQ_COLS:
        if c not in df.columns:
            df[c] = ""
    # Chuẩn hoá & cắt mọi dòng > hôm qua
    try:
        df["_d"] = df["Vietnam Date"].apply(parse_ddmmyyyy)
    except:
        df["_d"] = today_local()
    df = df[(df["_d"] <= (today_local() - timedelta(days=1)))].sort_values("_d").drop(columns=["_d"])
    return df

def save_hist(df: pd.DataFrame):
    try:
        df["_d"] = df["Vietnam Date"].apply(parse_ddmmyyyy)
    except:
        df["_d"] = today_local()
    df = df[(df["_d"] <= (today_local() - timedelta(days=1)))].sort_values("_d").drop(columns=["_d"])
    df.to_csv(HISTORY_CSV, index=False)

def missing_dates(df: pd.DataFrame):
    # chỉ bù tới hôm qua (không đụng hôm nay, hôm qua sẽ còn được ghi đè ở bước "cửa sổ cập nhật")
    end = today_local() - timedelta(days=1)
    if df.empty:
        start = end - timedelta(days=7)
    else:
        try:
            start = df["Vietnam Date"].apply(parse_ddmmyyyy).max() + timedelta(days=1)
        except:
            start = end - timedelta(days=7)
    if start > end:
        return []
    cur, out = start, []
    while cur <= end:
        out.append(cur)
        cur += timedelta(days=1)
    return out

# ===== HTTP =====
def sg_get(path, params):
    last = ""
    for i, key in enumerate([k for k in SG_KEYS if k]):
        try:
            r = requests.get(SG_BASE + path, headers={"Authorization": key}, params=params, timeout=45)
            if r.status_code == 200:
                return r.json()
            last = f"[Key#{i+1}] HTTP {r.status_code}: {r.text[:200]}"
        except Exception as e:
            last = f"[Key#{i+1}] {e}"
    raise RuntimeError(last or "No API key")

# ===== Fetchers =====
def fetch_tide(start_d: date, end_d: date):
    sdt = datetime.combine(start_d, datetime.min.time()).replace(tzinfo=LOCAL_TZ)
    edt = datetime.combine(end_d, datetime.max.time()).replace(tzinfo=LOCAL_TZ)
    j = sg_get("/tide/extremes/point", {"lat": LAT, "lng": LON, "start": to_utc_iso(sdt), "end": to_utc_iso(edt)})
    return j.get("data", [])

def fetch_weather(start_d: date, end_d: date):
    sdt = datetime.combine(start_d, datetime.min.time()).replace(tzinfo=LOCAL_TZ)
    edt = datetime.combine(end_d, datetime.max.time()).replace(tzinfo=LOCAL_TZ)
    params = "pressure,waterTemperature,windSpeed,windDirection,waveHeight,seaLevel"
    # Đổi source -> sg để có seaLevel và đồng bộ bản PC
    j = sg_get("/weather/point", {
        "lat": LAT, "lng": LON, "params": params,
        "source": "sg", "start": to_utc_iso(sdt), "end": to_utc_iso(edt)
    })
    return j.get("hours", [])

# ===== Aggregations =====
def mean(vals):
    arr = [float(v) for v in vals if v is not None and math.isfinite(float(v))]
    return sum(arr)/len(arr) if arr else None

def circular_mean_deg(deg_list):
    arr = [float(v) for v in deg_list if v is not None and math.isfinite(float(v))]
    if not arr:
        return None
    # trung bình vector trên vòng tròn
    import math as _m
    s = sum(_m.sin(_m.radians(x)) for x in arr)
    c = sum(_m.cos(_m.radians(x)) for x in arr)
    ang = _m.degrees(_m.atan2(s, c))
    if ang < 0:
        ang += 360.0
    return ang

def r2(x):
    """Round to 2 decimals like PC; None remains None."""
    try:
        if x is None:
            return None
        fx = float(x)
        if not math.isfinite(fx):
            return None
        return round(fx, 2)
    except:
        return None

def aggregate_hours(tides, hours):
    # TIDE: giữ nguyên cấu trúc, nhưng height làm tròn 2 chữ số như PC
    tide_by = {}
    for x in tides:
        d = iso_to_ddmmyyyy(x["time"])
        h = r2(x.get("height"))
        tide_by.setdefault(d, []).append({
            "time": iso_to_local(x["time"]),
            "height": h,
            "type": x.get("type")
        })

    # WEATHER: lấy toàn bộ giờ, source=sg, pressure series + các mảng mean
    g = {}
    for h in hours:
        d = iso_to_ddmmyyyy(h["time"])
        def pick(name):
            v = h.get(name)
            # các trường ở weather trả về dict theo source; chọn 'sg'
            v = v.get("sg") if isinstance(v, dict) else v
            try:
                f = float(v)
                return f if math.isfinite(f) else None
            except:
                return None

        rec = g.setdefault(d, {"wt": [], "ws": [], "wd": [], "wh": [], "sl": [], "pres_series": []})
        # pressure series: lưu toàn bộ giờ, làm tròn 2 chữ số
        p = pick("pressure")
        rec["pres_series"].append({
            "time": iso_to_local(h["time"]),
            "pressure": r2(p)
        })
        rec["wt"].append(pick("waterTemperature"))
        rec["ws"].append(pick("windSpeed"))
        rec["wd"].append(pick("windDirection"))
        rec["wh"].append(pick("waveHeight"))
        rec["sl"].append(pick("seaLevel"))

    return tide_by, g

def build_rows_for_days(days, tide_by, g):
    out = []
    for d in days:
        ds = ddmmyyyy(d)
        gg = g.get(ds, {})
        sea = r2(mean(gg.get("sl", [])))
        wt  = r2(mean(gg.get("wt", [])))
        ws  = r2(mean(gg.get("ws", [])))
        wd  = r2(circular_mean_deg(gg.get("wd", [])))
        wh  = r2(mean(gg.get("wh", [])))
        # chỉ giữ các điểm pressure có giá trị (đã làm tròn ở aggregate_hours)
        pres_series = [p for p in gg.get("pres_series", []) if p["pressure"] is not None]
        tidal = tide_by.get(ds, [])

        # **Bỏ ngày rỗng**: nếu không có tide và không có bất kỳ dữ liệu weather nào
        all_means_none = (sea is None and wt is None and ws is None and wd is None and wh is None)
        if len(tidal) == 0 and len(pres_series) == 0 and all_means_none:
            continue

        out.append({
            "vietnam_date": ds,
            "lunar_date": lunar_ddmm(d),
            "tidal_data": tidal,
            "pressure_data": pres_series,
            "sea_level": sea,
            "water_temperature": wt,
            "wind_speed": ws,
            "wind_direction": wd,
            "wave_height": wh
        })
    return out

# ===== Export site/data.json =====
def export_json(hist_df: pd.DataFrame, window_rows, window_start: date):
    # helper parse list repr từ CSV về list python
    def parse_list(s):
        if not s:
            return []
        try:
            return ast.literal_eval(s)
        except:
            return []

    # 1) lấy lịch sử cho các ngày < window_start (tức trước hôm qua)
    items = []
    for _, r in hist_df.iterrows():
        d = parse_ddmmyyyy(r["Vietnam Date"])
        if d < window_start:
            items.append({
                "vietnam_date": r["Vietnam Date"],
                "lunar_date": r["Lunar Date"],
                "tidal_data": parse_list(r["Tidal Data"]),
                "pressure_data": parse_list(r["Pressure Data"]),
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
        json.dump(
            {"meta": {"generated_at": datetime.now(LOCAL_TZ).isoformat(), "rows": len(out)}, "days": out},
            f, ensure_ascii=False, indent=2
        )

# ===== Main =====
def main():
    try:
        # 1) Load history & đảm bảo không có dòng > hôm qua
        df = load_hist()
        save_hist(df)  # re-save to enforce trim

        # 2) Bù các ngày thiếu (chỉ đến hôm qua), tải dữ liệu và append
        dates_to_fill = missing_dates(df)
        if dates_to_fill:
            start_fill, end_fill = dates_to_fill[0], dates_to_fill[-1]
            tides = fetch_tide(start_fill, end_fill)
            hours = fetch_weather(start_fill, end_fill)
            tide_by, g = aggregate_hours(tides, hours)

            # build rows (skip ngày rỗng)
            rows = build_rows_for_days(dates_to_fill, tide_by, g)

            if rows:
                # append vào history.csv với format/làm tròn giống PC (2 chữ số)
                add = pd.DataFrame([{
                    "Vietnam Date": r["vietnam_date"],
                    "Lunar Date": r["lunar_date"],
                    "Tidal Data": str(r["tidal_data"]),
                    "Pressure Data": str(r["pressure_data"]),
                    "Sea Level": "" if r["sea_level"] is None else f"{r['sea_level']:.2f}",
                    "Water Temperature": "" if r["water_temperature"] is None else f"{r['water_temperature']:.2f}",
                    "Wind Speed": "" if r["wind_speed"] is None else f"{r['wind_speed']:.2f}",
                    "Wind Direction": "" if r["wind_direction"] is None else f"{r['wind_direction']:.2f}",
                    "Wave Height": "" if r["wave_height"] is None else f"{r['wave_height']:.2f}",
                    "App Fishing Score": "",
                    "User Fishing Score": "",
                    "Fish Caught": "",
                    "User Notes": "",
                    "Pressure": ""
                } for r in rows])
                df = pd.concat([df, add], ignore_index=True)
                save_hist(df)
                df = load_hist()  # reload to ensure trimmed/sorted

        # 3) Cửa sổ cập nhật: hôm qua .. hôm nay+10 (bao gồm cả hôm qua để ghi đè vào data.json)
        start_win = today_local() - timedelta(days=1)
        end_win = today_local() + timedelta(days=10)
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
        with open(SITE_JSON, "w", encoding="utf-8") as f:
            json.dump({"error": f"{e}\n{traceback.format_exc()}"}, f, ensure_ascii=False, indent=2)
        raise

if __name__ == "__main__":
    main()
