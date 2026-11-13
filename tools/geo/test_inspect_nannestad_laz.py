#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("inspect_nannestad_laz.py")
SPEC = importlib.util.spec_from_file_location("inspect_nannestad_laz", MODULE_PATH)
assert SPEC and SPEC.loader
inspect = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(inspect)


class InspectNannestadLazTests(unittest.TestCase):
    def test_tile_boundary_is_inclusive(self):
        self.assertTrue(inspect.point_in_tile(611000.0, 6677000.0))
        self.assertTrue(inspect.point_in_tile(612000.0, 6678000.0))
        self.assertFalse(inspect.point_in_tile(610999.999, 6677000.0))
        self.assertFalse(inspect.point_in_tile(612000.001, 6678000.0))

    def test_classification_summary_preserves_source_codes(self):
        result = inspect.summarize_classifications([2, 2, 3, 4, 5, 5, 6, 9, 42])
        self.assertEqual(result["ground_count"], 2)
        self.assertEqual(result["vegetation_count"], 4)
        self.assertEqual(result["building_count"], 1)
        self.assertEqual(result["by_code"]["42"]["label"], "other_or_provider_specific")

    def test_sha256_file_is_exact_byte_identity(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "source.laz"
            path.write_bytes(b"NWE exact lidar bytes\n")
            self.assertEqual(
                inspect.sha256_file(path),
                "8763a0c037383761afa3b673f23201e494beaa2d26adcfdd038431891193d58a",
            )


if __name__ == "__main__":
    unittest.main()
