#!/usr/bin/env python3
"""Prepare geo/countries.geojson from Natural Earth (run once, by hand; not part of the nightly workflow).

Steps:
1. Download Natural Earth 1:50m admin-0 countries (public domain, v5.1.2):
   https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson
2. python scripts/prepare_geo.py ne_50m_admin_0_countries.geojson geo/countries_full.geojson
3. Simplify and merge with mapshaper (https://github.com/mbloch/mapshaper):
   npx mapshaper geo/countries_full.geojson -dissolve iso3 copy-fields=name,label_x,label_y \
       -simplify 12% keep-shapes -o precision=0.001 geo/countries.geojson
   then delete geo/countries_full.geojson.

What this script fixes:
- ISO3 codes missing in Natural Earth (France, Norway, Kosovo...) so every country joins with the data.
- Areas that the UN counts as part of a member state are given that state's code, so they are
  merged into it by mapshaper: Somaliland -> Somalia, Northern Cyprus -> Cyprus,
  Siachen Glacier -> no code (left out).
Only three properties are kept: iso3, name, and the label point (label_x, label_y) used for map markers.
"""

import json
import sys

# Natural Earth ADM0_A3 -> ISO3 used by the tracker, where ISO_A3 is missing or should be merged
ISO_FIXES = {
    "FRA": "FRA", "NOR": "NOR", "KOS": "XKX",
    "SOL": "SOM",   # Somaliland is part of Somalia (UN)
    "CYN": "CYP",   # Northern Cyprus is part of Cyprus (UN)
    "IOA": "AUS", "ATC": "AUS",
    "KAS": None,    # Siachen Glacier: disputed, left out
}


def main(src, dst):
    data = json.load(open(src, encoding="utf-8"))
    features = []
    for feature in data["features"]:
        p = feature["properties"]
        iso3 = p.get("ISO_A3")
        if iso3 in (None, "-99"):
            iso3 = ISO_FIXES.get(p.get("ADM0_A3"), p.get("ISO_A3_EH"))
        elif p.get("ADM0_A3") in ISO_FIXES:
            iso3 = ISO_FIXES[p["ADM0_A3"]]
        if not iso3 or iso3 == "-99":
            continue
        main_part = 0 if p.get("ADM0_A3") == iso3 else 1
        feature["properties"] = {
            "iso3": iso3,
            "name": p.get("NAME"),
            "label_x": p.get("LABEL_X"),
            "label_y": p.get("LABEL_Y"),
        }
        features.append((iso3, main_part, feature))
    # The state's own polygon first, so mapshaper keeps its name and label point when merging
    features = [f for _, _, f in sorted(features, key=lambda t: (t[0], t[1]))]
    json.dump({"type": "FeatureCollection", "features": features}, open(dst, "w", encoding="utf-8"))
    print(f"{len(features)} features written to {dst}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
