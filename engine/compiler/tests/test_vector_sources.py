from pyproj import Transformer

from nwe_compiler.roads import RoadSegment, compile_road_paths
from nwe_compiler.sources.nvdb import clip_polyline, normalize_nvdb_segments, normalize_z
from nwe_compiler.sources.osm_buildings import normalize_osm_buildings


def _segment(source_id, a, b, road_type="Bilveg", sequence=None):
    return RoadSegment(source_id, sequence, None, road_type, (a, b))


def test_degree_two_chain_merges_across_sequence_ids():
    paths = compile_road_paths(
        [
            _segment("a", (0, 0, 10), (10, 0, 10), sequence="1"),
            _segment("b", (10.08, 0.02, 10), (20, 0, 10), sequence="2"),
            _segment("c", (20, 0, 10), (30, 0, 10), sequence="3"),
        ],
        snap_m=0.25,
    )
    assert len(paths) == 1
    assert paths[0].source_segment_ids == ("a", "b", "c")
    assert set(paths[0].source_sequence_ids) == {"1", "2", "3"}


def test_junction_stops_merge():
    paths = compile_road_paths(
        [
            _segment("a", (0, 0, None), (10, 0, None)),
            _segment("b", (10, 0, None), (20, 0, None)),
            _segment("c", (10, 0, None), (10, 10, None)),
        ]
    )
    assert len(paths) == 3


def test_nvdb_utm33_to_utm32_and_sentinel_z():
    to33 = Transformer.from_crs("EPSG:25832", "EPSG:25833", always_xy=True)
    a = to33.transform(611100.0, 6677100.0)
    b = to33.transform(611200.0, 6677200.0)
    payload = [
        {
            "veglenkesekvensid": 42,
            "segmentnummer": 7,
            "startposisjon": 0.1,
            "sluttposisjon": 0.2,
            "typeVeg": "Bilveg",
            "geometri": {"wkt": f"LINESTRING Z ({a[0]} {a[1]} 194.2, {b[0]} {b[1]} -999999)"},
        }
    ]
    output = normalize_nvdb_segments(payload)
    assert len(output) == 1
    assert abs(output[0].points[0][0] - 611100.0) < 0.02
    assert abs(output[0].points[0][1] - 6677100.0) < 0.02
    assert output[0].points[0][2] == 194.2
    assert output[0].points[-1][2] is None
    assert normalize_z(-999999) is None


def test_shapely_clip_interpolates_z_at_tile_boundary():
    points = ((610990.0, 6677100.0, 190.0), (611010.0, 6677100.0, 200.0))
    clipped = clip_polyline(points)
    assert len(clipped) == 1
    assert abs(clipped[0][0][0] - 611000.0) < 1e-9
    assert abs(clipped[0][0][2] - 195.0) < 1e-9


def _lonlat(east, north):
    return Transformer.from_crs("EPSG:25832", "EPSG:4326", always_xy=True).transform(east, north)


def test_osm_main_api_building_normalization_and_levels_height():
    corners = [
        _lonlat(611100, 6677100),
        _lonlat(611120, 6677100),
        _lonlat(611120, 6677110),
        _lonlat(611100, 6677110),
        _lonlat(611100, 6677100),
    ]
    elements = []
    node_ids = []
    for index, (lon, lat) in enumerate(corners, start=1):
        elements.append({"type": "node", "id": index, "lon": lon, "lat": lat})
        node_ids.append(index)
    elements.append(
        {
            "type": "way",
            "id": 100,
            "nodes": node_ids,
            "tags": {"building": "yes", "building:levels": "2"},
        }
    )
    output = normalize_osm_buildings({"elements": elements})
    assert len(output) == 1
    assert 199.0 < output[0].area_m2 < 201.0
    assert output[0].height_m == 6.0
    assert output[0].height_source == "osm:building:levels*3m"
    assert not output[0].clipped


def test_invalid_bow_tie_building_is_rejected():
    corners = [
        _lonlat(611100, 6677100),
        _lonlat(611120, 6677120),
        _lonlat(611120, 6677100),
        _lonlat(611100, 6677120),
        _lonlat(611100, 6677100),
    ]
    elements = []
    node_ids = []
    for index, (lon, lat) in enumerate(corners, start=1):
        elements.append({"type": "node", "id": index, "lon": lon, "lat": lat})
        node_ids.append(index)
    elements.append({"type": "way", "id": 101, "nodes": node_ids, "tags": {"building": "yes"}})
    assert normalize_osm_buildings({"elements": elements}) == []
