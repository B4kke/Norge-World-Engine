#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import json
import struct
import tempfile
import unittest
from pathlib import Path

import numpy as np

from terrain_lod_error_probe import MAGIC, mesh_cost, read_nwehgt, run_probe


def write_artifact(path: Path, elevations: np.ndarray) -> str:
    values = np.asarray(elevations, dtype="<f4")
    height, width = values.shape
    header = {
        "schema": "nwe.terrain-height-grid-artifact/0.1",
        "tile_id": "synthetic-test-tile",
        "horizontal_crs": "EPSG:25832",
        "vertical_datum": "NN2000",
        "bounds": [0, 0, width, height],
        "width": width,
        "height": height,
        "pixel_size_m": 1,
        "nodata": -32767,
        "storage": "float32-le-row-major-north-to-south",
        "elevation_min_m": float(values.min()),
        "elevation_max_m": float(values.max()),
    }
    header_bytes = json.dumps(header, sort_keys=True, separators=(",", ":")).encode("utf-8")
    payload = MAGIC + struct.pack("<I", len(header_bytes)) + header_bytes + values.tobytes(order="C")
    path.write_bytes(payload)
    return hashlib.sha256(payload).hexdigest()


class TerrainLodErrorProbeTests(unittest.TestCase):
    def test_constant_surface_has_zero_geometric_error(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "flat.nwehgt"
            digest = write_artifact(artifact, np.full((16, 16), 123.25, dtype=np.float32))
            result = run_probe(artifact, [3, 5, 9], expected_sha256=digest)

        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["evaluation"]["sample_count_per_level"], 256)
        for level in result["levels"]:
            error = level["geometric_error_against_source_pixel_centers"]
            self.assertAlmostEqual(error["rmse_m"], 0.0, places=12)
            self.assertAlmostEqual(error["absolute_error_m"]["max"], 0.0, places=12)
        for transition in result["adjacent_level_edge_transitions"]:
            mismatch = transition["potential_unstitched_edge_mismatch"]
            self.assertAlmostEqual(mismatch["absolute_error_m"]["max"], 0.0, places=12)

    def test_finer_mesh_reduces_error_on_curved_surface(self) -> None:
        rows, columns = np.meshgrid(np.arange(32), np.arange(32), indexing="ij")
        surface = (
            100.0
            + 2.0 * np.sin(columns / 2.7)
            + 1.4 * np.cos(rows / 3.3)
            + 0.8 * np.sin((rows + columns) / 2.1)
        ).astype(np.float32)
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "curved.nwehgt"
            digest = write_artifact(artifact, surface)
            result = run_probe(artifact, [5, 9, 17], expected_sha256=digest)

        rmse = [level["geometric_error_against_source_pixel_centers"]["rmse_m"] for level in result["levels"]]
        self.assertGreater(rmse[0], rmse[1])
        self.assertGreater(rmse[1], rmse[2])
        self.assertGreater(rmse[2], 0.0)

    def test_nested_levels_can_have_unstitched_edge_mismatch(self) -> None:
        columns = np.arange(32, dtype=np.float64)
        north_edge_profile = 50.0 + 4.0 * np.sin(columns / 2.0)
        surface = np.repeat(north_edge_profile[np.newaxis, :], 32, axis=0).astype(np.float32)
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "edge.nwehgt"
            digest = write_artifact(artifact, surface)
            result = run_probe(artifact, [5, 9], expected_sha256=digest)

        transition = result["adjacent_level_edge_transitions"][0]
        self.assertTrue(transition["nested_xy_grid"])
        mismatch = transition["potential_unstitched_edge_mismatch"]
        self.assertGreater(mismatch["absolute_error_m"]["max"], 0.1)
        self.assertIn("not an observed screen-space crack", transition["interpretation"])

    def test_sha_gate_and_uint32_cost_transition(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "flat.nwehgt"
            digest = write_artifact(artifact, np.zeros((4, 4), dtype=np.float32))
            header, elevations, observed, _ = read_nwehgt(artifact, expected_sha256=digest)
            self.assertEqual(observed, digest)
            self.assertEqual(elevations.shape, (4, 4))
            self.assertEqual(header["tile_id"], "synthetic-test-tile")
            with self.assertRaisesRegex(ValueError, "sha256 mismatch"):
                read_nwehgt(artifact, expected_sha256="0" * 64)

        self.assertEqual(mesh_cost(129, 1000, 1000)["index_type"], "uint16")
        high = mesh_cost(257, 1000, 1000)
        self.assertEqual(high["index_type"], "uint32")
        self.assertEqual(high["renderer_terrain_gpu_payload_bytes"], 3_158_040)


if __name__ == "__main__":
    unittest.main()
