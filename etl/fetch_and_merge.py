import os, json, requests, pandas as pd
from datetime import datetime, timedelta, timezone
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

# Nhận tối đa 3 API keys từ môi trường
SG_KEYS = [k for k in [
    os.environ.get("STORMGLASS_KEY_1"),
    os.environ.get("STORMGLASS_KEY_2"),
    os.environ.get("STORMGLASS_KEY_3"),
] if k]

SG_BASE = "https://api.stormglass.io/v2"

# ===== Helpers =====
def today_local_date():
    return datetime.now(LOCAL_TZ).date()

def to_utc_iso(dt_local):
    if dt_local.tzinfo is None:
        dt_local = dt_local.replace(tzinfo=LOCAL_TZ)
    return dt_local.astimezone(timezone.utc).isoformat()

def parse_ddmmyyyy(s):
    # Bản an toàn: nếu lỗi format thì raise ValueError rõ ràng
    return datetime.strptime(str(s).strip(), "%d/%m/%Y").date()

def fmt_ddmmyyyy(d):
    return d.strftime("%d/%m/%Y")

def gregorian_to_lunar_ddmm(d):
    solar = Solar(d.year, d.month, d.day)
    lunar = Converter.Solar2Lunar(solar)
    return f"{lunar.day:02d}/{lunar.month:02d}"

def load_history(path):
    cols = ["Vietnam Date","Lunar Date","Tidal Data","Pressure Data",
            "Sea Level","Water Temperature","Wind Speed","Wind Direction","Wave Height",
            "App Fishing Score","User Fishing Score","Fish Caught","User Notes","Pressure"]
    if not os.path.exists(path):
        return pd.DataFrame(columns=cols)
    # Đọc toàn bộ dưới dạng chuỗi, không tự chuyển NaN
    df = pd.read_csv(path, dtype=str, keep_default_na=False, na_values=[])
    for c in cols:
        if c not in df.columns:
            df[c] = ""
    # Loại NaN/None text còn sót (nếu có)
    df = df.replace({"NaN": "", "nan": "", "NONE": "", "None": "", "NULL": "", "null": ""})
    df = df.fillna("")
    return df

def save_history(df, path):
    # Chỉ giữ đến hôm nay + sort
    today = today_local_date()
    df["_d"] = df["Vietnam Date"].apply(parse_ddmmyyyy)
    df = df[df["_d"] <= today].copy().sort_values("_d").drop(columns=["_d"])
    df.to_csv(path, index=False)

def get_missing_dates(df):
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
    res, cur = [], start
    while cur <= today:
        res.append(cur)
        cur += timedelta(days=1)
    return res

# ---- HTTP với fallback 3 keys ----
def sg_request(path, params):
    if not SG_KEYS:
        raise RuntimeError("No Stormglass API keys provided.")
    last_err = None
    for idx, key in enumerate(SG_KEYS, start=1):
        try:
            url = f"{SG_BASE}{path}"
            r = requests.get(url, headers={"Authorization": key}, params=params, timeout=60)
            if 200 <= r.status_code < 300:
                return r.json()
            # log lỗi của từng key (không in key)
            last_err = f"[Key#{idx}] HTTP {r.status_code}: {r.text[:200]}"
        except Exception as e:
            last_err = f"[Key#{idx}] {e}"
    raise RuntimeError(f"All Stormglass keys failed. Last error: {last_err}")

def fetch_tide_extremes(start_date, end_date):
    start_dt = datetime.combine(start_date, datetime.min.time()).replace(tzinfo=LOCAL_TZ)
    end_dt   = datetime.combine(end_date,   datetime.max.time()).replace(tzinfo=LOCAL_TZ)
    data = sg_request(
        "/tide/extremes/point",
        {"lat": LAT, "lng": LON, "start": to_utc_iso(start_dt), "end": to_utc_iso(end_dt)}
    )
    return data.get("data", [])

def fetch_weather_pressure(start_date, end_date):
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

def to_local_ddmmyyyy_from_iso(iso_s):
    if iso_s.endswith("Z"):
        iso_s = iso_s[:-1] + "+00:00"
    dt_utc = datetime.fromisoformat(iso_s)
    return fmt_ddmmyyyy(dt_utc.astimezone(LOCAL_TZ).date())

def to_local_iso(iso_s):
    if iso_s.endswith("Z"):
        iso_s = iso_s[:-1] + "+00:00"
    dt_utc = datetime.fromisoformat(iso_s)
    return dt_utc.astimezone(LOCAL_TZ).isoformat()

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
        if val is not None:
            try:
                fval = float(val)
            except Exception:
                fval = None
            if fval is not None and not math.isnan(fval) and not math.isinf(fval):
                pres_by_day.setdefault(d, []).append({
                    "time": to_local_iso(h["time"]),
                    "pressure": fval
                })

    rows = []
    for d in missing_dates:
        vnd = fmt_ddmmyyyy(d)
        lunar = gregorian_to_lunar_ddmm(d)
        rows.append({
            "Vietnam Date": vnd,
            "Lunar Date": lunar,
            "Tidal Data": repr(tide_by_day.get(vnd, [])),   # giữ format nháy đơn cho tương thích file cũ
            "Pressure Data": repr(pres_by_day.get(vnd, [])),
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

# ===== Xuất JSON cho web (siêu an toàn) =====
def export_site_json(df, error_msg=None):
    def parse_repr(s):
        if not isinstance(s, str) or not s.strip():
            return []
        try:
            return ast.literal_eval(s)
        except Exception:
            return []

    def clean_str(x):
        if x is None:
            return ""
        if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
            return ""
        s = str(x).strip()
        return "" if s.lower() in ("nan", "none", "na", "null") else s

    def clean_num(x):
        if x is None or x == "":
            return None
        try:
            f = float(x)
            if math.isnan(f) or math.isinf(f):
                return None
            return f
        except Exception:
            return None

    if error_msg:
        with open(SITE_JSON, "w", encoding="utf-8") as f:
            json.dump({"error": error_msg}, f, ensure_ascii=False, indent=2)
        return

    try:
        df = df.copy()
        # Lọc đến hôm nay, bỏ NaN
        df["_d"] = df["Vietnam Date"].apply(parse_ddmmyyyy)
        df = df[df["_d"] <= today_local_date()].sort_values("_d").drop(columns=["_d"])
        df = df.fillna("")
        df = df.replace({"NaN": "", "nan": "", "NONE": "", "None": "", "NULL": "", "null": ""})

        days_out = []
        for _, row in df.iterrows():
            tidal_list = parse_repr(row.get("Tidal Data", ""))
            press_list = parse_repr(row.get("Pressure Data", ""))

            tidal_data = []
            if isinstance(tidal_list, list):
                for item in tidal_list:
                    if isinstance(item, dict):
                        tidal_data.append({
                            "time":   clean_str(item.get("time")),
                            "height": clean_num(item.get("height")),
                            "type":   clean_str(item.get("type")),
                        })

            pressure_data = []
            if isinstance(press_list, list):
                for item in press_list:
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
                "fish_caught":  clean_str(row.get("Fish Caught")),
                "user_score":   clean_str(row.get("User Fishing Score")),
                "user_notes":   clean_str(row.get("User Notes")),
            })

        # Thêm metadata debug để bạn dễ soát trên web
        payload = {
            "meta": {
                "generated_at": datetime.now(LOCAL_TZ).isoformat(),
                "rows": len(days_out),
            },
            "days": days_out
        }
        with open(SITE_JSON, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2, allow_nan=False)

    except Exception:
        # Ghi stacktrace đầy đủ để nhìn thấy dòng lỗi ngay trên web
        msg = "ETL error:\n" + traceback.format_exc()
        with open(SITE_JSON, "w", encoding="utf-8") as f:
            json.dump({"error": msg}, f, ensure_ascii=False, indent=2)
        raise

def main():
    try:
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
        export_site_json(df)  # không lỗi → ghi bình thường
        print(f"[OK] rows={len(df)} → {SITE_JSON}")
    except Exception as e:
        msg = f"ETL error: {e}"
        # cũng ghi vào JSON cho web
        export_site_json(pd.DataFrame(), error_msg=msg)
        print(msg)

if __name__ == "__main__":
    main()
