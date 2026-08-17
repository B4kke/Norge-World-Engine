from __future__ import annotations

import pytest

from nwe_compiler.sources.dtm1_atom import (
    DTM1_SOURCE_CRS,
    FeedError,
    category_crs,
    geotiff_href,
    parse_feed,
    retrieval_identity,
    select_dataset_entry,
    source_snapshot,
)


LIVE_SHAPE = b'''<feed xmlns="http://www.w3.org/2005/Atom" xmlns:georss="http://www.georss.org/georss">
  <entry>
    <id>https://nedlasting.geonorge.no/geonorge/ATOM/hoydedata/DTM1/33-125-117.tif</id>
    <title>H\xc3\xb8ydedata DTM1 33-125-117</title>
    <updated>2024-11-21T16:52:54</updated>
    <category term="http://www.opengis.net/def/crs/EPSG/0/25833" scheme="https://register.geonorge.no/api/epsg-koder" label="ETRS89 / UTM zone 33N"/>
    <category term="GeoTIFF" label="GeoTIFF"/>
    <category term="3238" label="Nannestad"/>
    <link rel="section" type="application/geotiff" hreflang="no" title="33-125-117.tif" href="https://nedlasting.geonorge.no/hoydedata/DTM1/33-125-117.tif"/>
    <georss:polygon>60.203707167608755 10.93041842357574 60.203707167608755 11.21727557763492 60.34617671027682 11.21727557763492 60.34617671027682 10.93041842357574 60.203707167608755 10.93041842357574</georss:polygon>
  </entry>
</feed>'''


def test_live_dtm1_shape_selects_epsg25833_section_geotiff():
    entries = parse_feed(LIVE_SHAPE)
    assert len(entries) == 1
    entry = entries[0]
    assert category_crs(entry) == [DTM1_SOURCE_CRS]
    assert geotiff_href(entry) == "https://nedlasting.geonorge.no/hoydedata/DTM1/33-125-117.tif"

    selected, href, _, extent = select_dataset_entry(entries)
    assert selected.id.endswith("/33-125-117.tif")
    assert href.endswith("/33-125-117.tif")
    assert extent.geometry_type == "polygon"

    identity = retrieval_identity(
        "https://nedlasting.geonorge.no/geonorge/ATOM/hoydedata/Hoydedata_ServiceFeed.atom",
        "https://nedlasting.geonorge.no/geonorge/ATOM/hoydedata/datasett/DTM1.atom",
        selected,
        extent,
    )
    assert identity["dataset_entry_href"] == href
    assert identity["dataset_entry_category_crs"] == ["EPSG:25833"]


def test_live_dtm1_selection_does_not_silently_accept_wrong_source_crs():
    wrong = LIVE_SHAPE.replace(b"25833", b"25832").replace(b"zone 33N", b"zone 32N")
    with pytest.raises(FeedError, match="no CRS-compatible"):
        select_dataset_entry(parse_feed(wrong))


def test_selected_entry_requires_explicit_geotiff_media_link():
    no_geotiff = LIVE_SHAPE.replace(b"application/geotiff", b"application/octet-stream")
    entry = parse_feed(no_geotiff)[0]
    with pytest.raises(FeedError, match="exactly one GeoTIFF link"):
        geotiff_href(entry)


def test_dtm1_raw_source_snapshot_keeps_source_crs_separate_from_world_crs():
    entry = parse_feed(LIVE_SHAPE)[0]
    identity = retrieval_identity("service", "dataset", entry, entry.declared_extent)
    raw = b"II*\x00fixture"
    metadata = {
        "crs": "EPSG:25833",
        "vertical_datum": "NN2000",
        "pixel_size": [1.0, 1.0],
        "bounds": [275000.0, 6675000.0, 290000.0, 6690000.0],
        "nodata": -9999.0,
    }
    snapshot = source_snapshot(identity, raw, metadata)
    assert snapshot["source_crs"] == "EPSG:25833"
    assert snapshot["source_vertical_datum"] == "NN2000"

    with pytest.raises(FeedError, match="unexpected DTM1 source CRS"):
        source_snapshot(identity, raw, {**metadata, "crs": "EPSG:25832"})
