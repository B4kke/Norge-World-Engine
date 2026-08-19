#!/usr/bin/env python3

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np

from terrain_lod_transition_probe import run_transition_probe, skirt_cost_projection
from test_terrain_lod_error_probe import write_artifact


class TerrainLodTransitionProbeTests(unittest.TestCase):
    def test_flat_surface_requires_no_edge_morph(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "flat.nwehgt"
            digest = write_artifact(artifact, np.full((32, 32), 42.0, dtype=np.float32))
            result = run_transition_probe(artifact, 5, 9, expected_sha256=digest)

        morph = result["edge_morph_candidate"]
        self.assertEqual(morph["changed_fine_vertices"], 0)
        self.assertAlmostEqual(morph["max_abs_vertex_displacement_m"], 0.0, places=12)
        self.assertAlmostEqual(morph["edge_mismatch_after"]["absolute_error_m"]["max"], 0.0, places=12)
        self.assertAlmostEqual(morph["rmse_delta_m"], 0.0, places=12)
        self.assertIsNone(result["decision"]["selected_strategy"])

    def test_curved_edge_morph_eliminates_boundary_mismatch_with_bounded_scope(self) -> None:
        columns = np.arange(32, dtype=np.float64)
        rows = np.arange(32, dtype=np.float64)
        grid_x, grid_y = np.meshgrid(columns, rows)
        surface = (80.0 + 4.0 * np.sin(grid_x / 2.0) + 0.8 * np.cos(grid_y / 4.0)).astype(np.float32)
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "curved.nwehgt"
            digest = write_artifact(artifact, surface)
            result = run_transition_probe(artifact, 5, 9, expected_sha256=digest)

        before = result["transition"]["unmodified_edge"]["absolute_error_m"]["max"]
        morph = result["edge_morph_candidate"]
        self.assertGreater(before, 0.1)
        self.assertGreater(morph["changed_fine_vertices"], 0)
        self.assertLess(morph["changed_vertex_fraction"], 0.5)
        self.assertGreater(morph["max_abs_vertex_displacement_m"], 0.1)
        self.assertAlmostEqual(morph["edge_mismatch_after"]["absolute_error_m"]["max"], 0.0, places=12)

    def test_rejects_non_nested_transition(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "flat.nwehgt"
            digest = write_artifact(artifact, np.zeros((16, 16), dtype=np.float32))
            with self.assertRaisesRegex(ValueError, "nested XY"):
                run_transition_probe(artifact, 5, 8, expected_sha256=digest)

    def test_skirt_cost_is_explicit_and_does_not_choose_depth(self) -> None:
        balanced = skirt_cost_projection(129, 1000, 1000)
        high = skirt_cost_projection(257, 1000, 1000)
        self.assertEqual(balanced["added_boundary_vertices"], 512)
        self.assertEqual(balanced["added_triangles"], 1024)
        self.assertEqual(balanced["renderer_terrain_gpu_payload_delta_bytes"], 18_432)
        self.assertEqual(balanced["resulting_index_type"], "uint16")
        self.assertIsNone(balanced["skirt_depth_m"])
        self.assertEqual(high["renderer_terrain_gpu_payload_delta_bytes"], 49_152)
        self.assertEqual(high["resulting_index_type"], "uint32")


if __name__ == "__main__":
    unittest.main()
