# GNC Nutrition Assessment Tracker

A public dashboard of the Global Nutrition Cluster with two pages:
- **Planning view** (`index.html`): which SMART and Rapid SMART surveys are planned, ongoing or completed this year in each country, and whether they are funded (map, survey list by country).
- **Results** (`results.html`): the latest SMART and DHS results by country (map, "Latest results by country" list, country profiles).

The site is static and published with GitHub Pages. The data comes from Google Sheets maintained by the GNC, from SMART report files in `data/results/reports/` and from the DHS Program API.

## How the data gets to the website

1. The GNC team updates the tracker Google Sheet.
2. Every night, the **Update data from Google Sheet** workflow downloads the sheet (published as CSV), checks it, and writes `data/surveys.json` and `data/meta.json`.
3. The same workflow reads the SMART report files of `data/results/reports/` and the DHS files, and writes the Results page files in `data/results/`: `overview.json` (map, list, KPI tiles), `countries/<ISO3>.json` (one per country, loaded when its profile opens) and `meta.json`. It also runs **as soon as a report file is pushed** to `data/results/reports/` (see below).
4. Every Monday, the **Update DHS data** workflow calls the DHS Program API (`scripts/dhs/dhs_extract.py`) and refreshes `data/dhs/`. It runs only on GitHub.
5. The pages read those files.

If the sheet is broken (missing columns, emptied by mistake…), the workflow fails and the website keeps the last good data. Problems in individual rows (unknown status, duplicate ID, unreadable date) are listed in `data/meta.json` under `warnings`.

To refresh the data immediately: **Actions** tab → **Update data from Google Sheet** (or **Update DHS data**) → **Run workflow**.

Warnings about the results (rows without a value, values outside their CI, Assessment IDs missing from the tracker, a report pushed without its `.survey.csv`) are listed in `data/results/meta.json`.

## Publishing SMART results

Each SMART report is published as two files written by the extraction (next to the extraction workbook):

- `<Assessment ID>.csv`: every result row of the report;
- `<Assessment ID>.survey.csv`: the survey's row (title, lead, data collection, coverage, recall period, report link).

To publish a report, or to republish it after corrections in the workbook: on GitHub, open `data/results/reports/` → **Add file → Upload files**, drop the two files (they replace the old ones with the same name) and **Commit**. The **Update data from Google Sheet** workflow starts by itself, rebuilds `data/results/` and the site shows the report a minute later. Every row is published. Add the Assessment ID to the planning tracker too (otherwise the workflow lists a warning).

## One-time setup

- **Settings → Secrets and variables → Actions → Variables:**
  - `SHEET_CSV_URL` = the "Publish to web" CSV link of the tracker tab;
  - `PLANNING_SETTINGS_CSV_URL` = the CSV link of the "Settings" tab of the tracker (two columns `Setting | Value`; the row `Data as of | yyyy-mm-dd` gives the date shown on the Planning view);
  - `RESULTS_INDICATORS_CSV_URL` = the CSV link of the "Dashboard indicators" tab (labels, definitions and phases of the indicators in the Results selector; `none` in Phase thresholds = no phases);
  - `HNRP_COUNTRIES_CSV_URL` = the CSV link of the HNRP countries sheet (columns `Year | Country | ISO3`, one row per country and year; the Results page uses the rows of the current year for its "HNRP" switch);
  - `DHS_INDICATORS_CSV_URL` (optional) = the CSV link of the DHS indicator list.
- **Settings → Actions → General → Workflow permissions:** select "Read and write permissions" so the workflow can commit the data.
- **Settings → Pages:** deploy from the `main` branch, root folder.

## Tips for the Google Sheet

- Keep the column names unchanged (see `CLAUDE.md`, section 4.2).
- Format the date columns as `yyyy-mm-dd` to avoid day/month confusion.
- Write released results as `Results released (yyyy-mm-dd)` in the Validation column.
- **Report links: paste the plain web address** (`https://…`) in the cell. A Google Sheets link chip (the title of a page shown as a chip) is published as its title only, without the address, so the site cannot use it: such values are left out with a warning.
- Update the `Data as of` row of the Settings tab when the tracker has been reviewed: it is the date shown on the Planning view.
- Only publish the tab meant to be public. The published CSV can be read by anyone with the link.

## Working on the code

- `CLAUDE.md` is the technical brief: business rules, page specification, brand tokens.
- Preview the site locally: `python -m http.server 8000` in the repository folder, then open http://localhost:8000 (opening `index.html` directly does not work because the page loads JSON files).
- Run the tests: `python -m unittest discover -s scripts/tests -v`, and the JavaScript checks: `python scripts/check_js.py` (needs Node.js). The **Tests** workflow runs both on every pull request.
- Build the data from a local CSV: `python scripts/build_data.py --input my_export.csv`
- Build the results from local CSVs: `python scripts/build_results.py --smart-results consolidation.csv --smart-surveys surveys.csv --indicators dashboard_indicators.csv --hnrp hnrp_countries.csv`

## Licence

MIT, see `LICENSE`.
