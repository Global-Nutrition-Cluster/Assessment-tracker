# GNC Nutrition Assessment Tracker

A public dashboard of the Global Nutrition Cluster showing which nutrition assessments (SMART, Rapid SMART, MICS, DHS, IPC AMN) are planned, ongoing or completed in each country, and where data is missing or outdated.

The site is static and published with GitHub Pages. The data comes from a Google Sheet maintained by the GNC.

## How the data gets to the website

1. The GNC team updates the tracker Google Sheet.
2. Every night, the **Update data from Google Sheet** workflow downloads the sheet (published as CSV), checks it, and writes `data/surveys.json` and `data/meta.json`.
3. The page reads those two files.

If the sheet is broken (missing columns, emptied by mistake…), the workflow fails and the website keeps the last good data. Problems in individual rows (unknown status, duplicate ID, unreadable date) are listed in `data/meta.json` under `warnings`.

To refresh the data immediately: **Actions** tab → **Update data from Google Sheet** → **Run workflow**.

## One-time setup

- **Settings → Secrets and variables → Actions → Variables:** add `SHEET_CSV_URL` = the "Publish to web" CSV link of the tracker tab.
- **Settings → Actions → General → Workflow permissions:** select "Read and write permissions" so the workflow can commit the data.
- **Settings → Pages:** deploy from the `main` branch, root folder.

## Tips for the Google Sheet

- Keep the column names unchanged (see `CLAUDE.md`, section 4.2).
- Format the date columns as `yyyy-mm-dd` to avoid day/month confusion.
- Write released results as `Results released (yyyy-mm-dd)` in the Validation column: the date feeds the "freshness" map.
- Only publish the tab meant to be public. The published CSV can be read by anyone with the link.

## Working on the code

- `CLAUDE.md` is the technical brief: business rules, page specification, brand tokens.
- Run the tests: `python -m unittest discover -s scripts/tests -v`
- Build the data from a local CSV: `python scripts/build_data.py --input my_export.csv`

## Licence

MIT, see `LICENSE`.
