import os, json, requests, pandas as pd
from datetime import datetime, timedelta, timezone
from dateutil import tz
from lunarcalendar import Converter, Solar, Lunar

# ===== Cấu hình =====
LAT = 16.3500
LON = 107.9000
LOCAL_TZ = tz.gettz("Asia/Ho_Chi_Minh")

ROOT = os.path.dirname(__file__)
HISTORY_CSV = os.path.join(ROOT, "..", "data", "history.csv")
SITE_JSON   = os.path.join(ROOT, "..", "site", "data.json")

STORMGLASS_KEY = os.environ["STORMGLASS_KEY"]
SG_BASE = "https://api.stormglass.io/v2"

# ===== Helpers =====
def today_local_date():
    return datetime.now(LOCAL_TZ).date()

def to_utc_iso(dt_local):
    if dt_local.tzinfo is None:
        dt_local = dt_local.replace(tzinfo=LOCAL_TZ)
    return dt_local.astimezone(timezone.utc).isoformat()

def parse_ddmmyyyy(s):
    # "01/01/2021" -> date
    return datetime.strptime(s, "%d/%m/%Y").date()

def fmt_ddmmyyyy(d):
    return d.strftime("%d/%m/%Y")

def fmt_ddmm(d):
    return d.strftime("%d/%m")

def gregorian_to_lunar_ddmm(d):
    # d: date (local). Trả về "dd/MM" âm lịch
    solar = Solar(d.year, d.month, d.day)
    lunar = Converter.Solar2Lunar(solar)
    # lunar.month can be leap; simple format mm with leading zero
    return f"{lunar.day:02d}/{lunar.month:02d}"

def load_history(path):
    if not os.path.exists(path):
        cols = ["Vietnam Date","Lunar Date","Tidal Data","Pressure Data",
                "Sea Level","Water Temperature","Wind Speed","Wind Direction","Wave Height",
                "App Fishing Score","User Fishing Score","Fish Caught","User Notes","Pressure"]
        return pd.DataFrame(columns=cols)
    df = pd.read_csv(path, dtype=str)
    # Bổ sung cột thiếu nếu có
    for c in ["Vietnam Date","Lunar Date","Tidal Data","Pressure Data",
              "Sea Level","Water Temperature","Wind Speed","Wind Direction","Wave Height",
              "App Fishing Score","User Fishing Score","Fish Caught","User Notes","Pressure"]:
        if c not in df.columns:
            df[c] = ""
    return df

def save_history(df, path):
    # Chỉ giữ đến hôm nay
    today = today_local_date()
    df["_d"] = df["Vietnam Date"].apply(parse_ddmmyyyy)
    df = df[df["_d"] <= today].copy()
    df = df.sort_values("_d").drop(columns=["_d"])
    df.to_csv(path, index=False)

def get_missing_dates(df):
    # Tìm ngày thiếu từ (max Vietnam Date + 1) -> hôm nay
    today = today_local_date()
    if df.empty:
        start = today - timedelta(days=7)  # lấy lùi 7 ngày nếu trống
    else:
        try:
            maxd = df["Vietnam Date"].apply(parse_ddmmyyyy).max()
        except Exception:
            maxd = today - timedelta(days=7)
        start = maxd + timedelta(days=1)
    if start > today:
        return []
    res = []
    cur = start
    while cur <= today:
        res.append(cur)
        cur += timedelta(days=1)
    return res

def fetch_tide_extremes(start_date, end_date):
    start_dt = datetime.combine(start_date, datetime.min.time()).replace(tzinfo=LOCAL_TZ)
    end_dt   = datetime.combine(end_date,   datetime.max.time()).replace(tzinfo=LOCAL_TZ)
    url = f"{SG_BASE}/tide/extremes/point"
    headers = {"Authorization": STORMGLASS_KEY}
    params = {"lat": LAT, "lng": LON, "start": to_utc_iso(start_dt), "end": to_utc_iso(end_dt)}
    r = requests.get(url, headers=headers, params=params, timeout=60)
    r.raise_for_status()
    return r.json().get("data", [])

def fetch_weather_pressure(start_date, end_date):
    start_dt = datetime.combine(start_date, datetime.min.time()).replace(tzinfo=LOCAL_TZ)
    end_dt   = datetime.combine(end_date,   datetime.max.time()).replace(tzinfo=LOCAL_TZ)
    url = f"{SG_BASE}/weather/point"
    headers = {"Authorization": STORMGLASS_KEY}
    params = {
        "lat": LAT, "lng": LON,
        "params": "pressure",
        "start": to_utc_iso(start_dt),
        "end": to_utc_iso(end_dt),
        "source": "noaa"
    }
    r = requests.get(url, headers=headers, params=params, timeout=60)
    r.raise_for_status()
    return r.json().get("hours", [])

def to_local_date_str_from_iso(iso_s):
    # ISO có thể là "...Z" → thay Z = +00:00 cho fromisoformat
    if iso_s.endswith("Z"):
        iso_s = iso_s[:-1] + "+00:00"
    dt_utc = datetime.fromisoformat(iso_s)
    dt_loc = dt_utc.astimezone(LOCAL_TZ)
    return fmt_ddmmyyyy(dt_loc.date())

def build_new_rows(missing_dates, tide_extremes, weather_hours):
    # Gom theo ngày (theo local)
    tide_by_day = {}
    for it in tide_extremes:
        d = to_local_date_str_from_iso(it["time"])
        # chuyển time sang local ISO +07:00 cho dễ đọc nhất quán
        t_iso = it["time"]
        if t_iso.endswith("Z"):
            t_iso = t_iso[:-1] + "+00:00"
        dt_utc = datetime.fromisoformat(t_iso)
        t_local = dt_utc.astimezone(LOCAL_TZ).isoformat()
        tide_by_day.setdefault(d, []).append({
            "height": it.get("height"),
            "time": t_local,
            "type": it.get("type")
        })

    pres_by_day = {}
    for h in weather_hours:
        t_iso = h["time"]
        if t_iso.endswith("Z"):
            t_iso = t_iso[:-1] + "+00:00"
        dt_utc = datetime.fromisoformat(t_iso)
        d = fmt_ddmmyyyy(dt_utc.astimezone(LOCAL_TZ).date())
        val = h.get("pressure")
        if isinstance(val, dict):
            val = val.get("noaa")
        if val is not None:
            pres_by_day.setdefault(d, []).append({
                "time": dt_utc.astimezone(LOCAL_TZ).isoformat(),
                "pressure": float(val)
            })

    rows = []
    for d in missing_dates:
        vnd = fmt_ddmmyyyy(d)
        lunar = gregorian_to_lunar_ddmm(d)
        # Dùng repr(...) để giữ chuỗi với dấu nháy đơn, giống file cũ của bạn
        tidal_repr = repr(tide_by_day.get(vnd, []))
        press_repr = repr(pres_by_day.get(vnd, []))
        rows.append({
            "Vietnam Date": vnd,
            "Lunar Date": lunar,
            "Tidal Data": tidal_repr,
            "Pressure Data": press_repr,
            "Sea Level": "",
            "Water Temperature": "",
            "Wind Speed": "",
            "Wind Direction": "",
            "Wave Height": "",
            "App Fishing Score": "",
            "User Fishing Score": "",
            "Fish Caught": "",
            "User Notes": "",
            "Pressure": ""
        })
    return pd.DataFrame(rows) if rows else None

def export_site_json(df):
    # Chỉ xuất đến hôm nay
    df["_d"] = df["Vietnam Date"].apply(parse_ddmmyyyy)
    df = df[df["_d"] <= today_local_date()].copy().sort_values("_d").drop(columns=["_d"])

    # Chuyển "Tidal Data" & "Pressure Data" (chuỗi repr) → đối tượng
    import ast
    def parse_repr(s):
        try:
            return ast.literal_eval(s) if isinstance(s, str) else []
        except Exception:
            return []

    out = []
    for _, r in df.iterrows():
        out.append({
            "vietnam_date": r["Vietnam Date"],          # dd/MM/yyyy
            "lunar_date": r.get("Lunar Date",""),
            "tidal_data": parse_repr(r.get("Tidal Data","")),
            "pressure_data": parse_repr(r.get("Pressure Data","")),
            "fish_caught": r.get("Fish Caught","") or "",
            "user_score": r.get("User Fishing Score","") or "",
            "user_notes": r.get("User Notes","") or ""
        })
    with open(SITE_JSON, "w", encoding="utf-8") as f:
        json.dump({"days": out}, f, ensure_ascii=False, indent=2)

def main():
    df = load_history(HISTORY_CSV)
    missing = get_missing_dates(df)
    if missing:
        start, end = missing[0], missing[-1]
        tide = fetch_tide_extremes(start, end)
        pres = fetch_weather_pressure(start, end)
        newdf = build_new_rows(missing, tide, pres)
        if newdf is not None:
            df = pd.concat([df, newdf], ignore_index=True)
            save_history(df, HISTORY_CSV)
    # luôn export JSON cho web
    export_site_json(df)
    print(f"[OK] rows={len(df)} → {SITE_JSON}")

if __name__ == "__main__":
    main()
