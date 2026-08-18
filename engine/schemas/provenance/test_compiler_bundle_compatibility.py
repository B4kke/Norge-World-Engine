from __future__ import annotations

import hashlib
import json
from pathlib import Path

from jsonschema import Draft202012Validator
from pyproj import Transformer

from nwe_compiler.acquisition import AcquiredSource, nvdb_contract, osm_contract
from nwe_compiler.vector_artifacts import compile_building_artifact, compile_road_artifact

SCHEMA_PATH = Path(__file__).with_name("runtime-verification-bundle.schema.json")


def _canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def _validator() -> Draft202012Validator:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def _acquired(contract, payload: dict) -> AcquiredSource:
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


def test_current_road_compiler_bundle_conforms() -> None:
    to33 = Transformer.from_crs("EPSG:25832", "EPSG:25833", always_xy=True)
    p0 = to33.transform(611100.0, 6677100.0)
    p1 = to33.transform(611200.0, 6677200.0)
    payload = {
        "objekter": [
            {
                "veglenkesekvensid": 1,
                "segmentnummer": 1,
                "typeVeg": "Bilveg",
                "geometri": {"wkt": f"LINESTRING Z ({p0[0]} {p0[1]} 190, {p1[0]} {p1[1]} 191)"},
            }
        ]
    }
    result = compile_road_artifact(_acquired(nvdb_contract(), payload), canonicalizer=_canonical)
    _validator().validate(result.bundle)


def test_current_building_compiler_bundle_conforms() -> None:
    to4326 = Transformer.from_crs("EPSG:25832", "EPSG:4326", always_xy=True)
    corners = [
        to4326.transform(611100, 6677100),
        to4326.transform(611120, 6677100),
        to4326.transform(611120, 6677120),
        to4326.transform(611100, 6677120),
        to4326.transform(611100, 6677100),
    ]
    elements = []
    node_ids = []
    for index, (lon, lat) in enumerate(corners, start=1):
        node_ids.append(index)
        elements.append({"type": "node", "id": index, "lon": lon, "lat": lat})
    elements.append(
        {
            "type": "way",
            "id": 100,
            "nodes": node_ids,
            "tags": {"building": "yes", "building:levels": "2"},
        }
    )
    result = compile_building_artifact(
        _acquired(osm_contract(), {"elements": elements}),
        canonicalizer=_canonical,
    )
    _validator().validate(result.bundle)
