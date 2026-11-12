"""Tests for the Results data rules in scripts/build_results.py (CLAUDE.md section 11.3).

Run from the repository root:
    python -m unittest discover -s scripts/tests -v
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import build_results as br  # noqa: E402

RESULT_HEADER = ",".join(br.SMART_RESULT_COLUMNS)
SURVEY_HEADER = ",".join(br.SMART_SURVEY_COLUMNS + [br.SMART_REPORT_LINK_COLUMN])


def result_row(rid, sid="MLI-2022-SMART-01", code="GAM_WHZ", value="10.8", age="6-59 months",
               level="National", area="Mali", pop="General population", typ="SMART", check=""):
    cells = {c: "" for c in br.SMART_RESULT_COLUMNS}
    cells.update({
        "Result ID": rid, "Assessment ID": sid, "Country": "Mali", "Country ISO3": "MLI",
        "Assessment type": typ, "Data collection start": "2022-06-06", "Data collection end": "2022-07-12",
        "Area name": area, "Area level": level, "Population group": pop, "Age group": age,
        "Indicator code": code, "Indicator": "x", "Value": value, "CI lower": "10.1", "CI upper": "11.6",
        "Unit": "%", "Automatic check": check, "Review status": "To review",
    })
    return ",".join(f'"{cells[c]}"' for c in br.SMART_RESULT_COLUMNS)


def results_csv(rows, title=True):
    lines = ["SMART results,,,", ",,,"] if title else []
    return "\n".join(lines + [RESULT_HEADER] + rows) + "\n"


def surveys_csv(report=""):
    row = ["MLI-2022-SMART-01", "Mali", "MLI", "SMART", "Title", "DGSHP", "2022-06-06", "2022-07-12",
           "National", "90 days", "", report]
    return SURVEY_HEADER + "\n" + ",".join(f'"{c}"' for c in row) + "\n"


def filler(n):
    return [result_row(f"F{i:03d}", code="STUNT", area=f"Region {i}", level="Admin 1") for i in range(n)]


DHS_VALUES = (
    "country,iso3,indicator_id,indicator,topic,measurement_type,value,ci_lower,ci_upper,"
    "denominator_unweighted,survey_id,survey_year,release_date,retrieval_date\n"
    + "".join(f"Mali,MLI,CN_NUTS_C_WH2,Children wasted,Child Nutrition,Percent,5.4,,,{6000 + i},ML2023DHS,2023,"
              "2025-10-02,2026-11-10\n" for i in range(1))
    + "Mali,MLI,CM_ECMR_C_U5M,Under-five mortality rate,Infant and Child Mortality,Rate,95.0,88.0,102.0,,"
      "ML2023DHS,2023,2025-10-02,2026-11-10\n"
    + "Mali,MLI,CM_ECMT_C_U5L,Under-five mortality rate (5 year periods) - CI lower bound (-2SE),"
      "Infant and Child Mortality,Rate,88.0,,,,ML2023DHS,2023,2025-10-02,2026-11-10\n"
    + "".join(f"Mali,MLI,XX_{i},Other indicator {i},Child Nutrition,Number,{i},,,,ML2023DHS,2023,"
              "2025-10-02,2026-11-10\n" for i in range(br.MIN_DHS_VALUES))
)
DHS_SURVEYS = ("assessment_id,country,iso3,survey_year,start_date,end_date,release_date,lead_organization,"
               "report_link\nML2023DHS,Mali,MLI,2023,2023-11-01,2024-04-01,2025-10-02,INSTAT,https://dhs/ml\n")


INDICATOR_HEADER = ",".join(br.INDICATOR_COLUMNS)


def indicator_row(key, smart="", dhs="", thresholds="none", labels="", source="", group="Acute malnutrition"):
    cells = [key, group, f"Label {key}", "%", smart, dhs, "SMART def", "DHS def", thresholds, labels, source]
    return ",".join(f'"{c}"' for c in cells)


INDICATORS_CSV = "\n".join([
    "Dashboard indicators,,,",
    INDICATOR_HEADER,
    indicator_row("GAM_WHZ", "GAM_WHZ", "CN_NUTS_C_WH2", "2.5;5;10;15", "Very low;Low;Medium;High;Very high", "WHO 2018"),
    indicator_row("STUNT", "STUNT", "", "none", group="Stunting"),
    indicator_row("U5MR", "", "CM_ECMR_C_U5M", "none", group="Mortality"),
]) + "\n"


class IndicatorSheet(unittest.TestCase):
    """Rules 11.3.0 and 11.3.7: the Dashboard indicators sheet."""

    def load(self, *rows):
        warnings = []
        indicators = br.load_indicators(INDICATOR_HEADER + "\n" + "\n".join(rows) + "\n", warnings)
        return indicators, warnings

    def test_phases_are_read(self):
        (ind,), warnings = self.load(indicator_row("CDR", "CDR", "", "1;2", "Below alert;Alert;Emergency", "GNC"))
        self.assertEqual(ind["phases"], {"source": "GNC", "thresholds": [1, 2], "higher_is_better": False,
                                         "labels": ["Below alert", "Alert", "Emergency"], "colours": [0, 1, 2],
                                         "palette": "blue"})
        self.assertEqual(warnings, [])

    def test_decimal_comma_thresholds(self):
        (ind,), _ = self.load(indicator_row("X", "X", "", "2,5;5", "A;B;C", "WHO 2018"))
        self.assertEqual(ind["phases"]["thresholds"], [2.5, 5])

    def test_higher_value_is_better(self):
        row = indicator_row("MDD", "MDD", "", "10;20;40;70", "Extremely critical;Critical;Serious;Alert;Acceptable", "GNC")
        header = INDICATOR_HEADER + ",Higher value is"
        warnings = []
        (ind,) = br.load_indicators(header + "\n" + row + ',"better"\n', warnings)
        self.assertTrue(ind["phases"]["higher_is_better"])
        self.assertEqual(ind["phases"]["colours"], [4, 3, 2, 1, 0])   # lowest values = most severe
        (ind,) = br.load_indicators(header + "\n" + row + ',"upside"\n', warnings)
        self.assertIsNone(ind["phases"])
        self.assertEqual(len(warnings), 1)

    def test_phase_colours(self):
        header = INDICATOR_HEADER + ",Higher value is,Phase colours"
        row = indicator_row("CDR", "CDR", "", "0.5;1;2", "Acceptable/Alert;Serious;Critical;Extremely critical", "GNC")
        warnings = []
        (ind,) = br.load_indicators(header + "\n" + row + ',"","1;3;4;5"\n', warnings)
        self.assertEqual(ind["phases"]["colours"], [0, 2, 3, 4])
        (ind,) = br.load_indicators(header + "\n" + row + ',"","1;3;9"\n', warnings)
        self.assertIsNone(ind["phases"])
        self.assertEqual(len(warnings), 1)

    def test_phase_palette(self):
        header = INDICATOR_HEADER + ",Phase palette"
        row = indicator_row("GAM_WHZ", "GAM", "", "5;10;15;30", "Acceptable;Alert;Serious;Critical;Extremely critical", "IPC AMN v3")
        warnings = []
        (ind,) = br.load_indicators(header + "\n" + row + ',"IPC"\n', warnings)
        self.assertEqual(ind["phases"]["palette"], "ipc")
        (ind,) = br.load_indicators(header + "\n" + row + ',""\n', warnings)
        self.assertEqual(ind["phases"]["palette"], "blue")      # default
        (ind,) = br.load_indicators(header + "\n" + row + ',"pink"\n', warnings)
        self.assertIsNone(ind["phases"])
        self.assertEqual(len(warnings), 1)

    def test_keyword_none_means_no_phases(self):
        (ind,), warnings = self.load(indicator_row("X", "X", "", "None"))
        self.assertIsNone(ind["phases"])
        self.assertEqual(warnings, [])

    def test_empty_thresholds_warn(self):
        (ind,), warnings = self.load(indicator_row("X", "X", "", ""))
        self.assertIsNone(ind["phases"])
        self.assertTrue(any("none" in w for w in warnings))

    def test_bad_phases_warn_and_are_dropped(self):
        for thresholds, labels, source in [("5;2", "A;B;C", "WHO"), ("1;2", "A;B", "WHO"),
                                           ("1;2", "A;B;C", ""), ("a;b", "A;B;C", "WHO"),
                                           ("1;2;3;4;5", "A;B;C;D;E;F", "WHO")]:
            (ind,), warnings = self.load(indicator_row("X", "X", "", thresholds, labels, source))
            self.assertIsNone(ind["phases"], thresholds)
            self.assertEqual(len(warnings), 1, thresholds)

    def test_duplicate_key_or_code_is_left_out(self):
        inds, warnings = self.load(indicator_row("A", "GAM"), indicator_row("A", "OTHER"), indicator_row("B", "GAM"))
        self.assertEqual([i["key"] for i in inds], ["A"])
        self.assertEqual(len(warnings), 2)

    def test_row_without_code_is_left_out(self):
        inds, warnings = self.load(indicator_row("A", "GAM"), indicator_row("B"))
        self.assertEqual(len(inds), 1)
        self.assertEqual(len(warnings), 1)

    def test_missing_column_fails(self):
        with self.assertRaises(br.SourceError):
            br.load_indicators(INDICATOR_HEADER.replace("Phase source", "Source") + "\n" + indicator_row("A", "GAM"), [])


class NumberAndTextRules(unittest.TestCase):
    def test_parse_number(self):
        self.assertEqual(br.parse_number("10.8"), 10.8)
        self.assertEqual(br.parse_number("10,8"), 10.8)        # decimal comma
        self.assertEqual(br.parse_number("1,234.5"), 1234.5)   # thousands separator
        self.assertEqual(br.parse_number("2672"), 2672)
        self.assertIsNone(br.parse_number(""))
        with self.assertRaises(ValueError):
            br.parse_number("n/a")

    def test_age_and_level(self):
        self.assertEqual(br.normalise_age("0-59 months (as titled)"), "0-59 months")
        self.assertEqual(br.normalise_level("Stratum (part of Kabul province)"), "Stratum")
        self.assertEqual(br.normalise_level("Admin 1"), "Admin 1")

    def test_survey_year_uses_end_of_data_collection(self):  # rule 11.3.5
        self.assertEqual(br.smart_survey_year("2022-10", "2022-02"), 2022)
        self.assertEqual(br.smart_survey_year(None, "2021-09-24"), 2021)
        self.assertEqual(br.smart_survey_year("2026-01", "2025-11"), 2026)

    def test_dhs_precision_rows_are_dropped(self):  # rule 11.3.3
        self.assertTrue(br.is_dhs_precision_row("Under-five mortality rate (5 year periods) - standard error"))
        self.assertFalse(br.is_dhs_precision_row("Children wasted"))


class SmartRules(unittest.TestCase):
    def build(self, rows, planning=None, report=""):
        return br.build(results_csv(rows), surveys_csv(report), DHS_VALUES, DHS_SURVEYS, planning, INDICATORS_CSV)

    def test_header_detected_below_a_title_row(self):
        results, counts, _ = self.build(filler(br.MIN_SMART_VALUES))
        self.assertEqual(counts["smart_values"], br.MIN_SMART_VALUES)

    def test_too_few_rows_fails(self):
        with self.assertRaises(br.SourceError):
            self.build(filler(3))

    def test_missing_column_fails(self):
        with self.assertRaises(br.SourceError):
            br.build(results_csv(filler(200)).replace("Indicator code", "Code"), surveys_csv(),
                     DHS_VALUES, DHS_SURVEYS, None, INDICATORS_CSV)

    def test_6_59_months_is_the_main_figure(self):  # rule 11.3.4
        rows = filler(br.MIN_SMART_VALUES) + [result_row("A", age="6-59 months", value="10.8"),
                                              result_row("B", age="0-59 months", value="11.2")]
        results, _, _ = self.build(rows)
        gam = {v["result_id"]: v for v in results["values"] if v.get("indicator") == "GAM_WHZ" and v["source"] == "SMART"}
        self.assertNotIn("alt", gam["A"])
        self.assertTrue(gam["B"]["alt"])

    def test_single_age_group_is_not_alternative(self):
        rows = filler(br.MIN_SMART_VALUES) + [result_row("B", age="0-59 months", value="11.2")]
        results, _, _ = self.build(rows)
        gam = [v for v in results["values"] if v.get("indicator") == "GAM_WHZ" and v["source"] == "SMART"]
        self.assertNotIn("alt", gam[0])

    def test_rapid_smart_idps_are_a_separate_figure(self):
        rows = filler(br.MIN_SMART_VALUES) + [
            result_row("A", age="6-59 months"),
            result_row("B", age="0-59 months", pop="IDPs in displacement sites", typ="Rapid SMART")]
        results, _, _ = self.build(rows)
        idp = [v for v in results["values"] if v.get("result_id") == "B"][0]
        self.assertEqual(idp["type"], "Rapid SMART")
        self.assertNotIn("alt", idp)

    def test_row_without_value_is_left_out_with_a_warning(self):
        rows = filler(br.MIN_SMART_VALUES) + [result_row("EMPTY", value="")]
        results, _, warnings = self.build(rows)
        self.assertFalse(any(v.get("result_id") == "EMPTY" for v in results["values"]))
        self.assertTrue(any("EMPTY" in w for w in warnings))

    def test_automatic_check_is_kept_and_listed(self):  # rule 11.3.6
        rows = filler(br.MIN_SMART_VALUES) + [result_row("CHK", check="Value outside its CI")]
        results, _, warnings = self.build(rows)
        self.assertTrue(any(v.get("result_id") == "CHK" for v in results["values"]))
        self.assertTrue(any("CHK" in w and "automatic check" in w for w in warnings))

    def test_unknown_indicator_code_is_listed(self):
        rows = filler(br.MIN_SMART_VALUES) + [result_row("U", code="NEW_CODE")]
        _, _, warnings = self.build(rows)
        self.assertTrue(any("NEW_CODE" in w for w in warnings))

    def test_id_check_against_the_planning_tracker(self):  # section 11.2
        _, _, warnings = self.build(filler(br.MIN_SMART_VALUES), planning={})
        self.assertTrue(any("not found in the planning tracker" in w for w in warnings))
        _, _, warnings = self.build(filler(br.MIN_SMART_VALUES), planning={"MLI-2022-SMART-01": "NER"})
        self.assertTrue(any("NER in the planning tracker" in w for w in warnings))
        _, _, warnings = self.build(filler(br.MIN_SMART_VALUES), planning={"MLI-2022-SMART-01": "MLI"})
        self.assertFalse(any("planning tracker" in w for w in warnings))

    def test_report_link_and_review_status(self):
        results, _, _ = self.build(filler(br.MIN_SMART_VALUES), report="https://example.org/r.pdf")
        survey = [s for s in results["surveys"] if s["id"] == "MLI-2022-SMART-01"][0]
        self.assertEqual(survey["report_url"], "https://example.org/r.pdf")
        self.assertEqual(survey["survey_year"], 2022)
        self.assertEqual(results["values"][0]["review_status"], "To review")  # kept, not shown


class DhsRules(unittest.TestCase):
    def setUp(self):
        self.results, self.counts, _ = br.build(results_csv(filler(br.MIN_SMART_VALUES)), surveys_csv(),
                                                DHS_VALUES, DHS_SURVEYS, None, INDICATORS_CSV)
        self.dhs = [v for v in self.results["values"] if v["source"] == "DHS"]

    def test_shared_key_for_wasting(self):  # rule 11.3.2
        wasting = [v for v in self.dhs if v["indicator"] == "GAM_WHZ"][0]
        self.assertEqual(wasting["value"], 5.4)
        self.assertNotIn("ci_lower", wasting)  # no CI published
        self.assertEqual(wasting["sample"], 6000)

    def test_mortality_keeps_its_ci_and_drops_the_bound_rows(self):  # rule 11.3.3
        u5 = [v for v in self.dhs if v["indicator"] == "U5MR"][0]
        self.assertEqual((u5["ci_lower"], u5["ci_upper"]), (88.0, 102.0))
        self.assertFalse(any(v["indicator"] == "CM_ECMT_C_U5L" for v in self.dhs))

    def test_other_dhs_indicators_go_to_more_indicators(self):
        extra = [i for i in self.results["indicators"] if i["key"] == "XX_1"][0]
        self.assertFalse(extra["selector"])

    def test_dhs_survey_card(self):
        survey = [s for s in self.results["surveys"] if s["id"] == "ML2023DHS"][0]
        self.assertEqual(survey["release_date"], "2025-10-02")
        self.assertEqual(survey["report_url"], "https://dhs/ml")
        self.assertEqual(self.counts["countries"], 1)


class Outputs(unittest.TestCase):
    def test_written_only_when_changed(self):
        results, counts, warnings = br.build(results_csv(filler(br.MIN_SMART_VALUES)), surveys_csv(),
                                             DHS_VALUES, DHS_SURVEYS, None, INDICATORS_CSV)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.assertTrue(br.write_outputs(results, counts, warnings, out))
            self.assertFalse(br.write_outputs(results, counts, warnings, out))
            data = json.loads((out / "results.json").read_text(encoding="utf-8"))
            self.assertEqual(len(data["values"]), counts["smart_values"] + counts["dhs_values"])


if __name__ == "__main__":
    unittest.main()
