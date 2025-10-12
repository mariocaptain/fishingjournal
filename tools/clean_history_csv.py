#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Clean history.csv:
- Replace any cell that is "NaN"/"nan"/"None"/"NONE" (or actual NaN) -> empty string.
- In columns "Tidal Data" and "Pressure Data", also replace token NaN/nan -> None
  so that ast.literal_eval can parse later (no invalid JSON).
- Keep column order; create a timestamped backup before writing.
"""

import argparse
import os
import sys
import re
import shutil
from datetime import datetime

import pandas as pd
import numpy as np

SAFE_EMPTY_TOKENS = {"nan", "NaN", "NAN", "None", "NONE", "null", "NULL"}

LIST_COLS = ["Tidal Data", "Pressure Data"]

TOKEN_NAN_RE = re.compile(r"\bNaN\b|\bnan\b")   # for list columns

def clean_scalar_cell(val):
    """Return cleaned string for a scalar cell."""
    if val is None:
        return ""
    # turn numpy NaN -> empty
    if isinstance(val, float) and (np.isnan(val) or np.isinf(val)):
        return ""
    s = str(val).strip()
    if s in SAFE_EMPTY_TOKENS:
        return ""
    return s

def clean_list_string(s):
    """
    Clean string that represents a Python list/dict literal:
    - Replace NaN/nan token -> None (so literal_eval works later).
    - Leave 'None' as-is.
    """
    if s is None:
        return ""
    s = str(s)
    if not s:
        return s
    # Replace bare NaN/nan tokens with None
    s2 = TOKEN_NAN_RE.sub("None", s)
    # Also collapse 'None' surrounded by commas/spaces properly (no-op mostly)
    return s2

def main():
    ap = argparse.ArgumentParser(description="Clean history.csv for JSON-safe values.")
    ap.add_argument("csv_path", help="Path to history.csv (e.g., data/history.csv)")
    ap.add_argument("--inplace", action="store_true",
                    help="Write cleaned CSV back to the same path (creates a backup).")
    ap.add_argument("--out", default=None, help="Optional output CSV path (if not --inplace).")
    args = ap.parse_args()

    in_path = args.csv_path
    if not os.path.exists(in_path):
        print(f"[ERR] File not found: {in_path}", file=sys.stderr)
        sys.exit(1)

    # Read as strings to avoid implicit NaN conversions
    df = pd.read_csv(in_path, dtype=str, keep_default_na=False, na_values=[])

    # Track stats
    total_cells = df.size
    replaced_scalar = 0
    replaced_list_tokens = 0

    # Ensure the list columns exist (if not, skip gracefully)
    present_list_cols = [c for c in LIST_COLS if c in df.columns]

    # First pass: clean scalar cells (all columns)
    for col in df.columns:
        if col in present_list_cols:
            continue
        # count replacements
        col_series = df[col]
        new_series = []
        for v in col_series:
            nv = clean_scalar_cell(v)
            if nv != v:
                replaced_scalar += 1
            new_series.append(nv)
        df[col] = new_series

    # Second pass: clean list columns as raw strings
    for col in present_list_cols:
        col_series = df[col]
        new_series = []
        for v in col_series:
            if v is None or v == "":
                new_series.append("")
                continue
            cleaned = clean_list_string(v)
            if cleaned != v:
                # Count roughly by number of NaN tokens replaced
                replaced_list_tokens += len(TOKEN_NAN_RE.findall(v))
            new_series.append(cleaned)
        df[col] = new_series

    # One more pass to normalize any residual textual tokens across all cells
    # (e.g., "NaN" left somewhere else)
    for col in df.columns:
        col_series = df[col]
        new_series = []
        for v in col_series:
            nv = v
            if isinstance(nv, str) and nv.strip() in SAFE_EMPTY_TOKENS:
                replaced_scalar += 1
                nv = ""
            new_series.append(nv)
        df[col] = new_series

    # Decide output path
    if args.inplace:
        # Backup
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = f"{in_path}.bak_{ts}"
        shutil.copy2(in_path, backup_path)
        out_path = in_path
    else:
        out_path = args.out or (os.path.splitext(in_path)[0] + ".clean.csv")

    # Write CSV (UTF-8)
    df.to_csv(out_path, index=False)

    print(f"[OK] Cleaned CSV written to: {out_path}")
    if args.inplace:
        print(f"[OK] Backup created: {backup_path}")
    print(f"[STATS] Total cells: {total_cells}, scalar replacements: {replaced_scalar}, "
          f"list-token (NaN→None) replacements: {replaced_list_tokens}")

if __name__ == "__main__":
    main()
