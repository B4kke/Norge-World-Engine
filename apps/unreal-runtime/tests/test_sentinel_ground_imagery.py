from __future__ import annotations

from datetime import date
import importlib.util
from pathlib import Path
import sys

import numpy as np
import pytest


MODULE_PATH = Path(__file__).parents[1] / "Tools" / "fetch_sentinel_ground_imagery.py"
SPEC = importlib.util.spec_from_file_location("fetch_sentinel_ground_imagery", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
sentinel = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = sentinel
SPEC.loader.exec_module(sentinel)


def _item(item_id: str, captured: str, cloud: float, *, visual: bool = True) -> dict:
    assets = (
        {"visual": {"href": f"https://example.invalid/{item_id}/visual.tif"}}
        if visual
        else {
            "red": {"href": f"https://example.invalid/{item_id}/red.tif", "raster:bands": [{"scale": 0.0001, "offset": 0.0}]},
            "green": {"href": f"https://example.invalid/{item_id}/green.tif", "raster:bands": [{"scale": 0.0001, "offset": 0.0}]},
            "blue": {"href": f"https://example.invalid/{item_id}/blue.tif", "raster:bands": [{"scale": 0.0001, "offset": 0.0}]},
        }
    )
    return {
        "id": item_id,
        "collection": "sentinel-2-l2a",
        "properties": {"datetime": captured, "eo:cloud_cover": cloud},
        "assets": assets,
    }


def test_target_bbox_matches_nannestad_1km_tile() -> None:
    min_lon, min_lat, max_lon, max_lat = sentinel.target_bbox_wgs84()
    # EPSG:25832 grid north/east axes are rotated relative to WGS84, so
    # the geographic search bbox must envelope all four transformed corners,
    # not merely reuse southwest/northeast corner coordinates.
    assert min_lon == pytest.approx(11.003239, abs=1e-5)
    assert min_lat == pytest.approx(60.214367, abs=1e-5)
    assert max_lon == pytest.approx(11.021826, abs=1e-5)
    assert max_lat == pytest.approx(60.223614, abs=1e-5)


def test_default_search_window_covers_three_summers() -> None:
    assert sentinel.default_search_window(date(2026, 9, 15)) == ("2024-05-15", "2026-09-15")
    assert sentinel.default_search_window(date(2026, 3, 1)) == ("2023-05-15", "2025-09-15")


def test_scene_selection_prefers_low_cloud_then_midsummer() -> None:
    item, plan = sentinel.select_item(
        [
            _item("cloudy", "2026-07-15T10:00:00Z", 12.0),
            _item("clean-may", "2026-05-20T10:00:00Z", 2.0),
            _item("clean-july", "2026-07-12T10:00:00Z", 2.0),
            _item("winter", "2026-02-12T10:00:00Z", 0.0),
        ],
        max_cloud_percent=20.0,
    )
    assert item["id"] == "clean-july"
    assert plan["mode"] == "visual"


def test_asset_plan_rejects_requester_pays_s3_and_accepts_public_rgb() -> None:
    item = _item("rgb", "2026-07-01T10:00:00Z", 1.0, visual=False)
    item["assets"]["visual"] = {"href": "s3://requester-pays/TCI.jp2"}
    plan = sentinel.asset_plan(item)
    assert plan is not None
    assert plan["mode"] == "reflectance-rgb"
    assert set(plan["assets"]) == {"red", "green", "blue"}


def test_reflectance_rgb_applies_declared_scale_and_bounded_display_transform() -> None:
    raw = {
        "red": np.array([[0.0, 1500.0, 3000.0]], dtype=np.float32),
        "green": np.array([[0.0, 1000.0, 3000.0]], dtype=np.float32),
        "blue": np.array([[0.0, 500.0, 3000.0]], dtype=np.float32),
    }
    assets = {
        key: {"raster:bands": [{"scale": 0.0001, "offset": 0.0}]}
        for key in raw
    }
    rgb = sentinel.compose_reflectance_rgb(raw, assets)
    assert rgb.dtype == np.uint8
    assert rgb.shape == (3, 1, 3)
    assert np.all(rgb[:, 0, 0] == 0)
    assert np.all(rgb[:, 0, 2] == 255)
    assert rgb[0, 0, 1] > rgb[1, 0, 1] > rgb[2, 0, 1]
