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
from shapely.geometry import LineString, MultiLineString, Point, MultiPoint, box as shapely_box

from nwe_compiler.acquisition import TILE_BOUNDS, transformed_envelope

BASE = "https://nvdbapiles.atlas.vegvesen.no/vegobjekter/api/v4/vegobjekter"
SOURCE_CRS = "EPSG:25833"
TARGET_CRS = "EPSG:25832"
SOURCE_SRID = 5973
TILE_ID = "epsg25832_611000_6677000_1000m"
SCHEMA = "nwe.nvdb-street-detail-artifact/0.1-candidate"
ALGORITHM = "nvdb-v4-explicit-geometry-street-detail-v0.1"
X_CLIENT = "NorgeWorldEngine-Compiler"
USER_AGENT = "NorgeWorldEngine/0.1 street-detail-compiler"

TYPE_NAMES = {
    99: "Vegoppmerking, langsgående",
    519: "Vegoppmerking, tverrgående",
    174: "Gangfelt",
    95: "Skiltpunkt",
    87: "Belysningspunkt",
    181: "Lysmast",
    20: "Kantstolper/Refleks",
    5: "Rekkverk",
    80: "Grøft, åpen",
    9: "Kantstein",
    48: "Fortau",
    953: "Sykkelfelt",
}


def _fmt(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".")


def query_bounds() -> tuple[float, float, float, float]:
    envelope = transformed_envelope(TILE_BOUNDS, TARGET_CRS, SOURCE_CRS)
    return envelope[0] - 2.0, envelope[1] - 2.0, envelope[2] + 2.0, envelope[3] + 2.0


def request_url(type_id: int) -> str:
    bbox = ",".join(_fmt(value) for value in query_bounds())
    query = urlencode({
        "kartutsnitt": bbox,
        "srid": str(SOURCE_SRID),
        "antall": "1000",
        "inkluderAntall": "false",
        "inkluder": "metadata,egenskaper,lokasjon,geometri",
    }, safe=",")
    return f"{BASE}/{type_id}?{query}"


def fetch_bytes(url: str) -> bytes:
    request = Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT, "X-Client": X_CLIENT})
    with urlopen(request, timeout=90) as response:
        if response.status != 200:
            raise RuntimeError(f"NVDB HTTP {response.status}: {url}")
        return response.read()


def parse_payload(raw: bytes) -> dict[str, Any]:
    value = json.loads(raw.decode("utf-8"))
    if not isinstance(value, dict) or not isinstance(value.get("objekter"), list):
        raise RuntimeError("NVDB response lacks objekter")
    return value


def property_map(obj: dict[str, Any]) -> dict[str, Any]:
    value = obj.get("egenskaper")
    out: dict[str, Any] = {}
    if isinstance(value, list):
        for item in value:
            if not isinstance(item, dict) or not isinstance(item.get("navn"), str):
                continue
            raw = item.get("verdi")
            if raw is None or isinstance(raw, (str, int, float, bool)):
                out[item["navn"]] = raw
    elif isinstance(value, dict):
        for key, item in value.items():
            raw = item.get("verdi") if isinstance(item, dict) and "verdi" in item else item
            if raw is None or isinstance(raw, (str, int, float, bool)):
                out[str(key)] = raw
    return dict(sorted(out.items(), key=lambda item: item[0].casefold()))


def _transform_point(coord: tuple[float, ...], transformer: Transformer) -> list[float]:
    east, north = transformer.transform(float(coord[0]), float(coord[1]))
    return [round(float(east), 6), round(float(north), 6)]


def geometry_features(obj: dict[str, Any], transformer: Transformer) -> list[dict[str, Any]]:
    geometry_data = obj.get("geometri") or {}
    text = geometry_data.get("wkt") if isinstance(geometry_data, dict) else None
    if not isinstance(text, str) or not text:
        return []
    source = wkt.loads(text)
    tile = shapely_box(*TILE_BOUNDS)

    if isinstance(source, (Point, MultiPoint)):
        points = [source] if isinstance(source, Point) else list(source.geoms)
        output = []
        for point in points:
            transformed = _transform_point(tuple(point.coords[0]), transformer)
            if tile.covers(Point(transformed[0], transformed[1])):
                output.append({"geometry_type": "point", "point": transformed})
        return output

    if not isinstance(source, (LineString, MultiLineString)):
        return []
    lines = [source] if isinstance(source, LineString) else list(source.geoms)
    output: list[dict[str, Any]] = []
    for line in lines:
        transformed_points = [_transform_point(tuple(coord), transformer) for coord in line.coords]
        transformed_line = LineString(transformed_points)
        clipped = transformed_line.intersection(tile)
        pieces = [clipped] if isinstance(clipped, LineString) else list(clipped.geoms) if isinstance(clipped, MultiLineString) else []
        for piece in pieces:
            points = [[round(float(x), 6), round(float(y), 6)] for x, y in piece.coords]
            if len(points) >= 2:
                output.append({"geometry_type": "line", "points": points})
    return output


def compile_artifact() -> tuple[dict[str, Any], dict[str, Any]]:
    transformer = Transformer.from_crs(SOURCE_CRS, TARGET_CRS, always_xy=True)
    features: list[dict[str, Any]] = []
    source_snapshots: list[dict[str, Any]] = []
    counts: dict[str, int] = {}
    geometry_counts: dict[str, int] = {"point": 0, "line": 0}

    for type_id, type_name in TYPE_NAMES.items():
        url = request_url(type_id)
        raw = fetch_bytes(url)
        payload = parse_payload(raw)
        objects = [item for item in payload["objekter"] if isinstance(item, dict)]
        emitted = 0
        for obj in objects:
            parts = geometry_features(obj, transformer)
            if not parts:
                continue
            source_id = obj.get("id")
            properties = property_map(obj)
            for part_index, part in enumerate(parts):
                feature = {
                    "source_type_id": type_id,
                    "source_type_name": type_name,
                    "source_object_id": source_id,
                    "part_index": part_index,
                    "properties": properties,
                    **part,
                }
                features.append(feature)
                geometry_counts[part["geometry_type"]] += 1
                emitted += 1
        counts[str(type_id)] = emitted
        source_snapshots.append({
            "type_id": type_id,
            "type_name": type_name,
            "request_url": url,
            "raw_sha256": hashlib.sha256(raw).hexdigest(),
            "raw_byte_size": len(raw),
            "object_count": len(objects),
            "emitted_geometry_part_count": emitted,
            "license_profile": "NLOD-1.0",
        })

    features.sort(key=lambda item: (item["source_type_id"], str(item["source_object_id"]), item["part_index"]))
    source_snapshots.sort(key=lambda item: item["type_id"])
    artifact = {
        "schema": SCHEMA,
        "tile_id": TILE_ID,
        "horizontal_crs": TARGET_CRS,
        "vertical_datum": "NN2000",
        "compiler_algorithm": ALGORITHM,
        "source_snapshots": source_snapshots,
        "features": features,
        "stats": {
            "feature_part_count": len(features),
            "feature_parts_by_type_id": counts,
            "geometry_type_counts": geometry_counts,
        },
        "policy": {
            "geometry": "only explicit NVDB object geometry is reprojected EPSG:25833->25832 and clipped to the exact Nannestad tile",
            "vertical": "point/line Z is intentionally not promoted; renderer grounds presentation against accepted NWE DTM",
            "appearance": "object appearance may be renderer-authored but source position/type/properties remain separately identifiable",
            "truth_guard": "absence of an object is not proof of physical absence; no procedural object is represented as NVDB source truth",
        },
        "attribution": "Inneholder data under norsk lisens for offentlige data (NLOD) tilgjengeliggjort av Statens vegvesen.",
    }
    encoded = (json.dumps(artifact, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    verification = {
        "schema": "nwe.nvdb-street-detail-verification/0.1",
        "status": "PASS" if features else "NO_FEATURES",
        "artifact_sha256": hashlib.sha256(encoded).hexdigest(),
        "artifact_byte_size": len(encoded),
        "feature_part_count": len(features),
        "feature_parts_by_type_id": counts,
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
    print(json.dumps(verification, indent=2, sort_keys=True, ensure_ascii=False))
    return 0 if verification["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
