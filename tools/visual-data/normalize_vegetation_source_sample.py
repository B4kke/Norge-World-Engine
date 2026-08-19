#!/usr/bin/env python3
"""Normalize cached SR16V + AR50 Nannestad source bytes into a deterministic candidate sample.

This tool is deliberately source-network-free: it accepts only local cache paths from the
materialization manifest. GDAL/OGR performs generic GML decoding/reprojection and Shapely
performs exact tile clipping/geometry normalization. RFC 8785/JCS defines output bytes.

The output is source-admission evidence, not a selected vegetation runtime artifact and not
individual-tree truth.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from shapely import normalize as normalize_geometry
from shapely.geometry import box, mapping, shape

from nwe_compiler.canonical import canonical_bytes, canonical_sha256

TILE_ID = "epsg25832_611000_6677000_1000m"
BOUNDS_25832 = (611000.0, 6677000.0, 612000.0, 6678000.0)
TILE_POLYGON = box(*BOUNDS_25832)

SOURCE_CONFIG = {
    "sr16v": {
        "provider": "NIBIO",
        "dataset": "SR16 - Skogressurskart 16x16 meter - Vektor",
        "metadata_uuid": "27206b9e-4830-4f71-810d-d04c0dc32b59",
        "license": "NLOD-1.0",
        "attribution": "Kilde: NIBIO",
        "preferred_layer_tokens": ("skogressurs", "sr16"),
        "source_id_fields": ("prod_lokalid", "lokalid", "gid", "rid", "objectid"),
        "volatile_fields": frozenset(),
    },
    "ar50": {
        "provider": "NIBIO",
        "dataset": "AR50",
        "metadata_uuid": "a7949917-033c-4e78-8c0f-e30323ce353a",
        "license": "NLOD-1.0",
        "attribution": "Kilde: NIBIO",
        "preferred_layer_tokens": ("ar50", "arealressurs"),
        "source_id_fields": ("lokalid", "identifikasjon"),
        # The two-read source probe proved that request-time kopidato is volatile.
        # Preserve all other provider fields, including kopidata, until evidence says otherwise.
        "volatile_fields": frozenset({"kopidato"}),
    },
}


class NormalizationError(RuntimeError):
    pass


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def run(command: list[str], *, timeout: int = 180) -> str:
    result = subprocess.run(
        command,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout,
        check=False,
    )
    if result.returncode != 0:
        raise NormalizationError(
            f"command failed ({result.returncode}): {' '.join(command)}\n{result.stdout[-12000:]}"
        )
    return result.stdout


def require_ogr() -> tuple[str, str]:
    ogrinfo = shutil.which("ogrinfo")
    ogr2ogr = shutil.which("ogr2ogr")
    if not ogrinfo or not ogr2ogr:
        raise NormalizationError("GDAL/OGR command line unavailable")
    return ogrinfo, ogr2ogr


def discover_polygon_layer(ogrinfo: str, source: Path, preferred_tokens: tuple[str, ...]) -> str:
    output = run([ogrinfo, "-ro", "-q", str(source)], timeout=120)
    rows: list[tuple[str, str]] = []
    for line in output.splitlines():
        match = re.match(r"^\s*\d+\s*:\s*(.*?)\s+\(([^()]*)\)\s*$", line)
        if match:
            rows.append((match.group(1).strip(), match.group(2).strip()))
    polygon_rows = [(name, geom) for name, geom in rows if "polygon" in geom.lower()]
    if not polygon_rows:
        raise NormalizationError(f"no polygon layer discovered in {source}; ogrinfo={output[-8000:]}")
    for token in preferred_tokens:
        matches = [(name, geom) for name, geom in polygon_rows if token in name.lower()]
        if len(matches) == 1:
            return matches[0][0]
    if len(polygon_rows) == 1:
        return polygon_rows[0][0]
    raise NormalizationError(f"ambiguous polygon layers in {source}: {polygon_rows!r}")


def convert_to_geojson(source: Path, destination: Path, config: dict[str, Any]) -> dict[str, Any]:
    ogrinfo, ogr2ogr = require_ogr()
    layer = discover_polygon_layer(ogrinfo, source, tuple(config["preferred_layer_tokens"]))
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        destination.unlink()
    min_e, min_n, max_e, max_n = BOUNDS_25832
    run(
        [
            ogr2ogr,
            "-f",
            "GeoJSON",
            str(destination),
            str(source),
            layer,
            "-spat",
            str(min_e),
            str(min_n),
            str(max_e),
            str(max_n),
            "-spat_srs",
            "EPSG:25832",
            "-t_srs",
            "EPSG:25832",
            "-dim",
            "XY",
        ]
    )
    if not destination.exists():
        raise NormalizationError(f"OGR did not create {destination}")
    return {
        "layer": layer,
        "geojson_bytes": destination.stat().st_size,
        "geojson_sha256": sha256_path(destination),
    }


def normalize_json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise NormalizationError(f"non-finite numeric source value: {value!r}")
        return 0.0 if value == 0.0 else value
    if isinstance(value, list):
        return [normalize_json_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): normalize_json_value(item) for key, item in value.items()}
    raise NormalizationError(f"unsupported JSON source value type: {type(value).__name__}")


def normalize_properties(properties: dict[str, Any], volatile_fields: frozenset[str]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in properties.items():
        normalized_key = str(key).strip().lower()
        if not normalized_key or normalized_key in {"boundedby", "msgeometry"}:
            continue
        if normalized_key in volatile_fields:
            continue
        if normalized_key in result:
            raise NormalizationError(f"case-normalized property collision: {key!r}")
        result[normalized_key] = normalize_json_value(value)
    return {key: result[key] for key in sorted(result)}


def source_id(feature: dict[str, Any], properties: dict[str, Any], candidates: tuple[str, ...]) -> tuple[str, str]:
    for key in candidates:
        value = properties.get(key)
        if value not in (None, "", "*"):
            return str(value), key
    feature_id = feature.get("id")
    if feature_id not in (None, ""):
        return str(feature_id), "geojson_feature_id"
    derived = canonical_sha256({"properties": properties, "geometry": feature.get("geometry")})
    return f"derived:{derived}", "derived_content_hash"


def normalize_feature_collection(path: Path, role: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    config = SOURCE_CONFIG[role]
    value = json.loads(path.read_text(encoding="utf-8"))
    features = value.get("features") if isinstance(value, dict) else None
    if not isinstance(features, list):
        raise NormalizationError(f"GeoJSON FeatureCollection missing features: {path}")

    normalized: list[dict[str, Any]] = []
    skipped_empty = 0
    skipped_nonpolygon = 0
    source_geometry_types: set[str] = set()
    property_names: set[str] = set()
    id_sources: set[str] = set()

    for feature in features:
        if not isinstance(feature, dict) or not isinstance(feature.get("geometry"), dict):
            continue
        geometry = shape(feature["geometry"])
        source_geometry_types.add(geometry.geom_type)
        if geometry.is_empty:
            skipped_empty += 1
            continue
        if not geometry.is_valid:
            raise NormalizationError(f"invalid {role} source geometry encountered")
        clipped = geometry.intersection(TILE_POLYGON)
        if clipped.is_empty or clipped.area <= 0.0:
            skipped_empty += 1
            continue
        if clipped.geom_type not in {"Polygon", "MultiPolygon"}:
            skipped_nonpolygon += 1
            continue
        if not clipped.is_valid:
            raise NormalizationError(f"invalid {role} clipped geometry encountered")
        clipped = normalize_geometry(clipped)
        geometry_json = normalize_json_value(json.loads(json.dumps(mapping(clipped), allow_nan=False)))
        raw_properties = feature.get("properties") or {}
        if not isinstance(raw_properties, dict):
            raise NormalizationError(f"non-object properties in {role}")
        properties = normalize_properties(raw_properties, config["volatile_fields"])
        property_names.update(properties)
        stable_id, id_source = source_id(feature, properties, tuple(config["source_id_fields"]))
        id_sources.add(id_source)
        geometry_sha = canonical_sha256(geometry_json)
        normalized.append(
            {
                "source_id": stable_id,
                "source_id_kind": id_source,
                "properties": properties,
                "geometry": geometry_json,
                "geometry_sha256": geometry_sha,
            }
        )

    normalized.sort(
        key=lambda item: (
            item["source_id"],
            item["geometry_sha256"],
            canonical_sha256(item["properties"]),
        )
    )
    return normalized, {
        "input_feature_count": len(features),
        "normalized_feature_count": len(normalized),
        "skipped_empty_or_outside": skipped_empty,
        "skipped_nonpolygon": skipped_nonpolygon,
        "source_geometry_types": sorted(source_geometry_types),
        "normalized_property_names": sorted(property_names),
        "source_id_kinds": sorted(id_sources),
    }


def layer_payload(role: str, source_path: Path, geojson_path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    config = SOURCE_CONFIG[role]
    conversion = convert_to_geojson(source_path, geojson_path, config)
    features, stats = normalize_feature_collection(geojson_path, role)
    semantic = {
        "role": "forest_structure" if role == "sr16v" else "coarse_area_classification",
        "source_key": role,
        "provider": config["provider"],
        "dataset": config["dataset"],
        "metadata_uuid": config["metadata_uuid"],
        "license": config["license"],
        "attribution": config["attribution"],
        "horizontal_crs": "EPSG:25832",
        "transform": {
            "operation": "gdal-ogr-decode-reproject-xy-exact-tile-clip-shapely-normalize-v0.1-candidate",
            "bounds_epsg25832": list(BOUNDS_25832),
            "ar50_excluded_volatile_fields": sorted(config["volatile_fields"]),
        },
        "features": features,
    }
    full = {
        **semantic,
        "source_raw": {
            "sha256": sha256_path(source_path),
            "byte_size": source_path.stat().st_size,
        },
    }
    return full, {"conversion": conversion, "stats": stats, "semantic_sha256": canonical_sha256(semantic)}


def resolve_inputs(cache_root: Path, manifest: dict[str, Any], ar50_index: int) -> tuple[Path, Path]:
    sr16_rel = manifest["sources"]["sr16v"]["cache"]["gml_relative_path"]
    acquisitions = manifest["sources"]["ar50"]["acquisitions"]
    if ar50_index < 0 or ar50_index >= len(acquisitions):
        raise NormalizationError(f"AR50 acquisition index out of range: {ar50_index}")
    ar50_rel = acquisitions[ar50_index]["cache_relative_path"]
    sr16 = (cache_root / sr16_rel).resolve()
    ar50 = (cache_root / ar50_rel).resolve()
    if not sr16.is_file() or not ar50.is_file():
        raise NormalizationError(f"cached source input missing: sr16={sr16}, ar50={ar50}")
    return sr16, ar50


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-root", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--ar50-index", type=int, default=0)
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--evidence", required=True)
    args = parser.parse_args()

    cache_root = Path(args.cache_root).resolve()
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    if manifest.get("status") != "PASS":
        raise NormalizationError("source materialization manifest is not PASS")
    sr16_source, ar50_source = resolve_inputs(cache_root, manifest, args.ar50_index)

    work_dir = Path(args.work_dir).resolve()
    if work_dir.exists():
        shutil.rmtree(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    sr16_layer, sr16_evidence = layer_payload("sr16v", sr16_source, work_dir / "sr16v.geojson")
    ar50_layer, ar50_evidence = layer_payload("ar50", ar50_source, work_dir / "ar50.geojson")

    semantic_payload = {
        "schema": "nwe.vegetation-source-normalized-sample/0.1-candidate",
        "tile_id": TILE_ID,
        "horizontal_crs": "EPSG:25832",
        "truth_boundary": "source polygons/attributes only; no individual-tree positions or renderer assets",
        "layers": [
            {key: value for key, value in sr16_layer.items() if key != "source_raw"},
            {key: value for key, value in ar50_layer.items() if key != "source_raw"},
        ],
    }
    full_payload = {
        **semantic_payload,
        "source_raw_bindings": {
            "sr16v": sr16_layer["source_raw"],
            "ar50": ar50_layer["source_raw"],
        },
    }
    output_bytes = canonical_bytes(full_payload)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(output_bytes)

    evidence = {
        "schema": "nwe.vegetation-source-normalization-evidence/0.1",
        "status": "PASS",
        "source_network_required": False,
        "candidate_not_promoted": True,
        "ar50_acquisition_index": args.ar50_index,
        "normalized_byte_size": len(output_bytes),
        "normalized_sha256": hashlib.sha256(output_bytes).hexdigest(),
        "semantic_sha256": canonical_sha256(semantic_payload),
        "layers": {
            "sr16v": sr16_evidence,
            "ar50": ar50_evidence,
        },
    }
    Path(args.evidence).write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(evidence, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
