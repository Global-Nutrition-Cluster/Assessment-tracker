"""Tests for the normalisation rules in scripts/build_data.py (CLAUDE.md 4.3).

Run from the repository root:
    python -m unittest discover -s scripts/tests -v
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import build_data as bd  # noqa: E402

HEADER = ("Assessment ID,Region,Country,Country ISO3,Admin 1 name,Admin 1 Pcode,Assessment type,"
          "Status,Start date,End Date,Lead organization,Partners,Report Link,Validation,Budget")


def sample_csv(rows, title=True):
    lines = ["GNC  - Nutrition Assessment Tracker,,,,,,,,,,,,,,", ",,,,,,,,,,,,,,"] if title else []
    lines.append(HEADER)
    lines.extend(rows)
    return "\n".join(lines) + "\n"


def filler_rows(n):
    return [f"MLI-2026-SMART-{i:02d},WACRO,Mali,MLI,,,SMART,Planned,,,,,,Not yet started,Funded"
            for i in range(n)]


class TypeGroupTests(unittest.TestCase):
    def test_main_groups(self):
        self.assertEqual(bd.type_group("SMART"), "SMART")
        self.assertEqual(bd.type_group(" rapid  SMART "), "Rapid SMART")
        self.assertEqual(bd.type_group("MICS"), "MICS")
        self.assertEqual(bd.type_group("DHS"), "DHS")
        self.assertEqual(bd.type_group("IPC AMN"), "IPC AMN")

    def test_other(self):
        for value in ("MSNA", "IPC", "IPC AFI", "NVA (rounds 2 and 3)", "", None):
            self.assertEqual(bd.type_group(value), "Other")


class StatusTests(unittest.TestCase):
    def test_status(self):
        self.assertEqual(bd.normalise_status("completed"), "Completed")
        self.assertEqual(bd.normalise_status("Not planned"), "Not planned")
        self.assertIsNone(bd.normalise_status("Overdue"))

    def test_display_status(self):
        self.assertEqual(bd.display_status("Planned", "Not yet started"), "planned")
        self.assertEqual(bd.display_status("Ongoing", "Data collection ongoing"), "ongoing")
        self.assertEqual(bd.display_status("Completed", "Results released (2025-11-18)"), "released")
        self.assertEqual(bd.display_status("Completed", "Results released"), "released")
        self.assertEqual(bd.display_status("Completed", "Awaiting government approval"), "completed")
        self.assertEqual(bd.display_status("Completed", ""), "completed")
        self.assertEqual(bd.display_status("Not planned", ""), "not_planned")
        self.assertIsNone(bd.display_status(None, ""))


class ValidationTests(unittest.TestCase):
    def test_sub_stage(self):
        self.assertEqual(bd.sub_stage("Results released (2025-11-18)"), "Results released")
        self.assertEqual(bd.sub_stage("Awaiting government approval"), "Awaiting government approval")
        self.assertIsNone(bd.sub_stage(""))

    def test_release_date(self):
        self.assertEqual(bd.release_date("Results released (2025-11-18)"), "2025-11-18")
        self.assertIsNone(bd.release_date("Results released"))
        self.assertIsNone(bd.release_date("Results released (2025-13-40)"))


class DateTests(unittest.TestCase):
    def parse(self, value):
        warnings = []
        return bd.parse_date(value, warnings, "X", "Start date"), warnings

    def test_iso(self):
        self.assertEqual(self.parse("2026-02-26"), ("2026-02-26", []))
        self.assertEqual(self.parse("2026-02-26 00:00:00"), ("2026-02-26", []))

    def test_slash_formats(self):
        self.assertEqual(self.parse("26/02/2026")[0], "2026-02-26")
        self.assertEqual(self.parse("2/26/2026")[0], "2026-02-26")

    def test_ambiguous_is_warned(self):
        value, warnings = self.parse("01/02/2026")
        self.assertEqual(value, "2026-02-01")
        self.assertEqual(len(warnings), 1)

    def test_empty_and_invalid(self):
        self.assertEqual(self.parse(""), (None, []))
        value, warnings = self.parse("soon")
        self.assertIsNone(value)
        self.assertEqual(len(warnings), 1)


class YearAndFundingTests(unittest.TestCase):
    def test_survey_year(self):
        self.assertEqual(bd.survey_year("ETH-2026-SMART-01", None), 2026)
        self.assertEqual(bd.survey_year("weird-id", "2024-05-01"), 2024)
        self.assertIsNone(bd.survey_year("weird-id", None))

    def test_funding(self):
        self.assertEqual(bd.funding("Funded"), "funded")
        self.assertEqual(bd.funding("Partially funded"), "partial")
        self.assertEqual(bd.funding("Unfunded"), "unfunded")
        self.assertIsNone(bd.funding(""))
        self.assertTrue(bd.funding_gap("partial"))
        self.assertTrue(bd.funding_gap("unfunded"))
        self.assertFalse(bd.funding_gap("funded"))
        self.assertIsNone(bd.funding_gap(None))


class BuildTests(unittest.TestCase):
    def test_header_detection_and_output(self):
        rows = ["ETH-2026-SMART-01,ESARO,Ethiopia,eth,Amhara,,SMART,Completed,2026-02-26,,GOAL,,"
                "https://example.org,Results released (2026-08-05),Funded"] + filler_rows(10)
        surveys, warnings = bd.build(sample_csv(rows))
        first = surveys[0]
        self.assertEqual(first["iso3"], "ETH")
        self.assertEqual(first["display_status"], "released")
        self.assertEqual(first["release_date"], "2026-08-05")
        self.assertEqual(first["survey_year"], 2026)
        self.assertIsNone(first["end_date"])  # never invented
        self.assertEqual(warnings, [])

    def test_no_date_based_flags(self):
        surveys, _ = bd.build(sample_csv(filler_rows(11)))
        text = json.dumps(surveys).lower()
        for word in ("overdue", "late", "delayed"):
            self.assertNotIn(word, text)

    def test_warnings(self):
        rows = filler_rows(10) + [
            "MLI-2026-SMART-00,WACRO,Mali,MLI,,,SMART,Overdue,,,,,,,Maybe",
            "XXX-2026-SMART-01,WACRO,Nowhere,,,,SMART,Planned,,,,,,,",
        ]
        _, warnings = bd.build(sample_csv(rows))
        joined = " ".join(warnings)
        self.assertIn("unknown Status", joined)
        self.assertIn("unknown Budget", joined)
        self.assertIn("duplicate Assessment ID", joined)
        self.assertIn("no Country ISO3", joined)

    def test_broken_sheets_are_rejected(self):
        with self.assertRaises(bd.SourceError):
            bd.build("just,some,text\n")
        with self.assertRaises(bd.SourceError):
            bd.build(sample_csv(filler_rows(3)))
        with self.assertRaises(bd.SourceError):
            bd.build("Assessment ID,Country\nA,B\n")  # missing columns


class WriteTests(unittest.TestCase):
    def test_only_writes_when_changed(self):
        surveys, warnings = bd.build(sample_csv(filler_rows(11)))
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.assertTrue(bd.write_outputs(surveys, warnings, out))
            self.assertFalse(bd.write_outputs(surveys, warnings, out))
            meta = json.loads((out / "meta.json").read_text())
            self.assertEqual(meta["row_count"], 11)

    def test_failure_keeps_existing_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            bad = Path(tmp) / "bad.csv"
            bad.write_text("nothing useful\n")
            out = Path(tmp) / "data"
            out.mkdir()
            (out / "surveys.json").write_text("[]\n")
            code = bd.main(["--input", str(bad), "--out", str(out)])
            self.assertEqual(code, 1)
            self.assertEqual((out / "surveys.json").read_text(), "[]\n")


if __name__ == "__main__":
    unittest.main()
