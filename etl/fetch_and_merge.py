# -*- coding: utf-8 -*-
import os, json, math, ast, traceback
from datetime import datetime, timedelta, timezone, date
from dateutil import tz
import pandas as pd
import requests

# =========================
# Config cố định (đúng theo thỏa thuận)
# =========================
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

REQ_COLS = [
    "Vietnam Date","Lunar Date","Tidal Data","Pressure Data",
    "Sea Level","Water Temperature","Wind Speed","Wind Direction","Wave Height",
    "App Fishing Score","User Fishing Score","Fish Caught","User Notes","Pressure"
]

# =========================
# Helpers về thời gian & số
# =========================
def today_local() -> date:
    return datetime.now(LOCAL_TZ).date()

def ddmmyyyy(d: date) -> str:
    return f"{d.day:02d}/{d.month:02d}/{d.year}"

def parse_ddmmyyyy(s: str) -> date:
    return datetime.strptime(s.strip(), "%d/%m/%Y").date()

def to_utc_epoch(dt_local: datetime) -> int:
    if dt_local.tzinfo is None:
        dt_local = dt_local.replace(tzinfo=LOCAL_TZ)
    return int(dt_local.astimezone(timezone.utc).timestamp())

def iso_to_local(iso):
    # Stormglass trả ISO kết thúc 'Z'
    if isinstance(iso, str) and iso.endswith("Z"):
        iso = iso[:-1] + "+00:00"
    return datetime.fromisoformat(iso).astimezone(LOCAL_TZ).isoformat()

def iso_to_ddmmyyyy(iso):
    if isinstance(iso, str) and iso.endswith("Z"):
        iso = iso[:-1] + "+00:00"
    return datetime.fromisoformat(iso).astimezone(LOCAL_TZ).strftime("%d/%m/%Y")

def lunar_ddmm(d: date) -> str:
    try:
        from lunarcalendar import Converter, Solar
        solar = Solar(d.year, d.month, d.day)
        lunar = Converter.Solar2Lunar(solar)
        return f"{lunar.day:02d}/{lunar.month:02d}"
    except Exception:
        return f"{d.day:02d}/{d.month:02d}"

def r2(x):
    try:
        if x is None:
            return None
        fx = float(x)
        if not math.isfinite(fx):
            return None
        return round(fx, 2)
    except:
        return None

# =========================
# CSV I/O và cắt lịch sử
# =========================
def load_hist() -> pd.DataFrame:
    if not os.path.exists(HISTORY_CSV):
        return pd.DataFrame(columns=REQ_COLS)
    df = pd.read_csv(HISTORY_CSV, dtype=str, keep_default_na=False).fillna("")
    for c in REQ_COLS:
        if c not in df.columns:
            df[c] = ""
    # cắt mọi dòng > hôm qua
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

# =========================
# Stormglass HTTP
# =========================
def sg_get(path, params):
    last_err = ""
    for i, key in enumerate([k for k in SG_KEYS if k]):
        try:
            r = requests.get(SG_BASE + path, headers={"Authorization": key}, params=params, timeout=45)
            if r.status_code == 200:
                return r.json()
            last_err = f"[Key#{i+1}] HTTP {r.status_code}: {r.text[:200]}"
        except Exception as e:
            last_err = f"[Key#{i+1}] {e}"
    raise RuntimeError(last_err or "No Stormglass API key configured")

# =========================
# “CHIẾN THUẬT CHIA NHỎ” — y hệt lap_an_fishing_journal.py
# - Gọi theo block 10 ngày liên tiếp
# - Tổng hợp kết quả
# =========================
def fetch_tide_range(start_d: date, end_d: date):
    url = "/tide/extremes/point"
    out = []
    cur = start_d
    # block 10 ngày
    while cur <= end_d:
        block_end = min(end_d, cur + timedelta(days=9))
        sdt = datetime.combine(cur, datetime.min.time()).replace(tzinfo=LOCAL_TZ)
        edt = datetime.combine(block_end, datetime.max.time()).replace(tzinfo=LOCAL_TZ)
        j = sg_get(url, {
            "lat": LAT, "lng": LON,
            "start": to_utc_epoch(sdt),
            "end": to_utc_epoch(edt)
        })
        out.extend(j.get("data", []))
        cur = block_end + timedelta(days=1)
    return out

def fetch_weather_range(start_d: date, end_d: date):
    url = "/weather/point"
    out = []
    cur = start_d
    params_names = "pressure,seaLevel,waterTemperature,windSpeed,windDirection,waveHeight"
    while cur <= end_d:
        block_end = min(end_d, cur + timedelta(days=9))
        sdt = datetime.combine(cur, datetime.min.time()).replace(tzinfo=LOCAL_TZ)
        edt = datetime.combine(block_end, datetime.max.time()).replace(tzinfo=LOCAL_TZ)
        j = sg_get(url, {
            "lat": LAT, "lng": LON,
            "params": params_names,
            "start": to_utc_epoch(sdt),
            "end": to_utc_epoch(edt),
            "source": "sg"  # đồng bộ bản PC
        })
        out.extend(j.get("hours", []))
        cur = block_end + timedelta(days=1)
    return out

# =========================
# Gom nhóm & tính toán
# =========================
def circ_mean_deg(deg_list):
    arr = [float(v) for v in deg_list if v is not None]
    if not arr:
        return None
    s = sum(math.sin(math.radians(x)) for x in arr)
    c = sum(math.cos(math.radians(x)) for x in arr)
    ang = math.degrees(math.atan2(s, c))
    if ang < 0:
        ang += 360.0
    return ang

def aggregate_to_days(tides, hours, days):
    # 1) TIDE: theo ngày, làm tròn 2 chữ số cho height
    tide_by = {}
    for t in tides:
        ds = iso_to_ddmmyyyy(t["time"])
        tide_by.setdefault(ds, []).append({
            "time": iso_to_local(t["time"]),
            "height": r2(t.get("height")),
            "type": t.get("type")
        })

    # 2) WEATHER: pick source 'sg'; lấy tất cả giờ
    g = {}
    for h in hours:
        ds = iso_to_ddmmyyyy(h["time"])
        def pick(name):
            v = h.get(name)
            v = v.get("sg") if isinstance(v, dict) else v
            try:
                fv = float(v)
                return fv if math.isfinite(fv) else None
            except:
                return None

        rec = g.setdefault(ds, {"wt": [], "ws": [], "wd": [], "wh": [], "sl": [], "pres": []})
        p = pick("pressure")
        rec["pres"].append({
            "time": iso_to_local(h["time"]),
            "pressure": r2(p)
        })
        rec["wt"].append(pick("waterTemperature"))
        rec["ws"].append(pick("windSpeed"))
        rec["wd"].append(pick("windDirection"))
        rec["wh"].append(pick("waveHeight"))
        rec["sl"].append(pick("seaLevel"))

    # 3) Build rows, bỏ ngày “biên dải” không đầy đủ:
    #    - nếu KHÔNG có tide và pressure < 2 điểm ⇒ bỏ qua (để lần ETL sau tự lấp)
    out = []
    for d in days:
        ds = ddmmyyyy(d)
        gg = g.get(ds, {})
        tidal = tide_by.get(ds, [])
        pres_series = [p for p in gg.get("pres", []) if p["pressure"] is not None]

        if len(tidal) == 0 and len(pres_series) < 8:
            continue

        sea = r2(_mean(gg.get("sl", [])))
        wt  = r2(_mean(gg.get("wt", [])))
        ws  = r2(_mean(gg.get("ws", [])))
        wd  = r2(circ_mean_deg(gg.get("wd", [])))
        wh  = r2(_mean(gg.get("wh", [])))

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

def _mean(vals):
    arr = [float(v) for v in vals if v is not None and math.isfinite(float(v))]
    return sum(arr)/len(arr) if arr else None

# =========================
# Ghi site/data.json
# =========================
def export_json(hist_df: pd.DataFrame, window_rows, window_start: date):
    def parse_list(s):
        if not s:
            return []
        try:
            return ast.literal_eval(s)
        except:
            return []

    # Lịch sử trước cửa sổ
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

    # Ghi đè theo cửa sổ [hôm qua .. hôm nay+10]
    by_day = {it["vietnam_date"]: it for it in items}
    for it in window_rows or []:
        by_day[it["vietnam_date"]] = it

    out = sorted(by_day.values(), key=lambda x: parse_ddmmyyyy(x["vietnam_date"]))
    with open(SITE_JSON, "w", encoding="utf-8") as f:
        json.dump(
            {"meta": {"generated_at": datetime.now(LOCAL_TZ).isoformat(), "rows": len(out)}, "days": out},
            f, ensure_ascii=False, indent=2
        )

# =========================
# Luồng chính
# =========================
def main():
    try:
        # 1) Load & enforce trim tới hôm qua
        df = load_hist()
        save_hist(df)
        df = load_hist()

        # 2) Xác định dải “bù thiếu” từ ngày sau cùng trong CSV tới hôm qua
        end_backfill = today_local() - timedelta(days=1)
        if df.empty:
            # nếu trống, bù 7 ngày gần nhất để có nền dữ liệu
            start_backfill = end_backfill - timedelta(days=6)
        else:
            last = df["Vietnam Date"].apply(parse_ddmmyyyy).max()
            start_backfill = last + timedelta(days=1)

        if start_backfill <= end_backfill:
            # dùng CHIẾN THUẬT PC: fetch theo block 10 ngày
            tides = fetch_tide_range(start_backfill, end_backfill)
            hours = fetch_weather_range(start_backfill, end_backfill)
            # build list ngày liên tiếp
            days = []
            cur = start_backfill
            while cur <= end_backfill:
                days.append(cur)
                cur += timedelta(days=1)
            rows = aggregate_to_days(tides, hours, days)

            if rows:
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
                df = load_hist()

        # 3) Cửa sổ JSON: hôm qua .. hôm nay+10
        start_win = today_local() - timedelta(days=1)
        end_win = today_local() + timedelta(days=10)
        tides = fetch_tide_range(start_win, end_win)
        hours = fetch_weather_range(start_win, end_win)
        # xây list ngày cửa sổ
        days = []
        cur = start_win
        while cur <= end_win:
            days.append(cur)
            cur += timedelta(days=1)
        window_rows = aggregate_to_days(tides, hours, days)

        export_json(df, window_rows, start_win)
        print(f"[OK] history={len(df)} window_rows={len(window_rows)} → {SITE_JSON}")
    except Exception as e:
        with open(SITE_JSON, "w", encoding="utf-8") as f:
            json.dump({"error": f"{e}\n{traceback.format_exc()}"}, f, ensure_ascii=False, indent=2)
        raise

if __name__ == "__main__":
    main()
