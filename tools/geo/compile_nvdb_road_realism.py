#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from pyproj import Transformer
from shapely import wkt
from shapely.geometry import LineString, MultiLineString, box as shapely_box

from nwe_compiler.acquisition import TILE_BOUNDS, transformed_envelope

BASE = "https://nvdbapiles.atlas.vegvesen.no/vegobjekter/api/v4/vegobjekter"
X_CLIENT = "NorgeWorldEngine-Compiler"
USER_AGENT = "NorgeWorldEngine/0.1 road-realism-compiler"
SOURCE_CRS = "EPSG:25833"
TARGET_CRS = "EPSG:25832"
SOURCE_SRID = 5973
TILE_ID = "epsg25832_611000_6677000_1000m"
TYPE_WIDTH_PRIMARY = 838
TYPE_WIDTH_FALLBACK = 583
TYPE_SURFACE = 241
SCHEMA = "nwe.road-realism-artifact/0.1-candidate"
ALGORITHM = "nvdb-838-primary-583-nonoverlap-fallback-241-surface-v0.1"


def _fmt(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".")


def query_bounds() -> tuple[float, float, float, float]:
    envelope = transformed_envelope(TILE_BOUNDS, TARGET_CRS, SOURCE_CRS)
    return envelope[0] - 2.0, envelope[1] - 2.0, envelope[2] + 2.0, envelope[3] + 2.0


def request_url(type_id: int) -> str:
    bbox = ",".join(_fmt(value) for value in query_bounds())
    query = urlencode(
        {
            "kartutsnitt": bbox,
            "srid": str(SOURCE_SRID),
            "antall": "1000",
            "inkluderAntall": "false",
            "inkluder": "metadata,egenskaper,lokasjon,geometri",
        },
        safe=",",
    )
    return f"{BASE}/{type_id}?{query}"


def fetch_bytes(url: str) -> bytes:
    request = Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT, "X-Client": X_CLIENT})
    with urlopen(request, timeout=90) as response:
        if response.status != 200:
            raise RuntimeError(f"NVDB HTTP {response.status}: {url}")
        return response.read()


def parse_payload(data: bytes) -> dict[str, Any]:
    value = json.loads(data.decode("utf-8"))
    if not isinstance(value, dict) or not isinstance(value.get("objekter"), list):
        raise RuntimeError("NVDB response lacks objekter")
    return value


def property_map(obj: dict[str, Any]) -> dict[str, Any]:
    value = obj.get("egenskaper")
    out: dict[str, Any] = {}
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict) and isinstance(item.get("navn"), str):
                out[item["navn"]] = item.get("verdi")
    elif isinstance(value, dict):
        for key, item in value.items():
            out[str(key)] = item.get("verdi") if isinstance(item, dict) and "verdi" in item else item
    return out


def finite_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and abs(number) < 1e9 else None


def line_locations(obj: dict[str, Any]) -> list[dict[str, Any]]:
    raw = (obj.get("lokasjon") or {}).get("stedfestinger")
    out: list[dict[str, Any]] = []
    if not isinstance(raw, list):
        return out
    for item in raw:
        if not isinstance(item, dict):
            continue
        sequence = item.get("veglenkesekvensid")
        start = finite_float(item.get("startposisjon"))
        end = finite_float(item.get("sluttposisjon"))
        if not isinstance(sequence, int) or start is None or end is None:
            continue
        lo, hi = sorted((start, end))
        out.append({
            "sequence_id": sequence,
            "start_position": lo,
            "end_position": hi,
            "direction": item.get("retning"),
            "lanes": list(item.get("kjørefelt") or []),
        })
    return sorted(out, key=lambda item: (item["sequence_id"], item["start_position"], item["end_position"]))


def locations_overlap(left: dict[str, Any], right: dict[str, Any], tolerance: float = 1e-9) -> bool:
    if left["sequence_id"] != right["sequence_id"]:
        return False
    return min(left["end_position"], right["end_position"]) - max(left["start_position"], right["start_position"]) > tolerance


def geometry_lines(obj: dict[str, Any], transformer: Transformer) -> list[list[list[float]]]:
    geometry_data = obj.get("geometri") or {}
    text = geometry_data.get("wkt") if isinstance(geometry_data, dict) else None
    if not isinstance(text, str) or not text:
        return []
    geometry = wkt.loads(text)
    if isinstance(geometry, LineString):
        lines = [geometry]
    elif isinstance(geometry, MultiLineString):
        lines = list(geometry.geoms)
    else:
        return []

    tile = shapely_box(*TILE_BOUNDS)
    output: list[list[list[float]]] = []
    for line in lines:
        transformed = []
        for coord in line.coords:
            east, north = transformer.transform(float(coord[0]), float(coord[1]))
            z = finite_float(coord[2]) if len(coord) >= 3 else None
            transformed.append((east, north, z))
        source2d = LineString([(p[0], p[1]) for p in transformed])
        clipped = source2d.intersection(tile)
        if clipped.is_empty:
            continue
        clipped_lines = [clipped] if isinstance(clipped, LineString) else list(clipped.geoms) if isinstance(clipped, MultiLineString) else []
        for piece in clipped_lines:
            if len(piece.coords) < 2:
                continue
            points: list[list[float]] = []
            for x, y in piece.coords:
                distance = source2d.project(source2d.interpolate(source2d.project(LineString([(x, y), (x, y)]).centroid))) if False else None
                # Runtime roads are draped to accepted DTM; preserve only horizontal source geometry here.
                points.append([round(float(x), 6), round(float(y), 6), None])
            if len(points) >= 2:
                output.append(points)
    return output


def object_width_feature(obj: dict[str, Any], *, type_id: int, priority: str, transformer: Transformer) -> list[dict[str, Any]]:
    properties = property_map(obj)
    width = finite_float(properties.get("Dekkebredde"))
    if width is None or not 0.8 <= width <= 30:
        return []
    locations = line_locations(obj)
    if not locations:
        return []
    lines = geometry_lines(obj, transformer)
    source_id = int(obj.get("id")) if isinstance(obj.get("id"), int) else str(obj.get("id"))
    common = {
        "source_object_id": source_id,
        "source_type_id": type_id,
        "source_type_name": "Vegbredde, beregnet" if type_id == TYPE_WIDTH_PRIMARY else "Vegbredde, historisk",
        "priority": priority,
        "width_m": round(width, 3),
        "drivable_width_m": finite_float(properties.get("Kjørebanebredde")),
        "total_width_m": finite_float(properties.get("Vegbredde") if type_id == TYPE_WIDTH_PRIMARY else properties.get("Vegbredde, totalt")),
        "locations": locations,
    }
    return [{**common, "part_index": index, "points": points} for index, points in enumerate(lines)]


def surface_features(obj: dict[str, Any], *, transformer: Transformer) -> list[dict[str, Any]]:
    properties = property_map(obj)
    locations = line_locations(obj)
    if not locations:
        return []
    mass_type = properties.get("Massetype")
    average_width = finite_float(properties.get("Dekkebredde, gjennomsnitt"))
    source_id = int(obj.get("id")) if isinstance(obj.get("id"), int) else str(obj.get("id"))
    return [
        {
            "source_object_id": source_id,
            "source_type_id": TYPE_SURFACE,
            "source_type_name": "Vegdekke",
            "part_index": index,
            "surface_material": str(mass_type) if mass_type not in (None, "") else None,
            "average_surface_width_m": round(average_width, 3) if average_width is not None else None,
            "laying_date": properties.get("Dekkeleggingsdato"),
            "locations": locations,
            "points": points,
        }
        for index, points in enumerate(geometry_lines(obj, transformer))
    ]


def compile_artifact() -> tuple[dict[str, Any], dict[str, Any]]:
    transformer = Transformer.from_crs(SOURCE_CRS, TARGET_CRS, always_xy=True)
    raw: dict[int, bytes] = {}
    payloads: dict[int, dict[str, Any]] = {}
    for type_id in (TYPE_WIDTH_PRIMARY, TYPE_WIDTH_FALLBACK, TYPE_SURFACE):
        raw[type_id] = fetch_bytes(request_url(type_id))
        payloads[type_id] = parse_payload(raw[type_id])

    primary_objects = [obj for obj in payloads[TYPE_WIDTH_PRIMARY]["objekter"] if isinstance(obj, dict)]
    fallback_objects = [obj for obj in payloads[TYPE_WIDTH_FALLBACK]["objekter"] if isinstance(obj, dict)]
    surface_objects = [obj for obj in payloads[TYPE_SURFACE]["objekter"] if isinstance(obj, dict)]
    primary_locations = [location for obj in primary_objects for location in line_locations(obj)]

    width_features: list[dict[str, Any]] = []
    for obj in primary_objects:
        width_features.extend(object_width_feature(obj, type_id=TYPE_WIDTH_PRIMARY, priority="primary-838", transformer=transformer))

    fallback_skipped_overlap = 0
    fallback_emitted_objects = 0
    for obj in fallback_objects:
        locations = line_locations(obj)
        if not locations:
            continue
        if any(locations_overlap(location, primary) for location in locations for primary in primary_locations):
            fallback_skipped_overlap += 1
            continue
        features = object_width_feature(obj, type_id=TYPE_WIDTH_FALLBACK, priority="fallback-583", transformer=transformer)
        if features:
            fallback_emitted_objects += 1
            width_features.extend(features)

    surfaces = [feature for obj in surface_objects for feature in surface_features(obj, transformer=transformer)]
    width_features.sort(key=lambda item: (0 if item["source_type_id"] == TYPE_WIDTH_PRIMARY else 1, str(item["source_object_id"]), item["part_index"]))
    surfaces.sort(key=lambda item: (str(item["source_object_id"]), item["part_index"]))

    source_snapshots = [
        {
            "type_id": type_id,
            "request_url": request_url(type_id),
            "raw_sha256": hashlib.sha256(raw[type_id]).hexdigest(),
            "raw_byte_size": len(raw[type_id]),
            "object_count": len(payloads[type_id]["objekter"]),
            "license_profile": "NLOD-1.0",
        }
        for type_id in (TYPE_WIDTH_PRIMARY, TYPE_WIDTH_FALLBACK, TYPE_SURFACE)
    ]
    widths = [feature["width_m"] for feature in width_features]
    surface_counts: dict[str, int] = {}
    for feature in surfaces:
        key = feature.get("surface_material") or "unresolved"
        surface_counts[key] = surface_counts.get(key, 0) + 1

    artifact = {
        "schema": SCHEMA,
        "tile_id": TILE_ID,
        "horizontal_crs": TARGET_CRS,
        "vertical_datum": "NN2000",
        "compiler_algorithm": ALGORITHM,
        "source_snapshots": source_snapshots,
        "width_features": width_features,
        "surface_features": surfaces,
        "stats": {
            "primary_838_object_count": len(primary_objects),
            "historical_583_object_count": len(fallback_objects),
            "fallback_583_emitted_object_count": fallback_emitted_objects,
            "fallback_583_skipped_overlap_count": fallback_skipped_overlap,
            "width_feature_part_count": len(width_features),
            "width_range_m": [min(widths), max(widths)] if widths else None,
            "surface_object_count": len(surface_objects),
            "surface_feature_part_count": len(surfaces),
            "surface_material_counts": dict(sorted(surface_counts.items())),
        },
        "policy": {
            "width_priority": "NVDB 838 Dekkebredde first; 583 only when no 838 location overlap exists on the same veglenkesekvens",
            "runtime_geometry": "source object line geometry reprojected EPSG:25833->25832 and clipped to exact tile; vertical presentation is re-draped to accepted NWE DTM",
            "uncovered_roads": "retain explicit renderer fallback from accepted road-network artifact",
            "surface_semantics": "NVDB 241 Massetype and Dekkebredde, gjennomsnitt are source-backed where present",
            "truth_guard": "no inferred width or surface type is promoted as source truth",
        },
        "attribution": "Inneholder data under norsk lisens for offentlige data (NLOD) tilgjengeliggjort av Statens vegvesen.",
    }
    encoded = (json.dumps(artifact, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    verification = {
        "schema": "nwe.road-realism-verification/0.1",
        "status": "PASS" if width_features else "FAIL",
        "artifact_sha256": hashlib.sha256(encoded).hexdigest(),
        "artifact_byte_size": len(encoded),
        "width_feature_part_count": len(width_features),
        "surface_feature_part_count": len(surfaces),
        "source_raw_sha256": {str(item["type_id"]): item["raw_sha256"] for item in source_snapshots},
    }
    return artifact, verification


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--verification", type=Path, required=True)
    args = parser.parse_args()
    artifact, verification = compile_artifact()
    encoded = (json.dumps(artifact, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(encoded)
    args.verification.write_text(json.dumps(verification, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(verification, indent=2, sort_keys=True))
    if verification["status"] != "PASS":
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
