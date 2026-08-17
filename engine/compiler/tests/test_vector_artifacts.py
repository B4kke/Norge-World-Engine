import hashlib
import json
from pathlib import Path

from pyproj import Transformer

from nwe_compiler.acquisition import AcquiredSource, nvdb_contract, osm_contract
from nwe_compiler.vector_artifacts import compile_building_artifact, compile_road_artifact, persist_compiled_artifact


def _test_canonical(value):
    # Structural/determinism harness only. Production defaults to RFC 8785/JCS.
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def _acquired(contract, payload):
    raw = json.dumps(payload, separators=(",", ":")).encode()
    return AcquiredSource(
        contract=contract,
        raw_bytes=raw,
        raw_sha256=hashlib.sha256(raw).hexdigest(),
        cache_path="/ignored/raw.json",
        cache_hit=False,
        raw_object_count=1,
        selected_feature_count=1,
    )


def test_road_artifact_is_deterministic_and_lineage_bound(tmp_path: Path):
    to33 = Transformer.from_crs("EPSG:25832", "EPSG:25833", always_xy=True)
    points = [to33.transform(611100.0, 6677100.0), to33.transform(611200.0, 6677200.0), to33.transform(611300.0, 6677300.0)]
    payload = {"objekter": [
        {"veglenkesekvensid": 1, "segmentnummer": 1, "typeVeg": "Bilveg", "geometri": {"wkt": f"LINESTRING Z ({points[0][0]} {points[0][1]} 190, {points[1][0]} {points[1][1]} 191)"}},
        {"veglenkesekvensid": 2, "segmentnummer": 1, "typeVeg": "Bilveg", "geometri": {"wkt": f"LINESTRING Z ({points[1][0]} {points[1][1]} 191, {points[2][0]} {points[2][1]} 192)"}},
    ]}
    source = _acquired(nvdb_contract(), payload)
    a = compile_road_artifact(source, canonicalizer=_test_canonical)
    b = compile_road_artifact(source, canonicalizer=_test_canonical)
    assert a.artifact_bytes == b.artifact_bytes
    assert a.artifact_sha256 == b.artifact_sha256
    assert a.normalized_count == 2
    assert a.compiled_count == 1
    assert a.bundle["artifact_ref"]["artifact_status"] == "REAL_COMPILED"
    assert a.bundle["artifact_ref"]["transport"]["reference"].startswith("cache://compiled/")
    persisted = persist_compiled_artifact(a, tmp_path, canonicalizer=_test_canonical)
    assert Path(persisted.artifact_path).read_bytes() == a.artifact_bytes
    assert Path(persisted.bundle_path).exists()


def test_building_artifact_drops_unneeded_tags_but_keeps_height_provenance():
    to4326 = Transformer.from_crs("EPSG:25832", "EPSG:4326", always_xy=True)
    corners = [
        to4326.transform(611100, 6677100),
        to4326.transform(611120, 6677100),
        to4326.transform(611120, 6677120),
        to4326.transform(611100, 6677120),
        to4326.transform(611100, 6677100),
    ]
    elements = []
    ids = []
    for i, (lon, lat) in enumerate(corners, start=1):
        ids.append(i)
        elements.append({"type": "node", "id": i, "lon": lon, "lat": lat})
    elements.append({"type": "way", "id": 100, "nodes": ids, "tags": {"building": "yes", "building:levels": "2", "name": "fixture"}})
    source = _acquired(osm_contract(), {"elements": elements})
    result = compile_building_artifact(source, canonicalizer=_test_canonical)
    feature = result.artifact_payload["features"][0]
    assert feature["height_m"] == 6.0
    assert feature["height_source"] == "osm:building:levels*3m"
    assert "tags" not in feature
    assert result.normalized_payload["features"][0]["tags"]["name"] == "fixture"
