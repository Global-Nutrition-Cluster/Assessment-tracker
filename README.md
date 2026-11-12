# GNC Nutrition Assessment Tracker

A public dashboard of the Global Nutrition Cluster showing which nutrition assessments (SMART, Rapid SMART, MICS, DHS, IPC AMN) are planned, ongoing or completed in each country, and where data is missing or outdated.

Two pages:
- **Planning view** (`index.html`): which assessments are planned, ongoing or completed.
- **Results** (`results.html`): the latest SMART and DHS results by country (map, ranked list, country profiles).

The site is static and published with GitHub Pages. The data comes from Google Sheets maintained by the GNC and from the DHS Program API.

## How the data gets to the website

1. The GNC team updates the tracker Google Sheet.
2. Every night, the **Update data from Google Sheet** workflow downloads the sheet (published as CSV), checks it, and writes `data/surveys.json` and `data/meta.json`.
3. The same workflow reads the two SMART results tabs (Consolidation and Surveys) and the DHS files, and writes `data/results.json` and `data/results_meta.json` for the Results page.
4. Every Monday, the **Update DHS data** workflow calls the DHS Program API (`scripts/dhs/dhs_extract.py`) and refreshes `data/dhs/`. It runs only on GitHub.
5. The pages read those files.

If the sheet is broken (missing columns, emptied by mistake…), the workflow fails and the website keeps the last good data. Problems in individual rows (unknown status, duplicate ID, unreadable date) are listed in `data/meta.json` under `warnings`.

To refresh the data immediately: **Actions** tab → **Update data from Google Sheet** (or **Update DHS data**) → **Run workflow**.

Warnings about the results (rows without a value, values outside their CI, Assessment IDs missing from the tracker) are listed in `data/results_meta.json`.

## One-time setup

- **Settings → Secrets and variables → Actions → Variables:**
  - `SHEET_CSV_URL` = the "Publish to web" CSV link of the tracker tab;
  - `SMART_RESULTS_CSV_URL` and `SMART_SURVEYS_CSV_URL` = the CSV links of the Consolidation and Surveys tabs of the SMART results workbook;
  - `RESULTS_INDICATORS_CSV_URL` = the CSV link of the "Dashboard indicators" tab (labels, definitions and phases of the indicators in the Results selector; `none` in Phase thresholds = no phases);
  - `DHS_INDICATORS_CSV_URL` (optional) = the CSV link of the DHS indicator list.
- **Settings → Actions → General → Workflow permissions:** select "Read and write permissions" so the workflow can commit the data.
- **Settings → Pages:** deploy from the `main` branch, root folder.

## Tips for the Google Sheet

- Keep the column names unchanged (see `CLAUDE.md`, section 4.2).
- Format the date columns as `yyyy-mm-dd` to avoid day/month confusion.
- Write released results as `Results released (yyyy-mm-dd)` in the Validation column: the date feeds the "freshness" map.
- Only publish the tab meant to be public. The published CSV can be read by anyone with the link.

## Working on the code

- `CLAUDE.md` is the technical brief: business rules, page specification, brand tokens.
- Preview the site locally: `python -m http.server 8000` in the repository folder, then open http://localhost:8000 (opening `index.html` directly does not work because the page loads JSON files).
- Run the tests: `python -m unittest discover -s scripts/tests -v`
- Build the data from a local CSV: `python scripts/build_data.py --input my_export.csv`
- Build the results from local CSVs: `python scripts/build_results.py --smart-results consolidation.csv --smart-surveys surveys.csv --indicators dashboard_indicators.csv`

## Licence

MIT, see `LICENSE`.
