#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse

MODULE_PATH = Path(__file__).with_name("probe_nannestad_lidar.py")
SPEC = importlib.util.spec_from_file_location("probe_nannestad_lidar", MODULE_PATH)
assert SPEC and SPEC.loader
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


def feature_xml(**props: str) -> str:
    fields = "".join(
        f"<metadata_prosjekt:{key}>{value}</metadata_prosjekt:{key}>"
        for key, value in props.items()
    )
    return f"<wfs:member><metadata_prosjekt:Prosjektavgrensning>{fields}</metadata_prosjekt:Prosjektavgrensning></wfs:member>"


def collection_xml(*features: str, matched: int | None = None) -> bytes:
    matched_value = len(features) if matched is None else matched
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" '
        'xmlns:metadata_prosjekt="https://example.invalid/metadata" '
        f'numberMatched="{matched_value}" numberReturned="{len(features)}">'
        + "".join(features)
        + "</wfs:FeatureCollection>"
    ).encode("utf-8")


class ProbeNannestadLidarTests(unittest.TestCase):
    def test_wfs_url_is_exact_bbox_and_source_field_query(self):
        parsed = urlparse(probe.wfs_url())
        query = parse_qs(parsed.query)
        self.assertEqual(query["service"], ["WFS"])
        self.assertEqual(query["version"], ["2.0.0"])
        self.assertEqual(query["typeNames"], ["metadata_prosjekt:Prosjektavgrensning"])
        self.assertEqual(query["srsName"], ["EPSG:25832"])
        self.assertEqual(query["bbox"], ["611000,6677000,612000,6678000,EPSG:25832"])
        self.assertIn("LAS_PROJECT_NAME", query["propertyName"][0])
        self.assertIn("TILGANG", query["propertyName"][0])
        self.assertNotIn("SHAPE", query["propertyName"][0])

    def test_gml_parser_extracts_only_small_source_fields(self):
        raw = collection_xml(
            feature_xml(
                LAS_PROJECT_ID="209",
                LAS_PROJECT_NAME="Ullensaker Nes Nannestad 2010",
                TYPE="1",
                TILGANG="1",
                PROSJEKTNR="LACHOA07",
                KOORDINATSYSTEM="25832",
                HOYDESYSTEM="5941",
                PUNKTTETTHET="0.7",
                AARSTALL="2010",
                PUBLISERT="published",
            ),
            matched=9,
        )
        projects, matched, returned = probe.parse_wfs_gml(raw)
        self.assertEqual(matched, 9)
        self.assertEqual(returned, 1)
        self.assertEqual(projects[0]["LAS_PROJECT_NAME"], "Ullensaker Nes Nannestad 2010")
        self.assertEqual(projects[0]["PUNKTTETTHET"], "0.7")

    def test_newer_closed_project_does_not_beat_open_2020_laser(self):
        projects = [
            {
                "LAS_PROJECT_NAME": "Closed future laser",
                "TYPE": "1",
                "TILGANG": "2",
                "AARSTALL": "2026",
                "PUNKTTETTHET": "20",
                "PUBLISERT": "published",
            },
            {
                "LAS_PROJECT_NAME": "Gjerdrum Ullensaker Nannestad 5pkt 2020",
                "PROSJEKTNR": "LACHVI04",
                "TYPE": "1",
                "TILGANG": "1",
                "AARSTALL": "2020",
                "PUNKTTETTHET": "5",
                "PUBLISERT": "published",
            },
        ]
        result = probe.analyze_wfs_projects(projects, number_matched=2, number_returned=2)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["laser_candidate_count"], 2)
        self.assertEqual(result["open_laser_candidate_count"], 1)
        self.assertEqual(
            result["recommended_project"]["name"],
            "Gjerdrum Ullensaker Nannestad 5pkt 2020",
        )
        self.assertEqual(result["recommended_project"]["ordered_point_density_per_m2"], 5.0)
        self.assertIn("intersection", result["truth"])
        self.assertIn("clipped LAZ", result["truth"])

    def test_non_laser_overlap_is_not_admitted(self):
        result = probe.analyze_wfs_projects(
            [{"LAS_PROJECT_NAME": "Image matching", "TYPE": "2", "TILGANG": "1"}],
            number_matched=1,
            number_returned=1,
        )
        self.assertEqual(result["status"], "NO_LASER_CANDIDATE")
        self.assertEqual(result["overlap_candidate_count"], 1)
        self.assertEqual(result["laser_candidate_count"], 0)
        self.assertIsNone(result["recommended_project"])

    def test_malformed_provider_xml_fails_closed(self):
        with self.assertRaises(probe.LidarProbeError):
            probe.parse_wfs_gml(b"<wfs:FeatureCollection")

    def test_wfs_exception_fails_closed(self):
        raw = (
            '<?xml version="1.0"?>'
            '<ows:ExceptionReport xmlns:ows="http://www.opengis.net/ows/1.1">'
            '<ows:Exception><ows:ExceptionText>provider failed</ows:ExceptionText></ows:Exception>'
            '</ows:ExceptionReport>'
        ).encode("utf-8")
        with self.assertRaises(probe.LidarProbeError):
            probe.parse_wfs_gml(raw)


if __name__ == "__main__":
    unittest.main()
