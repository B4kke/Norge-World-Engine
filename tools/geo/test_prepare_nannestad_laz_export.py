#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("prepare_nannestad_laz_export.py")
SPEC = importlib.util.spec_from_file_location("prepare_nannestad_laz_export", MODULE_PATH)
assert SPEC and SPEC.loader
export = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(export)


class PrepareNannestadLazExportTests(unittest.TestCase):
    def test_exact_tile_laz_request_has_no_implicit_project_product(self):
        with self.assertRaises(export.ExportRequestError):
            export.build_export_request(
                project="Gjerdrum Ullensaker Nannestad 5pkt 2020",
                project_product=0,
                copy_email="operator@example.invalid",
            )

    def test_exact_tile_laz_request_is_clipped_and_epsg25832(self):
        payload = export.build_export_request(
            project="Gjerdrum Ullensaker Nannestad 5pkt 2020",
            project_product=3,
            copy_email="operator@example.invalid",
        )
        self.assertEqual(payload["Format"], 1)
        self.assertEqual(payload["InputWkid"], 25832)
        self.assertEqual(payload["OutputWkid"], 25832)
        self.assertEqual(payload["Projects"], "Gjerdrum Ullensaker Nannestad 5pkt 2020")
        self.assertEqual(payload["ProjectProduct"], 3)
        self.assertEqual(payload["NHM"], 0)
        self.assertEqual(payload["ProjectMerge"], 1)
        self.assertEqual(payload["ClipToPolygon"], 1)
        self.assertEqual(
            payload["CoordInput"]["coordinates"][0],
            [
                [611000.0, 6677000.0],
                [612000.0, 6677000.0],
                [612000.0, 6678000.0],
                [611000.0, 6678000.0],
                [611000.0, 6677000.0],
            ],
        )

    def test_anonymous_submission_requires_explicit_email(self):
        with self.assertRaises(export.ExportRequestError):
            export.build_export_request(
                project="Example",
                project_product=1,
            )

    def test_password_requires_username(self):
        with self.assertRaises(export.ExportRequestError):
            export.build_export_request(
                project="Example",
                project_product=1,
                copy_email="operator@example.invalid",
                password="do-not-save",
            )

    def test_public_evidence_redacts_operator_identity_and_password(self):
        payload = export.build_export_request(
            project="Example",
            project_product=1,
            username="operator",
            password="secret",
        )
        evidence = export.public_evidence(payload, submitted=False)
        self.assertEqual(evidence["status"], "PREPARED_NOT_SUBMITTED")
        self.assertEqual(evidence["request"]["Username"], "<operator-supplied>")
        self.assertNotIn("Password", evidence["request"])


if __name__ == "__main__":
    unittest.main()
