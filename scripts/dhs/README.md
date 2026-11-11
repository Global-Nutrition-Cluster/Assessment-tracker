# DHS extraction — GNC Nutrition Assessment Tracker

Pulls survey planning and selected indicators from the
[DHS Program API](https://api.dhsprogram.com) for every DHS country. No API key needed.

**It runs only on GitHub Actions**, never on a personal computer:
workflow `.github/workflows/update-dhs.yml`, every Monday at 03:00 UTC, or on demand
(Actions tab > "Update DHS data" > Run workflow, with an optional minimum survey year).
The workflow commits the new files to `data/dhs/` only when they changed, and keeps the
old files if the API fails.

## Files

| Path | Content |
| --- | --- |
| `scripts/dhs/dhs_extract.py` | The script |
| `scripts/dhs/config/dhs_indicators_selected.csv` | Back-up copy of the indicator list |
| `scripts/dhs/requirements.txt` | Python packages installed by the workflow |
| `data/dhs/` | Files produced by the script (read by the Results page build) |

## Indicator list

The script reads **every row** of the indicator list. Add an indicator = add its row;
remove one = delete its row. Only the `IndicatorId` column is required
(other columns: Label, Definition, MeasurementType, Level1, Level2, Level3).

Source, in this order:
1. The Google Sheet published as CSV whose link is in the repository variable
   `DHS_INDICATORS_CSV_URL` (Settings > Secrets and variables > Actions > Variables).
2. Otherwise `config/dhs_indicators_selected.csv`.

## Rules

- Standard DHS surveys only (no MIS, AIS, special surveys).
- Planning: per country, the latest DHS plus every DHS not yet published.
- Indicators: **one survey per country** = the most recent **published** DHS, only if
  it is from 2020 or later (minimum year can be changed on the Run workflow button).
  All values of a country come from that survey; an indicator missing from it stays
  empty (no fallback to an older survey). Only `IsPreferred = 1` values.
- No calculation: values are returned exactly as given by the API.
- DHS GAM is weight-for-height only (no oedema, no MUAC): not directly comparable
  with SMART GAM.

## Outputs (`data/dhs/`)

| File | Content |
| --- | --- |
| `dhs_surveys.csv` | Planning: one row per retained survey (status, fieldwork dates, release date, report link) |
| `dhs_latest_indicators_national.csv` | Long format: one row per country × indicator, with value, CI, denominator, source survey and provenance |
| `dhs_latest_indicators_wide.csv` | One row per country (survey_id, survey_year), one column per indicator |
