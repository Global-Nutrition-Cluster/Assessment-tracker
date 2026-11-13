#!/usr/bin/env python3
"""Build data/results.json and data/results_meta.json for the Results page.

Sources (CLAUDE.md section 11.1):
  - SMART results, sheet "Consolidation"  -> $SMART_RESULTS_CSV_URL (Google Sheet published as CSV)
  - SMART surveys, sheet "Surveys"        -> $SMART_SURVEYS_CSV_URL
  - Indicators of the selector, sheet "Dashboard indicators" (labels, definitions, phases)
                                          -> $RESULTS_INDICATORS_CSV_URL
  - DHS indicators and surveys            -> data/dhs/*.csv (written by the "Update DHS data" workflow)
  - Planning tracker, for the ID check    -> data/surveys.json (written by build_data.py)

Usage:
    python scripts/build_results.py
    python scripts/build_results.py --smart-results file.csv --smart-surveys file.csv --indicators file.csv

The business rules are numbered as in CLAUDE.md, section 11.3. Values are kept as published:
nothing is recalculated. Only the Python standard library is used.

If a source cannot be read or fails validation, the script exits with an error and leaves the
existing JSON files untouched, so the website keeps the last good data.
"""

import argparse
import csv
import io
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_data import SourceError, clean, fetch_csv, web_link  # noqa: E402  (same helpers as the Planning data)

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DHS_VALUES_FILE = DATA_DIR / "dhs" / "dhs_latest_indicators_national.csv"
DHS_SURVEYS_FILE = DATA_DIR / "dhs" / "dhs_surveys.csv"
PLANNING_FILE = DATA_DIR / "surveys.json"

# Below these numbers we assume a source is broken (emptied by mistake, wrong tab...).
MIN_SMART_VALUES = 100
MIN_DHS_VALUES = 100

SMART_RESULT_COLUMNS = [
    "Result ID", "Assessment ID", "Country", "Country ISO3", "Assessment type",
    "Data collection start", "Data collection end", "Area name", "Area level", "Parent area",
    "Population group", "Age group", "Indicator code", "Indicator", "Value", "CI lower", "CI upper",
    "Unit", "n (cases or deaths)", "N (sample)", "Recall period", "Automatic check", "Review status", "Notes",
]
SMART_SURVEY_COLUMNS = [
    "Assessment ID", "Country", "Country ISO3", "Assessment type", "Survey title", "Lead organization",
    "Data collection start", "Data collection end", "Geographic coverage", "Mortality recall period", "Notes",
]
# Optional: filled by the owner, one URL per survey. Empty or absent -> no report link on the page.
SMART_REPORT_LINK_COLUMN = "Report link"

# ---------------------------------------------------------------------------
# Indicator list (rule 11.3.0): the "Dashboard indicators" Google Sheet, $RESULTS_INDICATORS_CSV_URL.
# One row per indicator of the selector, in the order of the sheet. It holds the labels, the
# definitions and the phases (thresholds + names + who set them). Nothing about indicators is
# hard-coded here any more (owner's decision, Nov 2026).
# ---------------------------------------------------------------------------

INDICATOR_COLUMNS = [
    "Indicator key", "Group", "Label", "Unit", "SMART code", "DHS ID",
    "SMART definition", "DHS definition", "Phase thresholds", "Phase labels", "Phase source",
]
NO_PHASES = "none"          # keyword in "Phase thresholds" for an indicator without phases
DIRECTION_COLUMN = "Higher value is"   # optional column: worse (default) or better (e.g. dietary diversity)
COLOURS_COLUMN = "Phase colours"       # optional column: colour step 1-5 of each phase, e.g. 1;3;4;5
PALETTE_COLUMN = "Phase palette"       # optional column: IPC (IPC phase colours) or blue (default)
PALETTES = ("ipc", "blue")
MAX_PHASES = 5              # the map has five colours
MIN_INDICATORS = 1

PCT = "%"
PER_1000 = "per 1,000 live births"


def split_list(text):
    """'2.5; 5;10 ' -> ['2.5', '5', '10']."""
    return [part.strip() for part in (text or "").split(";") if part.strip()]


def parse_phases(row, warnings):
    """Rule 11.3.7: phases of one indicator, or None.

    "Phase thresholds" = the upper limits between phases, ascending, separated by ';' (e.g. 2.5;5;10;15),
    or the keyword none. "Phase labels" = one name per phase, from the lowest value to the highest,
    so one more than the thresholds. "Higher value is" (optional) = worse (default) or better.
    "Phase colours" (optional) = the colour step 1-5 of each phase (see phase_colours).
    "Phase palette" (optional) = IPC for the IPC phase colours (green-yellow-orange-red), or blue
    (default): the IPC colours are kept for the indicators the owner marks IPC (GAM by WHZ).
    "Phase source" = who set the phases (WHO 2018, GNC, IPC...). Values below the first threshold
    are in the first phase; a value equal to a threshold goes to the next phase (WHO: 10 is High).
    """
    key = row["Indicator key"]
    raw = row["Phase thresholds"].strip()
    if raw.lower() == NO_PHASES:
        return None
    if not raw:
        warnings.append(f"Indicator {key}: 'Phase thresholds' is empty; write {NO_PHASES} when there are no phases. "
                        "Shown without phases.")
        return None
    try:
        thresholds = [parse_number(t) for t in split_list(raw)]
    except ValueError:
        warnings.append(f"Indicator {key}: phase thresholds '{raw}' are not numbers separated by ';'. Shown without phases.")
        return None
    labels = split_list(row["Phase labels"])
    source = row["Phase source"].strip()
    problem = None
    if any(b <= a for a, b in zip(thresholds, thresholds[1:])):
        problem = "thresholds are not in ascending order"
    elif len(labels) != len(thresholds) + 1:
        problem = f"{len(thresholds)} thresholds need {len(thresholds) + 1} phase labels, found {len(labels)}"
    elif len(labels) > MAX_PHASES:
        problem = f"at most {MAX_PHASES} phases"
    elif not source:
        problem = "'Phase source' is empty (e.g. WHO 2018, GNC)"
    direction = (row.get(DIRECTION_COLUMN) or "worse").strip().lower()
    if not problem and direction not in ("worse", "better"):
        problem = f"'{DIRECTION_COLUMN}' must be worse or better, not '{direction}'"
    colours = phase_colours(row.get(COLOURS_COLUMN, ""), len(labels), direction == "better")
    if not problem and colours is None:
        problem = f"'{COLOURS_COLUMN}' must give one number from 1 to 5 per phase"
    palette = (row.get(PALETTE_COLUMN) or "blue").strip().lower()
    if not problem and palette not in PALETTES:
        problem = f"'{PALETTE_COLUMN}' must be IPC or blue, not '{palette}'"
    if problem:
        warnings.append(f"Indicator {key}: {problem}. Shown without phases.")
        return None
    return {"source": source, "thresholds": thresholds, "labels": labels,
            "higher_is_better": direction == "better", "colours": colours, "palette": palette}


def phase_colours(text, count, higher_is_better):
    """Colour step (0-4, lightest to darkest) of each phase, listed from the lowest value up.

    Default: phase 1 = step 1, phase 2 = step 2... so the same phase number has the same colour on every
    indicator (Critical is always the 4th colour). "Higher value is better" (e.g. dietary diversity):
    the lowest values are the most severe, so the default runs the other way. "Phase colours" overrides
    it when a phase covers two severity levels, e.g. 1;3;4;5 for CDR (Acceptable/Alert, Serious...).
    Returns None when the column is filled but unusable.
    """
    if not (text or "").strip():
        steps = list(range(count))
        return steps[::-1] if higher_is_better else steps
    try:
        steps = [int(parse_number(t)) - 1 for t in split_list(text)]
    except (ValueError, TypeError):
        return None
    if len(steps) != count or any(s < 0 or s > 4 for s in steps):
        return None
    return steps


def load_indicators(csv_text, warnings):
    """Rows of the "Dashboard indicators" sheet -> indicator list. Raises SourceError if unusable."""
    rows = read_table(csv_text, "Indicator key", INDICATOR_COLUMNS, "Dashboard indicators sheet")
    indicators, seen_keys, seen_codes = [], set(), {}
    for row in rows:
        key = row["Indicator key"]
        if key in seen_keys:
            warnings.append(f"Indicator {key}: appears twice in the indicator sheet; the first row is used.")
            continue
        smart, dhs = row["SMART code"] or None, row["DHS ID"] or None
        if not smart and not dhs:
            warnings.append(f"Indicator {key}: no SMART code and no DHS ID; left out of the selector.")
            continue
        for code in (smart, dhs):
            if code and code in seen_codes:
                warnings.append(f"Indicator {key}: code {code} is already used by {seen_codes[code]}; row left out.")
                break
        else:
            seen_keys.add(key)
            for code in (smart, dhs):
                if code:
                    seen_codes[code] = key
            indicators.append({
                "key": key,
                "group": row["Group"] or "Other",
                "label": row["Label"] or key,
                "unit": row["Unit"],
                "smart_code": smart,
                "dhs_id": dhs,
                "phases": parse_phases(row, warnings),
                "definition": {src: text for src, text in (("SMART", row["SMART definition"]),
                                                           ("DHS", row["DHS definition"])) if text},
                "selector": True,
            })
    if len(indicators) < MIN_INDICATORS:
        raise SourceError("Dashboard indicators sheet: no usable indicator row.")
    return indicators


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def read_table(csv_text, first_cell, required, name):
    """Rows as dicts. The header row is the first row whose first cell is `first_cell`
    (the sheet may have a title row above it)."""
    rows = list(csv.reader(io.StringIO(csv_text)))
    header_index = next((i for i, row in enumerate(rows) if row and row[0].strip() == first_cell), None)
    if header_index is None:
        raise SourceError(f"{name}: no header row starting with '{first_cell}' was found.")
    header = [cell.strip() for cell in rows[header_index]]
    missing = [col for col in required if col not in header]
    if missing:
        raise SourceError(f"{name}: missing columns: {', '.join(missing)}")
    records = []
    for row in rows[header_index + 1:]:
        if not any(cell.strip() for cell in row):
            continue
        row = row + [""] * (len(header) - len(row))
        records.append({col: row[i].strip() for i, col in enumerate(header) if col})
    return records


def parse_number(text):
    """'10.8', '10,8' or ' 10.8 ' -> 10.8; '' -> None. Raises ValueError for text such as 'n/a'."""
    text = (text or "").strip().replace(" ", "").replace(" ", "")
    if not text:
        return None
    if "," in text and "." not in text:
        text = text.replace(",", ".")      # decimal comma (sheet in a French locale)
    else:
        text = text.replace(",", "")       # thousands separator: 1,234.5
    value = float(text)
    return int(value) if value.is_integer() and "." not in text else value


def parse_month_or_date(text):
    """Data collection dates are 'YYYY-MM' or 'YYYY-MM-DD' in the extraction. Kept as given (rule 4.3.8)."""
    text = (text or "").strip().split(" ")[0]
    if re.fullmatch(r"\d{4}-\d{2}(-\d{2})?", text):
        return text
    return None


def year_of(date_text):
    return int(date_text[:4]) if date_text else None


# ---------------------------------------------------------------------------
# SMART (rules 11.3.1 to 11.3.6)
# ---------------------------------------------------------------------------


def normalise_age(text):
    """'0-59 months (as titled)' -> '0-59 months'. The report's own wording stays in the Notes."""
    return re.sub(r"\s*\(.*\)\s*$", "", (text or "").strip()) or None


def normalise_level(text):
    """'Stratum (part of Kabul province)' -> 'Stratum'. National, Admin 1, Admin 2 are kept."""
    text = (text or "").strip()
    return "Stratum" if text.lower().startswith("stratum") else (text or None)


def smart_survey_year(end, start):
    """Rule 11.3.5: year of the end of data collection, else of its start."""
    return year_of(end) or year_of(start)


def build_smart_surveys(rows, warnings):
    surveys = {}
    for row in rows:
        sid = row["Assessment ID"]
        if not sid:
            continue
        if sid in surveys:
            warnings.append(f"SMART Surveys sheet: {sid} appears twice; the first row is used.")
            continue
        start = parse_month_or_date(row["Data collection start"])
        end = parse_month_or_date(row["Data collection end"])
        surveys[sid] = {
            "id": sid,
            "source": "SMART",
            "country": clean(row["Country"]),
            "iso3": clean(row["Country ISO3"].upper()),
            "type_raw": clean(row["Assessment type"]),
            "title": clean(row["Survey title"]),
            "lead_org": clean(row["Lead organization"]),
            "start_date": start,
            "end_date": end,
            "survey_year": smart_survey_year(end, start),
            "coverage": clean(row["Geographic coverage"]),
            "recall_period": clean(row["Mortality recall period"]),
            "report_url": web_link(row.get(SMART_REPORT_LINK_COLUMN, ""), warnings, sid),
            "notes": clean(row["Notes"]),
        }
    return surveys


def smart_value(row, codes, warnings):
    """One Consolidation row -> one value, or None when the row has no usable value."""
    rid = row["Result ID"] or "(no Result ID)"
    try:
        value = parse_number(row["Value"])
        ci_lower = parse_number(row["CI lower"])
        ci_upper = parse_number(row["CI upper"])
        n = parse_number(row["n (cases or deaths)"])
        sample = parse_number(row["N (sample)"])
    except ValueError:
        warnings.append(f"{rid}: a number cannot be read (Value, CI, n or N); row left out.")
        return None
    if value is None:
        warnings.append(f"{rid}: no value; row left out.")
        return None

    code = row["Indicator code"].strip()
    key = codes.get(code)
    if key is None:
        warnings.append(f"{rid}: indicator code '{code}' is not in the Dashboard indicators sheet "
                        "(column SMART code); row left out.")
        return None

    # Rule 11.3.6: rows flagged by the extraction's automatic check are kept, and listed.
    check = clean(row["Automatic check"])
    if check:
        warnings.append(f"{rid}: automatic check '{check}' (value kept).")

    return {
        "survey": row["Assessment ID"],
        "source": "SMART",
        "type": "Rapid SMART" if row["Assessment type"].strip().lower() == "rapid smart" else "SMART",
        "iso3": row["Country ISO3"].strip().upper(),
        "area": clean(row["Area name"]),
        "area_level": normalise_level(row["Area level"]),
        "parent_area": clean(row["Parent area"]),
        "population": clean(row["Population group"]),
        "age_group": normalise_age(row["Age group"]),
        "indicator": key,
        "value": value,
        "ci_lower": ci_lower,
        "ci_upper": ci_upper,
        "n": n,
        "sample": sample,
        "recall_period": clean(row["Recall period"]),
        "review_status": clean(row["Review status"]),  # kept for later; the page shows "As published"
        "check": check,
        "note": clean(row["Notes"]),
        "result_id": clean(row["Result ID"]),
    }


def mark_alternative_ages(values):
    """Rule 11.3.4: when the same figure exists for 6-59 and 0-59 months, the 6-59 one is the main
    figure and the others get alt = True (shown in the country profile only)."""
    groups = {}
    for v in values:
        key = (v["survey"], v["type"], v["population"], v["area_level"], v["parent_area"], v["area"],
               v["indicator"])
        groups.setdefault(key, []).append(v)
    for items in groups.values():
        ages = {v["age_group"] for v in items}
        if len(items) > 1 and "6-59 months" in ages:
            for v in items:
                if v["age_group"] != "6-59 months":
                    v["alt"] = True


def check_ids(values, smart_surveys, planning, warnings):
    """Section 11.2: the planning tracker owns the Assessment IDs."""
    seen = {}
    for v in values:
        seen.setdefault(v["survey"], v["iso3"])
    for sid, iso3 in sorted(seen.items()):
        if sid not in smart_surveys:
            warnings.append(f"{sid}: in the Consolidation sheet but not in the SMART Surveys sheet.")
        if planning is None:
            continue
        if sid not in planning:
            warnings.append(f"{sid}: Assessment ID not found in the planning tracker.")
        elif planning[sid] and planning[sid] != iso3:
            warnings.append(f"{sid}: country {iso3} in the results but {planning[sid]} in the planning tracker.")


def build_smart(results_text, surveys_text, planning, indicators, warnings):
    result_rows = read_table(results_text, "Result ID", SMART_RESULT_COLUMNS, "SMART Consolidation sheet")
    survey_rows = read_table(surveys_text, "Assessment ID", SMART_SURVEY_COLUMNS, "SMART Surveys sheet")
    if len(result_rows) < MIN_SMART_VALUES:
        raise SourceError(f"SMART Consolidation sheet: only {len(result_rows)} rows (at least "
                          f"{MIN_SMART_VALUES} expected). Wrong tab or emptied sheet?")
    surveys = build_smart_surveys(survey_rows, warnings)
    codes = {i["smart_code"]: i["key"] for i in indicators if i["smart_code"]}
    values = [v for v in (smart_value(r, codes, warnings) for r in result_rows) if v]
    mark_alternative_ages(values)
    check_ids(values, surveys, planning, warnings)
    used = {v["survey"] for v in values}
    return [s for sid, s in surveys.items() if sid in used], values


# ---------------------------------------------------------------------------
# DHS (rules 11.3.2 and 11.3.3)
# ---------------------------------------------------------------------------

# Rows that only carry the precision of another row: the DHS extraction already copies the
# CI bounds into ci_lower / ci_upper of the main row, so these are dropped.
DHS_PRECISION_SUFFIXES = (" - standard error", " - relative error", " - CI lower bound", " - CI upper bound")

DHS_UNITS = {"Percent": PCT, "Mean": "", "Number": ""}


def is_dhs_precision_row(label):
    return any(suffix in (label or "") for suffix in DHS_PRECISION_SUFFIXES)


def dhs_unit(measurement_type, topic):
    if measurement_type == "Rate" and "Mortality" in (topic or ""):
        return PER_1000
    return DHS_UNITS.get(measurement_type, "")


def build_dhs(values_text, surveys_text, indicators, warnings):
    rows = read_table(values_text, "country",
                      ["country", "iso3", "indicator_id", "indicator", "topic", "measurement_type", "value",
                       "ci_lower", "ci_upper", "denominator_unweighted", "survey_id", "survey_year",
                       "release_date", "retrieval_date"], "DHS indicators file")
    plan = read_table(surveys_text, "assessment_id",
                      ["assessment_id", "country", "iso3", "survey_year", "start_date", "end_date",
                       "release_date", "lead_organization", "report_link"], "DHS surveys file")
    if len(rows) < MIN_DHS_VALUES:
        raise SourceError(f"DHS indicators file: only {len(rows)} rows (at least {MIN_DHS_VALUES} expected).")
    plan_by_id = {p["assessment_id"]: p for p in plan}
    dhs_keys = {i["dhs_id"]: i["key"] for i in indicators if i["dhs_id"]}

    extra_indicators = {}   # DHS indicators outside the selector ("More indicators" in the profile)
    values, surveys = [], {}
    for row in rows:
        if is_dhs_precision_row(row["indicator"]):
            continue
        try:
            value = parse_number(row["value"])
            ci_lower = parse_number(row["ci_lower"])
            ci_upper = parse_number(row["ci_upper"])
            sample = parse_number(row["denominator_unweighted"])
        except ValueError:
            warnings.append(f"DHS {row['survey_id']} {row['indicator_id']}: a number cannot be read; row left out.")
            continue
        if value is None:
            continue

        key = dhs_keys.get(row["indicator_id"])
        if key is None:
            key = row["indicator_id"]
            extra_indicators.setdefault(key, {
                "key": key, "group": row["topic"] or "Other", "label": row["indicator"],
                "unit": dhs_unit(row["measurement_type"], row["topic"]), "smart_code": None, "dhs_id": key,
                "phases": None, "definition": {}, "selector": False,
            })

        sid = row["survey_id"]
        if sid not in surveys:
            p = plan_by_id.get(sid, {})
            year = parse_number(row["survey_year"])
            surveys[sid] = {
                "id": sid,
                "source": "DHS",
                "country": clean(row["country"]),
                "iso3": clean(row["iso3"].upper()),
                "type_raw": "DHS",
                "title": f"{row['country']} Demographic and Health Survey {year}",
                "lead_org": clean(p.get("lead_organization")) or "The DHS Program",
                "start_date": clean(p.get("start_date")),
                "end_date": clean(p.get("end_date")),
                "survey_year": year,
                "release_date": clean(row["release_date"]),
                "retrieval_date": clean(row["retrieval_date"]),
                "coverage": "National",
                "report_url": web_link(p.get("report_link"), warnings, sid),
                "notes": None,
            }
        values.append({
            "survey": sid,
            "source": "DHS",
            "type": "DHS",
            "iso3": row["iso3"].strip().upper(),
            "area": clean(row["country"]),
            "area_level": "National",
            "population": "General population",
            "indicator": key,
            "value": value,
            "ci_lower": ci_lower,
            "ci_upper": ci_upper,
            "sample": sample,
        })
    return list(surveys.values()), values, list(extra_indicators.values())


# ---------------------------------------------------------------------------
# Putting it together
# ---------------------------------------------------------------------------


def load_planning(path=PLANNING_FILE):
    """Assessment ID -> ISO3 of the planning tracker, or None if the file is missing."""
    if not path.exists():
        return None
    return {s["id"]: s.get("iso3") for s in json.loads(path.read_text(encoding="utf-8"))}


def compact(record):
    """Drop empty fields to keep the JSON small (missing = null for the page)."""
    return {k: v for k, v in record.items() if v is not None and v is not False}


def build(smart_results_text, smart_surveys_text, dhs_values_text, dhs_surveys_text, planning, indicators_text):
    warnings = []
    indicators = load_indicators(indicators_text, warnings)
    smart_surveys, smart_values = build_smart(smart_results_text, smart_surveys_text, planning, indicators, warnings)
    dhs_surveys, dhs_values, dhs_extra = build_dhs(dhs_values_text, dhs_surveys_text, indicators, warnings)

    countries = {}
    for s in smart_surveys + dhs_surveys:
        if s["iso3"]:
            countries.setdefault(s["iso3"], s["country"])

    results = {
        "indicators": indicators + sorted(dhs_extra, key=lambda i: (i["group"], i["label"])),
        "countries": dict(sorted(countries.items())),
        "surveys": [compact(s) for s in smart_surveys + dhs_surveys],
        "values": [compact(v) for v in smart_values + dhs_values],
    }
    counts = {
        "smart_surveys": len(smart_surveys),
        "smart_values": len(smart_values),
        "dhs_surveys": len(dhs_surveys),
        "dhs_values": len(dhs_values),
        "countries": len(countries),
    }
    return results, counts, warnings


def dump_results(results):
    """One survey or value per line: small file, readable diffs in GitHub."""
    def lines(items):
        return ",\n".join("  " + json.dumps(item, ensure_ascii=False, separators=(",", ":")) for item in items)
    return ("{\n"
            f'"indicators": [\n{lines(results["indicators"])}\n],\n'
            f'"countries": {json.dumps(results["countries"], ensure_ascii=False)},\n'
            f'"surveys": [\n{lines(results["surveys"])}\n],\n'
            f'"values": [\n{lines(results["values"])}\n]\n'
            "}\n")


def write_outputs(results, counts, warnings, data_dir=DATA_DIR):
    """Write the JSON files only if the data changed. Returns True when files were written."""
    data_dir.mkdir(parents=True, exist_ok=True)
    results_path = data_dir / "results.json"
    meta_path = data_dir / "results_meta.json"

    new_results = dump_results(results)
    old_results = results_path.read_text(encoding="utf-8") if results_path.exists() else None
    old_meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    if new_results == old_results and old_meta.get("warnings") == warnings:
        return False

    meta = {
        "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "counts": counts,
        "warnings": warnings,
    }
    for path, content in ((results_path, new_results),
                          (meta_path, json.dumps(meta, ensure_ascii=False, indent=1) + "\n")):
        tmp = path.with_suffix(".tmp")
        tmp.write_text(content, encoding="utf-8")
        tmp.replace(path)
    return True


def read_source(local_path, env_name):
    if local_path:
        return Path(local_path).read_text(encoding="utf-8-sig")
    url = os.environ.get(env_name)
    if not url:
        raise SourceError(f"{env_name} is not set.")
    return fetch_csv(url)


def read_file(path):
    if not path.exists():
        raise SourceError(f"{path.relative_to(ROOT)} is missing.")
    return path.read_text(encoding="utf-8-sig")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--smart-results", help="Local CSV of the Consolidation sheet instead of $SMART_RESULTS_CSV_URL")
    parser.add_argument("--smart-surveys", help="Local CSV of the Surveys sheet instead of $SMART_SURVEYS_CSV_URL")
    parser.add_argument("--indicators", help="Local CSV of the Dashboard indicators sheet instead of $RESULTS_INDICATORS_CSV_URL")
    parser.add_argument("--out", default=str(DATA_DIR), help="Output folder (default: data/)")
    args = parser.parse_args(argv)

    try:
        results, counts, warnings = build(
            read_source(args.smart_results, "SMART_RESULTS_CSV_URL"),
            read_source(args.smart_surveys, "SMART_SURVEYS_CSV_URL"),
            read_file(DHS_VALUES_FILE),
            read_file(DHS_SURVEYS_FILE),
            load_planning(),
            read_source(args.indicators, "RESULTS_INDICATORS_CSV_URL"),
        )
    except SourceError as exc:
        print(f"ERROR: {exc}\nThe existing results files were left unchanged.", file=sys.stderr)
        return 1

    changed = write_outputs(results, counts, warnings, Path(args.out))
    print(f"{counts}. {len(warnings)} warnings. {'Results files updated.' if changed else 'No change.'}")
    for warning in warnings:
        print(f"  warning: {warning}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
