#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import tempfile
import unittest

import laspy
import numpy as np
from pyproj import CRS
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("inspect_nannestad_laz.py")
SPEC = importlib.util.spec_from_file_location("inspect_nannestad_laz", MODULE_PATH)
assert SPEC and SPEC.loader
inspect = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(inspect)



def write_fixture_laz(path: Path, points: list[tuple[float, float, float, int]], crs: str | None) -> None:
    header = laspy.LasHeader(point_format=6, version="1.4")
    header.scales = [0.01, 0.01, 0.01]
    if crs is not None:
        header.add_crs(CRS.from_user_input(crs))
    las = laspy.LasData(header)
    las.x = np.array([p[0] for p in points], dtype=np.float64)
    las.y = np.array([p[1] for p in points], dtype=np.float64)
    las.z = np.array([p[2] for p in points], dtype=np.float64)
    las.classification = np.array([p[3] for p in points], dtype=np.uint8)
    las.write(path)


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


    def test_real_laz_roundtrip_tile_only_classes(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "mixed.laz"
            write_fixture_laz(path, [
                (611050, 6677050, 52, 1),
                (611150, 6677150, 53, 2),
                (611250, 6677250, 54, 4),
                (611350, 6677350, 55, 6),
                (612100, 6677450, 56, 6),
                (610900, 6677350, 51, 2),
                (612100, 6678250, 59, 5),
            ], "EPSG:25832+5941")
            result = inspect.inspect_laz(path, source_project="synthetic-not-real")
            self.assertEqual(result["schema"], "nwe.nannestad-laz-inspection/0.2")
            self.assertEqual(result["las"]["global_classification"]["building_count"], 2)
            self.assertEqual(result["tile_measurement"]["classification"]["building_count"], 1)
            self.assertEqual(result["tile_measurement"]["classification"]["ground_count"], 1)
            self.assertEqual(result["tile_measurement"]["classification"]["vegetation_count"], 1)
            self.assertEqual(result["tile_measurement"]["points_inside_or_on_tile"], 4)
            self.assertEqual(result["tile_measurement"]["points_outside_tile"], 3)
            self.assertEqual(result["tile_measurement"]["grid_100m"]["cells_with_ground_class"], 1)
            self.assertEqual(result["las"]["crs_check"]["horizontal_epsg"], 25832)
            self.assertEqual(result["las"]["crs_check"]["vertical_epsg"], 5941)
            self.assertTrue(result["las"]["header_bounds_match_decoded"])
            self.assertEqual(result["reconstruction_gate"]["status"], "BLOCKED")

    def test_off_tile_classes_do_not_admit_tile(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "offtile.laz"
            write_fixture_laz(path, [
                (611050, 6677050, 50, 1),
                (612120, 6677050, 50, 2),
                (612130, 6677050, 52, 5),
                (612140, 6677050, 54, 6),
            ], "EPSG:25832+5941")
            result = inspect.inspect_laz(path)
            self.assertEqual(result["las"]["global_classification"]["ground_count"], 1)
            self.assertEqual(result["tile_measurement"]["classification"]["ground_count"], 0)
            self.assertFalse(result["tile_measurement"]["has_reconstruction_classes"]["building"])
            self.assertIn("NO_GROUND_CLASS_INSIDE_TILE", result["reconstruction_gate"]["blockers"])

    def test_missing_vertical_and_wrong_horizontal_are_blocked(self):
        for crs, reason in [
            ("EPSG:25832", "VERTICAL_CRS_NN2000_5941_NOT_PROVEN"),
            (None, "HORIZONTAL_CRS_NOT_EPSG_25832"),
            ("EPSG:25833+5941", "HORIZONTAL_CRS_NOT_EPSG_25832"),
        ]:
            with self.subTest(crs=crs), tempfile.TemporaryDirectory() as temp_dir:
                path = Path(temp_dir) / "crs.laz"
                write_fixture_laz(path, [(611050, 6677050, 50, 2)], crs)
                result = inspect.inspect_laz(path)
                self.assertIn(reason, result["reconstruction_gate"]["blockers"])

    def test_full_coarse_ground_grid_yields_candidate_only(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "grid.laz"
            points = [
                (611000 + 100 * x + 50, 6677000 + 100 * y + 50, 100, 2)
                for y in range(10) for x in range(10)
            ]
            points.extend([(611550, 6677550, 115, 5), (611550, 6677551, 125, 6)])
            write_fixture_laz(path, points, "EPSG:25832+5941")
            result = inspect.inspect_laz(path)
            self.assertEqual(result["tile_measurement"]["grid_100m"]["cells_with_ground_class"], 100)
            self.assertEqual(result["reconstruction_gate"]["status"], "SOURCE_CANDIDATE_ONLY")
            self.assertEqual(result["reconstruction_gate"]["blockers"], [])

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
