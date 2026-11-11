# -*- coding: utf-8 -*-
"""
Extraction DHS Program API (https://api.dhsprogram.com) pour le
GNC Nutrition Assessment Tracker.

Tourne UNIQUEMENT sur GitHub Actions (.github/workflows/update-dhs.yml),
jamais sur un ordinateur personnel.

Arborescence (depot Assessment-tracker) :
    scripts/dhs/dhs_extract.py                      ce script
    scripts/dhs/config/dhs_indicators_selected.csv  liste des indicateurs (copie de secours)
    data/dhs/                                       fichiers produits par le script

1. Teste la connexion a l'API
2. Recupere la liste complete des indicateurs (avec pagination) -> CSV
3. Recherche un indicateur par mot-cle (ex. "under-five mortality")
4. Recupere les donnees de l'indicateur pour un pays donne -> CSV
5. [Projet] Planification (niveau Assessment) -> data/dhs/dhs_surveys.csv
   Regles GNC (2026-10-15) :
     - enquetes de type DHS standard uniquement (pas MIS, AIS, SPA, speciales...)
     - tous les pays DHS
     - pour chaque pays : la derniere enquete DHS (quel que soit son statut)
       + toutes les enquetes DHS en cours / prevues (pas encore publiees)
6. [Projet] Indicateurs retenus par le GNC = TOUTES les lignes de la liste
   des indicateurs (Google Sheet publie en CSV, voir INDICATORS_CSV_URL ;
   a defaut, copie locale config/dhs_indicators_selected.csv).
   Ajouter un indicateur = ajouter sa ligne ; l'enlever = supprimer sa ligne.
   Seule la colonne IndicatorId est obligatoire.
   Une seule enquete par pays : la DHS publiee la plus recente, si elle date
   de MIN_SURVEY_YEAR (2020) ou plus tard. Tous les indicateurs d'un pays
   viennent donc de la meme enquete ; un indicateur absent de cette enquete
   reste vide (pas de repli sur une enquete plus ancienne). Les pays sans DHS
   assez recente sont listes dans la console.
   Aucun calcul : les valeurs sont celles de l'API, telles quelles.
   -> data/dhs/dhs_latest_indicators_<breakdown>.csv  (format long, avec provenance)
   -> data/dhs/dhs_latest_indicators_wide.csv         (national : 1 ligne par pays)

Lancement : onglet Actions du depot > "Update DHS data" > Run workflow
(automatique chaque lundi a 03:00 UTC). Options du bouton : annee minimale.
Les etapes 1, 5 et 6 sont lancees a chaque fois. Les etapes 2 a 4 (tests du
debut) ne sont lancees qu'avec --tests (dhs_indicators.csv n'est regenere qu'avec --force).
Le script travaille toujours dans son propre dossier, d'ou qu'il soit lance.
"""
import argparse
import os
import sys
from datetime import date
from urllib.parse import urlencode
import requests

try:
    import pandas as pd
except ImportError:
    pd = None

BASE_URL = "https://api.dhsprogram.com/rest/dhs"
API_KEY = None          # optionnel : cle API DHS (augmente les limites de requetes)
PER_PAGE = 1000         # max autorise par l'API
TIMEOUT = 60
FORCE = False           # --force : regenere les fichiers meme s'ils existent

U5MR_ID = "CM_ECMR_C_U5M"   # Under-five mortality rate (deces pour 1 000 naissances vivantes)

# Liste des indicateurs GNC
# 1) Google Sheet publie en CSV : le lien est dans la variable du depot GitHub
#    DHS_INDICATORS_CSV_URL (jamais en dur ici), transmise par update-dhs.yml.
INDICATORS_CSV_URL = os.environ.get("DHS_INDICATORS_CSV_URL", "")
# 2) Copie locale utilisee si le lien est vide ou injoignable
INDICATORS_LOCAL = os.path.join("config", "dhs_indicators_selected.csv")
# Dossier des fichiers produits. Dans le depot Assessment-tracker : data/dhs/
# (chemin relatif a ce script ; modifiable via la variable DHS_OUTPUT_DIR).
OUTPUT_DIR = os.environ.get("DHS_OUTPUT_DIR", os.path.join("..", "..", "data", "dhs"))
BATCH_SURVEYS = 20                   # enquetes par appel /data
BATCH_INDICATORS = 12                # indicateurs par appel /data
MIN_SURVEY_YEAR = 2020               # indicateurs : DHS de cette annee ou plus recente
                                     # (modifiable aussi avec --min-year)
# (l'API refuse les requetes trop grosses : 400 Bad Request. Un lot refuse
#  est automatiquement coupe en deux et relance.)

# Regions UNICEF (champ UNICEF_RegionName de /countries) -> code utilise dans la base
UNICEF_REGION_CODES = {
    "west and central africa": "WACRO", "eastern and southern africa": "ESARO",
    "middle east and north africa": "MENARO", "south asia": "ROSA",
    "east asia and the pacific": "EAPRO", "east asia and pacific": "EAPRO",
    "latin america and the caribbean": "LACRO", "europe and central asia": "ECARO",
    "cee/cis": "ECARO",
}
# Noms DHS -> noms utilises dans la base GNC
COUNTRY_NAMES = {
    "Congo Democratic Republic": "Democratic Republic of the Congo",
    "Kyrgyz Republic": "Kyrgyzstan",
    "Vietnam": "Viet Nam",
    "Turkey": "Turkiye",
    "Cote d'Ivoire": "Côte d'Ivoire",
}


def call_api(endpoint, **params):
    """Appelle un endpoint et renvoie toutes les pages de 'Data' fusionnees."""
    params = {k: v for k, v in params.items() if v is not None}
    params.update({"f": "json", "perpage": PER_PAGE})
    if API_KEY:
        params["apiKey"] = API_KEY

    rows, page = [], 1
    while True:
        params["page"] = page
        r = requests.get(f"{BASE_URL}/{endpoint}", params=params, timeout=TIMEOUT)
        if r.status_code >= 400:          # garde le message de l'API pour le diagnostic
            msg = " ".join((r.text or "").split())[:300]
            raise requests.HTTPError(f"{r.status_code} {r.reason} : {msg}", response=r)
        js = r.json()
        rows.extend(js.get("Data", []))
        total_pages = js.get("TotalPages", 1) or 1
        if page >= total_pages:
            break
        page += 1
    return rows


def to_int(x):
    """L'API renvoie parfois les annees en texte ("2023") : conversion sure."""
    try:
        return int(x)
    except (TypeError, ValueError):
        return 0


def to_float(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def out_path(filename):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    return os.path.join(OUTPUT_DIR, filename)


def already_done(filename):
    """True si le fichier existe deja (et que --force n'est pas demande)."""
    if not FORCE and os.path.exists(filename):
        print(f"   {filename} existe deja -> etape ignoree (--force pour regenerer)\n")
        return True
    return False


def load_csv(filename):
    if pd is None:
        return []
    return pd.read_csv(filename, encoding="utf-8-sig").fillna("").to_dict("records")


def save(rows, filename):
    if pd is None:
        print(f"  (pandas absent : {filename} non ecrit)")
        return
    filename = out_path(filename)
    pd.DataFrame(rows).to_csv(filename, index=False, encoding="utf-8-sig")
    print(f"  -> {filename} ({len(rows)} lignes)")


# ---------------------------------------------------------------- 1. Test
def test_connection():
    print("1) Test de connexion...")
    try:
        r = requests.get(f"{BASE_URL}/info", params={"f": "json"}, timeout=TIMEOUT)
        r.raise_for_status()
    except requests.ConnectionError:
        print("   ECHEC : impossible de joindre api.dhsprogram.com.\n"
              "   Verifiez la connexion internet / le VPN / le proxy (HTTPS_PROXY),\n"
              "   puis testez : nslookup api.dhsprogram.com")
        sys.exit(1)
    except requests.Timeout:
        print(f"   ECHEC : pas de reponse de l'API apres {TIMEOUT} s. Reessayez plus tard.")
        sys.exit(1)
    for item in r.json().get("Data", []):
        print(f"   {item.get('Field')}: {item.get('Value')}")
    print("   OK\n")


# ---------------------------------------------------------- 2. Indicateurs
def get_all_indicators():
    print("2) Recuperation de tous les indicateurs...")
    rows = call_api(
        "indicators",
        returnFields="IndicatorId,Label,Definition,MeasurementType,Level1,Level2,Level3",
    )
    print(f"   {len(rows)} indicateurs trouves")
    save(rows, "dhs_indicators.csv")
    print()
    return rows


# ------------------------------------------------------------ 3. Recherche
def search_indicators(indicators, keyword):
    kw = keyword.lower()
    hits = [i for i in indicators
            if kw in (i.get("Label") or "").lower()
            or kw in (i.get("Definition") or "").lower()]
    print(f"3) Indicateurs contenant '{keyword}' : {len(hits)}")
    for i in hits:
        print(f"   {i['IndicatorId']:<20} {i['Label']}")
    print()
    return hits


# ---------------------------------------------------------------- 4. Data
def list_countries():
    """Code DHS -> nom DHS"""
    return {c["DHS_CountryCode"]: c["CountryName"] for c in get_country_table()}


_COUNTRY_TABLE = None
def get_country_table():
    """Fiches pays DHS (ISO3, region UNICEF...), lues une seule fois."""
    global _COUNTRY_TABLE
    if _COUNTRY_TABLE is None:
        _COUNTRY_TABLE = call_api("countries")
    return _COUNTRY_TABLE


def get_indicator_data(country_code, indicator_id=U5MR_ID, breakdown="national"):
    """breakdown : national | subnational | background | all"""
    print(f"4) Donnees {indicator_id} pour {country_code} (breakdown={breakdown})...")
    rows = call_api(
        "data",
        countryIds=country_code,
        indicatorIds=indicator_id,
        breakdown=breakdown,
        returnFields="CountryName,SurveyId,SurveyYear,SurveyType,Indicator,"
                     "CharacteristicCategory,CharacteristicLabel,Value,CILow,CIHigh,"
                     "IsPreferred,DenominatorUnweighted",
    )
    if not rows:
        print("   Aucune donnee.")
        return rows

    rows.sort(key=lambda d: to_int(d.get("SurveyYear")))
    print(f"   {'Annee':<6} {'Enquete':<12} {'Type':<6} {'Valeur':>7}  Categorie")
    for d in rows:
        print(f"   {d.get('SurveyYear',''):<6} {d.get('SurveyId',''):<12} "
              f"{d.get('SurveyType',''):<6} {d.get('Value',''):>7}  "
              f"{d.get('CharacteristicLabel','')}")
    save(rows, f"dhs_{indicator_id}_{country_code}_{breakdown}.csv")
    return rows


# ------------------------------------------------- 5. [Projet] Enquetes
def get_all_dhs_surveys(country_codes=None):
    """Toutes les enquetes de type DHS standard (toutes annees, tous statuts)."""
    try:   # inclut les enquetes en cours / en traitement
        rows = call_api("surveys", countryIds=country_codes, surveyStatus="all")
    except requests.HTTPError:
        print("   (surveyStatus=all refuse -> enquetes publiees seulement)")
        rows = call_api("surveys", countryIds=country_codes)
    ctry = {c["DHS_CountryCode"]: c for c in get_country_table()}
    today = date.today().isoformat()
    out = []
    for d in rows:
        if (d.get("SurveyType") or "").upper() != "DHS":
            continue
        c = ctry.get(d.get("DHS_CountryCode"), {})
        region_name = next((str(c[k]).strip() for k in ("UNICEF_RegionName", "UNICEF_Region")
                            if c.get(k)), "")
        out.append({
            "assessment_id": d.get("SurveyId"),
            "country": COUNTRY_NAMES.get(d.get("CountryName"), d.get("CountryName")),
            "dhs_country_code": d.get("DHS_CountryCode"),
            "iso3": c.get("ISO3_CountryCode", ""),
            "region": UNICEF_REGION_CODES.get(region_name.lower(), region_name),
            "assessment_type": d.get("SurveyType"),
            "survey_year": to_int(d.get("SurveyYear")),
            "status": d.get("SurveyStatus") or "Completed",
            "start_date": d.get("FieldworkStart") or "",
            "end_date": d.get("FieldworkEnd") or "",
            "release_date": d.get("ReleaseDate") or "",
            "lead_organization": " ".join(str(d.get("ImplementingOrg") or "").split()),
            "report_link": f"https://dhsprogram.com/methodology/survey/survey-display-{d.get('SurveyNum')}.cfm"
                           if d.get("SurveyNum") else "",
            "entry_mode": "automatic",
            "source_system": "DHS Program API",
            "retrieval_date": today,
        })
    return out


def is_published(s):
    return bool(s["release_date"]) or s["status"] == "Completed"


def _order(s):
    return (s["survey_year"] or 9999, s["start_date"] or "", s["assessment_id"] or "")


def select_planning(surveys):
    """Par pays : la derniere DHS + toutes les DHS non publiees (en cours / prevues)."""
    by_country = {}
    for s in surveys:
        by_country.setdefault(s["dhs_country_code"], []).append(s)
    out = []
    for code, lst in by_country.items():
        lst.sort(key=_order)
        keep = {lst[-1]["assessment_id"]: lst[-1]}
        for s in lst:
            if not is_published(s):
                keep[s["assessment_id"]] = s
        out.extend(keep.values())
    out.sort(key=lambda r: (r["country"] or "", _order(r)))
    return out


def select_latest_published(surveys):
    """Par pays : la DHS publiee la plus recente (pour les resultats)."""
    best = {}
    for s in surveys:
        if is_published(s):
            c = s["dhs_country_code"]
            if c not in best or _order(s) > _order(best[c]):
                best[c] = s
    return sorted(best.values(), key=lambda r: r["country"] or "")


def get_surveys(country_codes=None):
    print(f"5) Planification DHS pour {country_codes or 'tous les pays'}...")
    surveys = get_all_dhs_surveys(country_codes)
    plan = select_planning(surveys)
    print(f"   {len(surveys)} enquetes DHS au total -> {len(plan)} retenues pour la planification")
    for r in plan:
        print(f"   {r['assessment_id']:<12} {str(r['country'])[:24]:<24} {r['region']:<7} {str(r['status']):<10} "
              f"{r['start_date'] or ''} -> {r['end_date'] or ''}")
    save(plan, "dhs_surveys.csv")
    print()
    return surveys, plan


# ------------------------------------------------ 6. [Projet] Indicateurs
def _read_indicator_rows(text):
    """Lit le CSV de la liste (en-tete = ligne dont une cellule vaut IndicatorId)."""
    import csv
    import io
    lines = list(csv.reader(io.StringIO(text)))
    head = next((i for i, l in enumerate(lines)
                 if "IndicatorId" in [c.strip() for c in l]), None)
    if head is None:
        raise ValueError("colonne 'IndicatorId' introuvable")
    cols = [c.strip() for c in lines[head]]
    return [dict(zip(cols, l)) for l in lines[head + 1:]]


def load_selected_indicators():
    """Indicateurs GNC : toutes les lignes de la liste (Google Sheet, sinon copie locale)."""
    rows, source = None, ""
    if INDICATORS_CSV_URL:
        try:
            r = requests.get(INDICATORS_CSV_URL, timeout=TIMEOUT)
            r.raise_for_status()
            rows = _read_indicator_rows(r.content.decode("utf-8-sig"))
            source = "Google Sheet"
        except (requests.RequestException, ValueError) as e:
            print(f"   ATTENTION : liste Google Sheet illisible ({e}) -> copie locale")
    if rows is None:
        if not os.path.exists(INDICATORS_LOCAL):
            print(f"   ECHEC : pas de lien Google Sheet et {INDICATORS_LOCAL} introuvable.")
            sys.exit(1)
        with open(INDICATORS_LOCAL, encoding="utf-8-sig") as fh:
            rows = _read_indicator_rows(fh.read())
        source = INDICATORS_LOCAL

    selected, seen = [], set()
    for r in rows:
        ind = (r.get("IndicatorId") or "").strip()
        if not ind or ind in seen:          # lignes vides et doublons ignores
            continue
        seen.add(ind)
        selected.append({
            "IndicatorId": ind,
            "Label": (r.get("Label") or "").strip(),
            "MeasurementType": (r.get("MeasurementType") or "").strip(),
            "Level1": (r.get("Level1") or "").strip(),
            "Level2": (r.get("Level2") or "").strip(),
        })
    if not selected:
        print(f"   ECHEC : aucun indicateur dans la liste ({source}).")
        sys.exit(1)
    print(f"   {len(selected)} indicateurs lus depuis {source}")
    return selected


def get_latest_indicator_values(surveys, indicators, breakdown="national"):
    """Une enquete par pays (derniere DHS publiee >= MIN_SURVEY_YEAR) : toutes ses valeurs
    pour les indicateurs de la liste, telles que renvoyees par l'API."""
    print(f"6) Indicateurs GNC : derniere DHS publiee par pays, depuis {MIN_SURVEY_YEAR} "
          f"(breakdown={breakdown})...")
    meta = {i["IndicatorId"]: i for i in indicators}
    latest = {}                            # derniere DHS publiee de chaque pays
    for s in surveys:
        if is_published(s):
            c = s["dhs_country_code"]
            if c not in latest or _order(s) > _order(latest[c]):
                latest[c] = s
    published = {s["assessment_id"]: s for s in latest.values()
                 if s["survey_year"] >= MIN_SURVEY_YEAR}
    too_old = sorted((s for s in latest.values() if s["survey_year"] < MIN_SURVEY_YEAR),
                     key=lambda s: s["survey_year"])
    survey_ids = sorted(published)
    print(f"   {len(published)} pays avec une DHS publiee depuis {MIN_SURVEY_YEAR}, "
          f"{len(meta)} indicateurs")
    if too_old:
        print(f"   {len(too_old)} pays ignores (derniere DHS avant {MIN_SURVEY_YEAR}) : "
              + ", ".join(f"{s['country']} {s['survey_year']}" for s in too_old))

    rows, url_of, failed = [], {}, []

    def fetch(sids, inds):
        """Un appel /data ; si l'API refuse (400), coupe le lot en deux et relance."""
        params = dict(surveyIds=",".join(sids), indicatorIds=",".join(inds), breakdown=breakdown)
        try:
            got = call_api("data", **params)
        except requests.HTTPError as e:
            code = e.response.status_code if e.response is not None else None
            if code != 400:
                raise
            if len(sids) > 1:
                h = len(sids) // 2
                fetch(sids[:h], inds); fetch(sids[h:], inds)
            elif len(inds) > 1:
                h = len(inds) // 2
                fetch(sids, inds[:h]); fetch(sids, inds[h:])
            else:
                failed.append((sids[0], inds[0], str(e)))
            return
        rows.extend(got)
        url = f"{BASE_URL}/data?" + urlencode({**params, "f": "json"})
        for sid in sids:
            for ind in inds:
                url_of[(sid, ind)] = url

    ind_list = list(meta)
    ind_batches = [ind_list[j:j + BATCH_INDICATORS] for j in range(0, len(ind_list), BATCH_INDICATORS)]
    sv_batches = [survey_ids[i:i + BATCH_SURVEYS] for i in range(0, len(survey_ids), BATCH_SURVEYS)]
    total, n = len(ind_batches) * len(sv_batches), 0
    for sv in sv_batches:
        for ib in ind_batches:
            fetch(sv, ib)
            n += 1
            if n % 10 == 0 or n == total:
                print(f"   lot {n}/{total} : {len(rows)} lignes recues")
    if failed:
        print(f"   ATTENTION : {len(failed)} couples enquete x indicateur refuses par l'API, ex. :")
        for sid, ind, err in failed[:5]:
            print(f"     {sid} {ind} -> {err}")

    received = {}                          # lignes recues par indicateur (diagnostic)
    for d in rows:
        received.setdefault(d.get("IndicatorId"), []).append(d)

    # valeur "preferee" seulement (ex. mortalite 5 ans vs 10 ans) et valeur numerique
    rows = [d for d in rows
            if d.get("IsPreferred", 1) != 0 and to_float(d.get("Value")) is not None
            and d.get("SurveyId") in published and d.get("IndicatorId") in meta]

    # une ligne par enquete x indicateur x zone (doublons eventuels de l'API ignores)
    best = {}
    for d in rows:
        k = (d["SurveyId"], d["IndicatorId"],
             d.get("CharacteristicCategory"), d.get("CharacteristicLabel"))
        best.setdefault(k, d)

    today = date.today().isoformat()
    out = []
    for (sid, ind_id, cat, label), d in best.items():
        s, m = published[sid], meta[ind_id]
        code = s["dhs_country_code"]
        out.append({
            "country": s["country"],
            "iso3": s["iso3"],
            "region": s["region"],
            "dhs_country_code": code,
            # en mode national, toutes les lignes sont des totaux nationaux, meme si
            # la DHS les range sous une autre categorie ("Five year periods" 0-4 pour
            # la mortalite, "Total 15-49" pour les hommes...) : la categorie reste
            # visible dans area_category / area
            "area_level": "national" if (breakdown == "national" or cat == "Total") else "subnational",
            "area_category": cat,
            "area": label,
            "dhs_region_id": d.get("RegionId", ""),
            "indicator_id": ind_id,
            "indicator": m["Label"],
            "topic": m["Level1"],
            "subtopic": m["Level2"],
            "measurement_type": m["MeasurementType"],
            "value": to_float(d.get("Value")),
            "ci_lower": to_float(d.get("CILow")),
            "ci_upper": to_float(d.get("CIHigh")),
            "denominator_unweighted": d.get("DenominatorUnweighted", ""),
            "survey_id": s["assessment_id"],
            "survey_year": s["survey_year"],
            "release_date": s["release_date"],
            "entry_mode": "automatic",
            "source_system": "DHS Program API",
            "source_url": url_of.get((s["assessment_id"], ind_id), ""),
            "retrieval_date": today,
        })

    out.sort(key=lambda r: (r["country"] or "", r["area"] or "", r["topic"], r["indicator_id"]))

    # bilan
    countries = {r["dhs_country_code"] for r in out}
    found = {r["indicator_id"] for r in out}
    print(f"   {len(out)} valeurs pour {len(countries)} pays")
    absent = [i for i in meta if i not in found]
    if absent:
        none = [i for i in absent if i not in received]
        filt = [i for i in absent if i in received]
        if none:
            print(f"   Aucune ligne renvoyee par l'API pour : {', '.join(none)}")
        for i in filt:                     # recu mais ecarte : on dit pourquoi
            rs = received[i]
            cats = sorted({f"{d.get('CharacteristicCategory')}/{d.get('CharacteristicLabel')}" for d in rs})
            print(f"   {i} : {len(rs)} lignes recues mais ecartees "
                  f"(IsPreferred={sorted({d.get('IsPreferred') for d in rs})}, "
                  f"valeurs vides={sum(to_float(d.get('Value')) is None for d in rs)}, "
                  f"categories={cats[:4]})")

    save(out, f"dhs_latest_indicators_{breakdown}.csv")
    if breakdown == "national" and pd is not None and out:
        df = pd.DataFrame(out)
        df = df[df["area_level"] == "national"]          # total national uniquement
        dup = df.duplicated(["dhs_country_code", "indicator_id"], keep=False)
        if dup.any():
            print(f"   ATTENTION : {dup.sum()} lignes avec plusieurs valeurs nationales pour un meme "
                  f"pays x indicateur (ex. {', '.join(sorted(df[dup].indicator_id.unique())[:5])}) : "
                  "le tableau large garde la premiere, voir le fichier long")
        df = df.fillna({"region": ""})
        wide = df.pivot_table(index=["region", "country", "iso3"], columns="indicator_id",
                              values="value", aggfunc="first")
        order = [i for i in meta if i in wide.columns]
        wide = wide[order]
        last = (pd.DataFrame(published.values()).fillna({"region": ""})
                .set_index(["region", "country", "iso3"])[["assessment_id", "survey_year"]]
                .rename(columns={"assessment_id": "survey_id", "survey_year": "survey_year"}))
        wide = last.join(wide, how="right").reset_index().sort_values(["region", "country"])
        wide.to_csv(out_path("dhs_latest_indicators_wide.csv"), index=False, encoding="utf-8-sig")
        print(f"  -> {out_path('dhs_latest_indicators_wide.csv')} ({len(wide)} pays x {len(order)} indicateurs)")
    print()
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Extraction DHS Program API pour l'Assessment Tracker")
    ap.add_argument("countries", nargs="?", default="ALL",
                    help="ALL (defaut) ou codes DHS separes par des virgules, ex. SN,ML,NI")
    ap.add_argument("breakdown", nargs="?", default="national",
                    choices=["national", "subnational"], help="niveau des resultats")
    ap.add_argument("--force", action="store_true",
                    help="regenerer aussi dhs_indicators.csv")
    ap.add_argument("--min-year", type=int, default=MIN_SURVEY_YEAR,
                    help=f"annee minimale des DHS pour les indicateurs (defaut {MIN_SURVEY_YEAR})")
    ap.add_argument("--tests", action="store_true",
                    help="relancer aussi les etapes 3-4 (recherche + exemple mortalite)")
    args = ap.parse_args()
    FORCE = args.force
    MIN_SURVEY_YEAR = args.min_year
    os.chdir(os.path.dirname(os.path.abspath(__file__)))   # chemins relatifs au script
    country_arg = args.countries.upper()
    all_countries = country_arg == "ALL"
    country_list = [] if all_countries else [c.strip() for c in country_arg.split(",") if c.strip()]

    test_connection()
    if args.tests or args.force:
        if already_done(out_path("dhs_indicators.csv")):
            indicators = load_csv(out_path("dhs_indicators.csv"))   # relu pour la recherche
        else:
            indicators = get_all_indicators()
        if args.tests:
            search_indicators(indicators, "under-five mortality")

    countries = list_countries()
    unknown = [c for c in country_list if c not in countries]
    if unknown:
        print(f"Code(s) pays inconnu(s) : {unknown}. Exemples : "
              + ", ".join(f"{k}={v}" for k, v in list(countries.items())[:15]))
        sys.exit(1)
    print(f"   Pays : {'tous (%d pays DHS)' % len(countries) if all_countries else ', '.join(countries[c] for c in country_list)}\n")

    if args.tests:
        get_indicator_data(country_list[0] if country_list else "SN", U5MR_ID, "national")
        print()

    # --- Donnees du projet Assessment Tracker
    codes = None if all_countries else ",".join(country_list)
    surveys, plan = get_surveys(codes)
    selected = load_selected_indicators()
    get_latest_indicator_values(surveys, selected, args.breakdown)
