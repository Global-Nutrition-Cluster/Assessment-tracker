#!/usr/bin/env python3
"""Build data/results.json and data/results_meta.json for the Results page.

Sources (CLAUDE.md section 11.1):
  - SMART results, sheet "Consolidation"  -> $SMART_RESULTS_CSV_URL (Google Sheet published as CSV)
  - SMART surveys, sheet "Surveys"        -> $SMART_SURVEYS_CSV_URL
  - DHS indicators and surveys            -> data/dhs/*.csv (written by the "Update DHS data" workflow)
  - Planning tracker, for the ID check    -> data/surveys.json (written by build_data.py)

Usage:
    python scripts/build_results.py
    python scripts/build_results.py --smart-results file.csv --smart-surveys file.csv   # local test files

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
from build_data import SourceError, clean, fetch_csv  # noqa: E402  (same helpers as the Planning data)

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
# Indicator list (rule 11.3.2)
# One entry per indicator of the selector. A key is shared by SMART and DHS only when the
# definition is the same (stunting, underweight) or, for wasting, when both are shown side by
# side with their own definition line. Everything else stays per source.
# "classes" = WHO 2018 prevalence thresholds (rule 11.3.7): Very low < t1 <= Low < t2 ...
# ---------------------------------------------------------------------------

WASTING_CLASSES = [2.5, 5, 10, 15]
STUNTING_CLASSES = [2.5, 10, 20, 30]
OVERWEIGHT_CLASSES = [2.5, 5, 10, 15]

PCT = "%"
DEATHS_DAY = "deaths/10,000/day"
PER_1000 = "per 1,000 live births"


def ind(key, group, label, unit, smart=None, dhs=None, classes=None, smart_def=None, dhs_def=None):
    return {
        "key": key, "group": group, "label": label, "unit": unit,
        "smart_code": smart, "dhs_id": dhs, "classes": classes,
        "definition": {k: v for k, v in (("SMART", smart_def), ("DHS", dhs_def)) if v},
        "selector": True,
    }


INDICATORS = [
    ind("GAM_WHZ", "Acute malnutrition", "Wasting — GAM by weight-for-height (WHZ)", PCT,
        smart="GAM_WHZ", dhs="CN_NUTS_C_WH2", classes=WASTING_CLASSES,
        smart_def="WHZ < −2 and/or oedema, 6–59 months", dhs_def="WHZ < −2, no oedema, 0–59 months"),
    ind("SAM_WHZ", "Acute malnutrition", "SAM by weight-for-height (WHZ)", PCT,
        smart="SAM_WHZ", dhs="CN_NUTS_C_WH3",
        smart_def="WHZ < −3 and/or oedema, 6–59 months", dhs_def="WHZ < −3, no oedema, 0–59 months"),
    ind("MAM_WHZ", "Acute malnutrition", "MAM by weight-for-height (WHZ)", PCT, smart="MAM_WHZ",
        smart_def="WHZ ≥ −3 and < −2, no oedema, 6–59 months"),
    ind("GAM_MUAC", "Acute malnutrition", "GAM by MUAC", PCT, smart="GAM_MUAC",
        smart_def="MUAC < 125 mm and/or oedema, 6–59 months"),
    ind("SAM_MUAC", "Acute malnutrition", "SAM by MUAC", PCT, smart="SAM_MUAC",
        smart_def="MUAC < 115 mm and/or oedema, 6–59 months"),
    ind("MAM_MUAC", "Acute malnutrition", "MAM by MUAC", PCT, smart="MAM_MUAC",
        smart_def="MUAC 115–124 mm, no oedema, 6–59 months"),
    ind("GAM_COMB", "Acute malnutrition", "GAM combined (WHZ or MUAC)", PCT, smart="GAM_COMB",
        smart_def="WHZ < −2 and/or MUAC < 125 mm and/or oedema"),
    ind("SAM_COMB", "Acute malnutrition", "SAM combined (WHZ or MUAC)", PCT, smart="SAM_COMB",
        smart_def="WHZ < −3 and/or MUAC < 115 mm and/or oedema"),
    ind("MAM_COMB", "Acute malnutrition", "MAM combined (WHZ or MUAC)", PCT, smart="MAM_COMB"),

    ind("CDR", "Mortality", "Crude death rate (CDR)", DEATHS_DAY, smart="CDR",
        smart_def="Deaths per 10,000 people per day, recall period of a few months"),
    ind("U5DR", "Mortality", "Under-five death rate (U5DR)", DEATHS_DAY, smart="U5DR",
        smart_def="Deaths of children under 5 per 10,000 per day, recall period of a few months"),
    ind("U5MR", "Mortality", "Under-five mortality rate", PER_1000, dhs="CM_ECMR_C_U5M",
        dhs_def="Deaths before age 5 per 1,000 live births, 5 years before the survey"),
    ind("IMR", "Mortality", "Infant mortality rate", PER_1000, dhs="CM_ECMT_C_IMR",
        dhs_def="Deaths before age 1 per 1,000 live births, 5 years before the survey"),
    ind("CMR", "Mortality", "Child mortality rate (1–4 years)", PER_1000, dhs="CM_ECMT_C_CMR",
        dhs_def="Deaths between age 1 and 5 per 1,000 children reaching age 1, 5 years before the survey"),

    ind("ILLNESS", "Morbidity", "Any illness (SMART)", PCT, smart="ILLNESS",
        smart_def="Children under 5, 2 weeks before the survey"),
    ind("DIAR", "Morbidity", "Diarrhoea (SMART)", PCT, smart="DIAR",
        smart_def="Children under 5, 2 weeks before the survey"),
    ind("FEVER", "Morbidity", "Fever (SMART)", PCT, smart="FEVER",
        smart_def="Children under 5, 2 weeks before the survey"),
    ind("ARI", "Morbidity", "Acute respiratory infection, ARI (SMART)", PCT, smart="ARI",
        smart_def="Children under 5, 2 weeks before the survey"),
    ind("COUGH", "Morbidity", "Cough (SMART)", PCT, smart="COUGH",
        smart_def="Children under 5, 2 weeks before the survey"),
    ind("DIAR_ILL", "Morbidity", "Diarrhoea among children reported ill (SMART)", PCT, smart="DIAR_ILL",
        smart_def="Share of the children reported ill, not a prevalence"),
    ind("FEVER_ILL", "Morbidity", "Fever among children reported ill (SMART)", PCT, smart="FEVER_ILL",
        smart_def="Share of the children reported ill, not a prevalence"),
    ind("ARI_ILL", "Morbidity", "ARI / cough among children reported ill (SMART)", PCT, smart="ARI_ILL",
        smart_def="Share of the children reported ill, not a prevalence"),
    ind("COUGH_ILL", "Morbidity", "Cough among children reported ill (SMART)", PCT, smart="COUGH_ILL",
        smart_def="Share of the children reported ill, not a prevalence"),
    ind("DHS_DIAR", "Morbidity", "Diarrhoea (DHS)", PCT, dhs="CH_DIAR_C_DIA",
        dhs_def="Children under 5, 2 weeks before the survey"),
    ind("DHS_FEVER", "Morbidity", "Fever (DHS)", PCT, dhs="CH_FEVR_C_FEV",
        dhs_def="Children under 5, 2 weeks before the survey"),
    ind("DHS_ARI", "Morbidity", "Acute respiratory infection, ARI (DHS)", PCT, dhs="CH_ARIS_C_ARI",
        dhs_def="Children under 5 with ARI symptoms, 2 weeks before the survey"),

    ind("STUNT", "Stunting", "Stunting (HAZ < −2)", PCT, smart="STUNT", dhs="CN_NUTS_C_HA2",
        classes=STUNTING_CLASSES, smart_def="6–59 months", dhs_def="0–59 months"),
    ind("STUNT_SEV", "Stunting", "Severe stunting (HAZ < −3)", PCT, smart="STUNT_SEV", dhs="CN_NUTS_C_HA3",
        smart_def="6–59 months", dhs_def="0–59 months"),
    ind("STUNT_MOD", "Stunting", "Moderate stunting (HAZ ≥ −3 and < −2)", PCT, smart="STUNT_MOD",
        smart_def="6–59 months"),

    ind("UW", "Underweight", "Underweight (WAZ < −2)", PCT, smart="UW", dhs="CN_NUTS_C_WA2",
        smart_def="6–59 months", dhs_def="0–59 months"),
    ind("UW_SEV", "Underweight", "Severe underweight (WAZ < −3)", PCT, smart="UW_SEV", dhs="CN_NUTS_C_WA3",
        smart_def="6–59 months", dhs_def="0–59 months"),
    ind("UW_MOD", "Underweight", "Moderate underweight (WAZ ≥ −3 and < −2)", PCT, smart="UW_MOD",
        smart_def="6–59 months"),

    ind("OVERWEIGHT", "Overweight", "Overweight (WHZ > +2)", PCT, dhs="CN_NUTS_C_WHP",
        classes=OVERWEIGHT_CLASSES, dhs_def="0–59 months"),
    ind("WHZ_MEAN", "Overweight", "Mean weight-for-height z-score", "", dhs="CN_NUTS_C_WHM",
        dhs_def="0–59 months"),
    ind("MMF", "Infant and young child feeding", "Minimum meal frequency, 6–23 months", PCT,
        dhs="CN_IYCF_C_MNA", dhs_def="Children 6–23 months fed the minimum number of times"),
    ind("WOMEN_THIN", "Adult nutrition", "Women thin, BMI < 18.5", PCT, dhs="AN_NUTS_W_THN",
        dhs_def="Women 15–49 years"),
]

SMART_CODE_TO_KEY = {i["smart_code"]: i["key"] for i in INDICATORS if i["smart_code"]}
DHS_ID_TO_KEY = {i["dhs_id"]: i["key"] for i in INDICATORS if i["dhs_id"]}

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
            "report_url": clean(row.get(SMART_REPORT_LINK_COLUMN, "")),
            "notes": clean(row["Notes"]),
        }
    return surveys


def smart_value(row, warnings):
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
    key = SMART_CODE_TO_KEY.get(code)
    if key is None:
        warnings.append(f"{rid}: indicator code '{code}' is not in the indicator list "
                        "(scripts/build_results.py, INDICATORS); row left out.")
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


def build_smart(results_text, surveys_text, planning, warnings):
    result_rows = read_table(results_text, "Result ID", SMART_RESULT_COLUMNS, "SMART Consolidation sheet")
    survey_rows = read_table(surveys_text, "Assessment ID", SMART_SURVEY_COLUMNS, "SMART Surveys sheet")
    if len(result_rows) < MIN_SMART_VALUES:
        raise SourceError(f"SMART Consolidation sheet: only {len(result_rows)} rows (at least "
                          f"{MIN_SMART_VALUES} expected). Wrong tab or emptied sheet?")
    surveys = build_smart_surveys(survey_rows, warnings)
    values = [v for v in (smart_value(r, warnings) for r in result_rows) if v]
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


def build_dhs(values_text, surveys_text, warnings):
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

        key = DHS_ID_TO_KEY.get(row["indicator_id"])
        if key is None:
            key = row["indicator_id"]
            extra_indicators.setdefault(key, {
                "key": key, "group": row["topic"] or "Other", "label": row["indicator"],
                "unit": dhs_unit(row["measurement_type"], row["topic"]), "smart_code": None, "dhs_id": key,
                "classes": None, "definition": {}, "selector": False,
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
                "report_url": clean(p.get("report_link")),
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


def build(smart_results_text, smart_surveys_text, dhs_values_text, dhs_surveys_text, planning):
    warnings = []
    smart_surveys, smart_values = build_smart(smart_results_text, smart_surveys_text, planning, warnings)
    dhs_surveys, dhs_values, dhs_extra = build_dhs(dhs_values_text, dhs_surveys_text, warnings)

    countries = {}
    for s in smart_surveys + dhs_surveys:
        if s["iso3"]:
            countries.setdefault(s["iso3"], s["country"])

    results = {
        "indicators": INDICATORS + sorted(dhs_extra, key=lambda i: (i["group"], i["label"])),
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
    parser.add_argument("--out", default=str(DATA_DIR), help="Output folder (default: data/)")
    args = parser.parse_args(argv)

    try:
        results, counts, warnings = build(
            read_source(args.smart_results, "SMART_RESULTS_CSV_URL"),
            read_source(args.smart_surveys, "SMART_SURVEYS_CSV_URL"),
            read_file(DHS_VALUES_FILE),
            read_file(DHS_SURVEYS_FILE),
            load_planning(),
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
