from __future__ import annotations

import pytest
from shapely.geometry import box

from nwe_compiler.sources.dtm1_atom import (
    DatasetSourcePlan,
    Entry,
    FeedError,
    UnresolvedSpatialIndex,
    select_dataset_entry,
    select_dataset_sources,
)
from nwe_compiler.spatial import DeclaredExtent, target_wgs84_polygon
from nwe_compiler.tiles import NANNESTAD_TILE


def _entry(name: str, geometry) -> Entry:
    return Entry(
        id=f"https://example.invalid/{name}.tif",
        title=name,
        published=None,
        updated="2026-08-18T00:00:00Z",
        links=[
            {
                "rel": "section",
                "href": f"https://example.invalid/{name}.tif",
                "type": "application/geotiff",
                "hreflang": None,
                "title": f"{name}.tif",
            }
        ],
        categories=[
            {
                "term": "http://www.opengis.net/def/crs/EPSG/0/25833",
                "scheme": "https://example.invalid/epsg",
                "label": "ETRS89 / UTM zone 33N",
            }
        ],
        declared_extent=DeclaredExtent("polygon", geometry, name),
    )


def _split_target():
    target = target_wgs84_polygon(NANNESTAD_TILE.bounds)
    left, bottom, right, top = target.bounds
    mid = (left + right) / 2.0
    return target, box(left - 0.01, bottom - 0.01, mid, top + 0.01), box(mid, bottom - 0.01, right + 0.01, top + 0.01)


def test_two_source_union_is_selected_when_no_single_source_covers_target():
    _, west, east = _split_target()
    plan = select_dataset_sources([_entry("west", west), _entry("east", east)])

    assert isinstance(plan, DatasetSourcePlan)
    assert plan.mosaic_required
    assert [source.entry.title for source in plan.sources] == ["east", "west"]
    assert len(plan.sources) == 2

    with pytest.raises(FeedError, match="requires 2 DTM1 sources"):
        select_dataset_entry([_entry("west", west), _entry("east", east)])


def test_single_source_path_remains_backward_compatible():
    target = target_wgs84_polygon(NANNESTAD_TILE.bounds)
    covering = box(*target.buffer(0.01).bounds)
    plan = select_dataset_sources([_entry("single", covering)])
    selected, href, _, _ = select_dataset_entry([_entry("single", covering)])

    assert not plan.mosaic_required
    assert plan.sources[0].entry.title == "single"
    assert selected.title == "single"
    assert href.endswith("/single.tif")


def test_multiple_minimal_source_sets_fail_closed():
    _, west, east = _split_target()
    entries = [_entry("west", west), _entry("east-a", east), _entry("east-b", east)]
    with pytest.raises(UnresolvedSpatialIndex, match="multiple minimal GeoRSS source sets"):
        select_dataset_sources(entries)


def test_incomplete_union_fails_closed():
    target = target_wgs84_polygon(NANNESTAD_TILE.bounds)
    left, bottom, right, top = target.bounds
    span = right - left
    west = box(left - 0.01, bottom - 0.01, left + span * 0.4, top + 0.01)
    east = box(left + span * 0.6, bottom - 0.01, right + 0.01, top + 0.01)
    with pytest.raises(FeedError, match="no CRS-compatible dataset source set geometry covers target"):
        select_dataset_sources([_entry("west", west), _entry("east", east)])
