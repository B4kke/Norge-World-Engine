#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse

MODULE_PATH = Path(__file__).with_name("probe_nannestad_lidar.py")
SPEC = importlib.util.spec_from_file_location("probe_nannestad_lidar", MODULE_PATH)
assert SPEC and SPEC.loader
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


class ProbeNannestadLidarTests(unittest.TestCase):
    def test_metadata_url_is_exact_tile_query(self):
        parsed = urlparse(probe.metadata_url())
        request = json.loads(parse_qs(parsed.query)["request"][0])
        self.assertEqual(request["InputWKID"], 25832)
        self.assertEqual(request["OutputWKID"], 25832)
        self.assertEqual(request["Type"], 1)
        self.assertEqual(request["Verticaldatum"], "NN2000")
        self.assertEqual(
            request["Coordinates"],
            "611000,6677000;612000,6677000;612000,6678000;611000,6678000;611000,6677000",
        )

    def test_closed_project_does_not_win_over_open_2020_source(self):
        payload = [
            {
                "PROSJEKTNAVN": "Romerike future closed",
                "AARSTALL": 2025,
                "TILGANG": "2",
                "BESTILT_PUNKTTETTHET": "10",
            },
            {
                "PROSJEKTNAVN": "Gjerdrum Ullensaker Nannestad 5pkt 2020",
                "PROSJEKTNR": "LACHVI04",
                "AARSTALL": "2020",
                "TILGANG": "1",
                "BESTILT_PUNKTTETTHET": "5",
                "HOYDESYSTEM": "NN2000",
            },
        ]
        result = probe.analyze_provider_payload(payload)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["open_candidate_count"], 1)
        self.assertEqual(
            result["recommended_project"]["name"],
            "Gjerdrum Ullensaker Nannestad 5pkt 2020",
        )
        self.assertEqual(result["recommended_project"]["ordered_point_density_per_m2"], 5.0)

    def test_geojson_feature_collection_is_supported(self):
        payload = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Polygon", "coordinates": []},
                    "properties": {
                        "ProsjektNavn": "Example Laser",
                        "Aarstall": 2020,
                        "Tilgang": 1,
                    },
                }
            ],
        }
        result = probe.analyze_provider_payload(payload)
        self.assertEqual(result["candidate_count"], 1)
        self.assertEqual(result["recommended_project"]["name"], "Example Laser")
        self.assertIn("_geometry", result["recommended_project"]["raw_metadata"])

    def test_empty_payload_is_no_candidate_not_provider_error(self):
        result = probe.analyze_provider_payload({"features": []})
        self.assertEqual(result["status"], "NO_CANDIDATE")
        self.assertEqual(result["candidate_count"], 0)
        self.assertEqual(result["open_candidate_count"], 0)


if __name__ == "__main__":
    unittest.main()
