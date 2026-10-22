#!/usr/bin/env python3
"""Build data/surveys.json and data/meta.json from the GNC tracker Google Sheet.

Usage:
    python scripts/build_data.py                    # reads the URL in $SHEET_CSV_URL
    python scripts/build_data.py --input file.csv   # reads a local CSV (for testing)

The business rules are numbered as in CLAUDE.md, section 4.3.
Only the Python standard library is used.

If the sheet cannot be read or fails validation, the script exits with an error
and leaves the existing JSON files untouched, so the website keeps the last good data.
"""

import argparse
import csv
import io
import json
import os
import re
import sys
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

HEADER_FIRST_CELL = "Assessment ID"

# Source column name -> output key. These columns must exist in the sheet.
COLUMNS = {
    "Assessment ID": "id",
    "Region": "region",
    "Country": "country",
    "Country ISO3": "iso3",
    "Admin 1 name": "admin1",
    "Admin 1 Pcode": "admin1_pcode",
    "Assessment type": "type_raw",
    "Status": "status",
    "Start date": "start_date",
    "End Date": "end_date",
    "Lead organization": "lead_org",
    "Partners": "partners",
    "Report Link": "report_url",
    "Validation": "validation",
    "Budget": "budget",
}

# Below this many rows we assume the sheet is broken (emptied by mistake, wrong tab...).
MIN_ROWS = 10


class SourceError(Exception):
    """The source sheet is unreachable or unusable. Nothing is written."""


# ---------------------------------------------------------------------------
# Reading the source
# ---------------------------------------------------------------------------

def fetch_csv(url):
    """Download the published Google Sheet as text (Google redirects once; urllib follows)."""
    request = urllib.request.Request(url, headers={"User-Agent": "gnc-assessment-tracker"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read().decode("utf-8-sig")
    except Exception as exc:  # network error, 404, etc.
        raise SourceError(f"Could not download the sheet: {exc}") from exc


def read_rows(csv_text):
    """Return the data rows as dicts, keyed by the source column names.

    The sheet has a title row and a blank row above the header, so we look for
    the row whose first cell is 'Assessment ID' instead of assuming row 1.
    """
    rows = list(csv.reader(io.StringIO(csv_text)))
    header_index = next(
        (i for i, row in enumerate(rows) if row and row[0].strip() == HEADER_FIRST_CELL),
        None,
    )
    if header_index is None:
        raise SourceError(f"No header row starting with '{HEADER_FIRST_CELL}' was found.")

    header = [cell.strip() for cell in rows[header_index]]
    missing = [name for name in COLUMNS if name not in header]
    if missing:
        raise SourceError(f"Missing columns in the sheet: {', '.join(missing)}")

    records = []
    for row in rows[header_index + 1:]:
        if not any(cell.strip() for cell in row):
            continue  # skip blank lines
        row = row + [""] * (len(header) - len(row))
        records.append({name: row[header.index(name)].strip() for name in COLUMNS})
    return records


# ---------------------------------------------------------------------------
# Normalisation rules (CLAUDE.md 4.3)
# ---------------------------------------------------------------------------

def clean(value):
    """Empty strings become None."""
    value = (value or "").strip()
    return value or None


# Rule 1: assessment type -> type_group
TYPE_GROUPS = {
    "smart": "SMART",
    "rapid smart": "Rapid SMART",
    "mics": "MICS",
    "dhs": "DHS",
    "ipc amn": "IPC AMN",
}


def type_group(type_raw):
    """Map the free-text type to one of the main groups, otherwise 'Other'."""
    key = re.sub(r"\s+", " ", (type_raw or "").strip().lower())
    return TYPE_GROUPS.get(key, "Other")


# Rule 2: status
STATUSES = {"planned": "Planned", "ongoing": "Ongoing", "completed": "Completed", "not planned": "Not planned"}


def normalise_status(value):
    """Return the canonical status, or None when the value is not one of the four."""
    return STATUSES.get((value or "").strip().lower())


# Rule 3: display status (drives every colour in the UI)
def display_status(status, validation):
    if status == "Planned":
        return "planned"
    if status == "Ongoing":
        return "ongoing"
    if status == "Completed":
        if (validation or "").strip().lower().startswith("results released"):
            return "released"
        return "completed"  # completed, awaiting release
    if status == "Not planned":
        return "not_planned"
    return None


# Rule 4: sub-stage = Validation text without the date in brackets
def sub_stage(validation):
    text = re.sub(r"\s*\(.*?\)\s*$", "", (validation or "").strip())
    return text or None


# Rule 5: release date from "Results released (YYYY-MM-DD)"
RELEASE_RE = re.compile(r"results released\s*\((\d{4}-\d{2}-\d{2})\)", re.IGNORECASE)


def release_date(validation):
    match = RELEASE_RE.search(validation or "")
    if not match:
        return None
    try:
        return date.fromisoformat(match.group(1)).isoformat()
    except ValueError:
        return None


# Rule 8: dates. Google Sheets exports dates as displayed, so several formats are accepted.
# Best practice: format the date columns as yyyy-mm-dd in the sheet.
def parse_date(value, warnings, row_id, column):
    """Return an ISO date string or None. Never invents a date."""
    text = (value or "").strip()
    if not text:
        return None
    text = text.split(" ")[0]  # drop a time part such as "2026-02-26 00:00:00"

    if re.fullmatch(r"\d{4}-\d{1,2}-\d{1,2}", text):
        y, m, d = (int(p) for p in text.split("-"))
        return _safe_date(y, m, d, warnings, row_id, column, value)

    match = re.fullmatch(r"(\d{1,2})[/.](\d{1,2})[/.](\d{4})", text)
    if match:
        a, b, y = (int(p) for p in match.groups())
        if a > 12:        # 26/02/2026 -> day first
            d, m = a, b
        elif b > 12:      # 02/26/2026 -> month first
            m, d = a, b
        else:             # 01/02/2026 is ambiguous: assume day first (DD/MM/YYYY)
            d, m = a, b
            warnings.append(
                f"{row_id}: {column} '{value}' is ambiguous, read as DD/MM/YYYY. "
                "Format the date columns as yyyy-mm-dd in the sheet to avoid this."
            )
        return _safe_date(y, m, d, warnings, row_id, column, value)

    warnings.append(f"{row_id}: {column} '{value}' is not a recognised date; left empty.")
    return None


def _safe_date(y, m, d, warnings, row_id, column, original):
    try:
        return date(y, m, d).isoformat()
    except ValueError:
        warnings.append(f"{row_id}: {column} '{original}' is not a valid date; left empty.")
        return None


# Rule 6: survey year from the Assessment ID (ISO3-YEAR-TYPE-NN), else the start date year
def survey_year(assessment_id, start_date):
    match = re.match(r"^[A-Za-z]{3}-(\d{4})-", (assessment_id or "").strip())
    if match:
        return int(match.group(1))
    if start_date:
        return int(start_date[:4])
    return None


# Rule 7: funding
FUNDING = {"funded": "funded", "partially funded": "partial", "unfunded": "unfunded"}


def funding(budget):
    return FUNDING.get((budget or "").strip().lower())


def funding_gap(funding_value):
    if funding_value is None:
        return None
    return funding_value in ("partial", "unfunded")


# Rule 9: no date-based flags. Nothing here computes "overdue", "late" or similar, on purpose.
# Rule 10 (freshness) is computed in the browser, so it follows the filters.


def normalise(record, warnings):
    """Turn one source row into one output survey object."""
    row_id = record["Assessment ID"] or "(no ID)"

    status = normalise_status(record["Status"])
    if status is None:
        warnings.append(f"{row_id}: unknown Status '{record['Status']}'.")

    budget = record["Budget"]
    funding_value = funding(budget)
    if budget and funding_value is None:
        warnings.append(f"{row_id}: unknown Budget value '{budget}'.")

    start = parse_date(record["Start date"], warnings, row_id, "Start date")
    end = parse_date(record["End Date"], warnings, row_id, "End Date")
    validation = record["Validation"]

    return {
        "id": clean(record["Assessment ID"]),
        "region": clean(record["Region"]),
        "country": clean(record["Country"]),
        "iso3": (clean(record["Country ISO3"]) or "").upper() or None,
        "admin1": clean(record["Admin 1 name"]),
        "admin1_pcode": clean(record["Admin 1 Pcode"]),
        "type_raw": clean(record["Assessment type"]),
        "type_group": type_group(record["Assessment type"]),
        "status": status,
        "display_status": display_status(status, validation),
        "sub_stage": sub_stage(validation),
        "start_date": start,
        "end_date": end,
        "release_date": release_date(validation),
        "survey_year": survey_year(record["Assessment ID"], start),
        "lead_org": clean(record["Lead organization"]),
        "partners": clean(record["Partners"]),
        "report_url": clean(record["Report Link"]),
        "funding": funding_value,
        "funding_gap": funding_gap(funding_value),
    }


def build(csv_text):
    """Return (surveys, warnings). Raises SourceError if the sheet is unusable."""
    records = read_rows(csv_text)
    if len(records) < MIN_ROWS:
        raise SourceError(f"Only {len(records)} rows found (minimum {MIN_ROWS}); the sheet looks broken.")

    warnings = []
    surveys = [normalise(record, warnings) for record in records]

    seen = set()
    for survey in surveys:
        if not survey["id"]:
            warnings.append(f"Row for {survey['country'] or 'unknown country'} has no Assessment ID.")
        elif survey["id"] in seen:
            warnings.append(f"{survey['id']}: duplicate Assessment ID.")
        seen.add(survey["id"])
        if not survey["iso3"]:
            warnings.append(f"{survey['id']}: no Country ISO3, it will not appear on the map.")

    return surveys, warnings


# ---------------------------------------------------------------------------
# Writing the output
# ---------------------------------------------------------------------------

def write_outputs(surveys, warnings, data_dir=DATA_DIR):
    """Write the JSON files only if the data changed. Returns True when files were written."""
    data_dir.mkdir(parents=True, exist_ok=True)
    surveys_path = data_dir / "surveys.json"
    meta_path = data_dir / "meta.json"

    new_surveys = json.dumps(surveys, ensure_ascii=False, indent=1) + "\n"
    old_surveys = surveys_path.read_text(encoding="utf-8") if surveys_path.exists() else None
    old_meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}

    if new_surveys == old_surveys and old_meta.get("warnings") == warnings:
        return False

    meta = {
        "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "row_count": len(surveys),
        "warnings": warnings,
    }
    # Write to temporary files first, then swap, so a crash never leaves half a file.
    for path, content in ((surveys_path, new_surveys),
                          (meta_path, json.dumps(meta, ensure_ascii=False, indent=1) + "\n")):
        tmp = path.with_suffix(".tmp")
        tmp.write_text(content, encoding="utf-8")
        tmp.replace(path)
    return True


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", help="Local CSV file to read instead of $SHEET_CSV_URL")
    parser.add_argument("--out", default=str(DATA_DIR), help="Output folder (default: data/)")
    args = parser.parse_args(argv)

    try:
        if args.input:
            csv_text = Path(args.input).read_text(encoding="utf-8-sig")
        else:
            url = os.environ.get("SHEET_CSV_URL")
            if not url:
                raise SourceError("SHEET_CSV_URL is not set.")
            csv_text = fetch_csv(url)
        surveys, warnings = build(csv_text)
    except SourceError as exc:
        print(f"ERROR: {exc}\nThe existing data files were left unchanged.", file=sys.stderr)
        return 1

    changed = write_outputs(surveys, warnings, Path(args.out))
    print(f"{len(surveys)} surveys, {len(warnings)} warnings. "
          f"{'Data files updated.' if changed else 'No change.'}")
    for warning in warnings:
        print(f"  warning: {warning}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
