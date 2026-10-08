#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from nwe_compiler.acquisition import TILE_BOUNDS, transformed_envelope

BASE = "https://nvdbapiles.atlas.vegvesen.no/vegobjekter/api/v4/vegobjekter"
X_CLIENT = "NorgeWorldEngine-Compiler"
USER_AGENT = "NorgeWorldEngine/0.1 road-semantics-probe"
SOURCE_CRS = "EPSG:25833"
SOURCE_SRID = 5973
TYPE_WIDTH_PRIMARY = 838
TYPE_WIDTH_FALLBACK = 583
TYPE_SURFACE = 241


def _fmt(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".")


def query_bounds() -> tuple[float, float, float, float]:
    envelope = transformed_envelope(TILE_BOUNDS, "EPSG:25832", SOURCE_CRS)
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


def fetch_json(url: str) -> dict[str, Any]:
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
            "X-Client": X_CLIENT,
        },
    )
    with urlopen(request, timeout=90) as response:
        if response.status != 200:
            raise RuntimeError(f"NVDB HTTP {response.status}: {url}")
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("objekter"), list):
        raise RuntimeError(f"NVDB type response lacks objekter array: {url}")
    return payload


def _property_map(obj: dict[str, Any]) -> dict[str, Any]:
    properties = obj.get("egenskaper")
    output: dict[str, Any] = {}
    if isinstance(properties, list):
        for item in properties:
            if not isinstance(item, dict):
                continue
            name = item.get("navn")
            if isinstance(name, str) and name:
                output[name] = item.get("verdi")
    elif isinstance(properties, dict):
        for key, value in properties.items():
            if isinstance(value, dict) and "verdi" in value:
                output[str(key)] = value.get("verdi")
            else:
                output[str(key)] = value
    return output


def _case_property(properties: dict[str, Any], names: tuple[str, ...]) -> tuple[str | None, Any]:
    wanted = {name.casefold() for name in names}
    for key, value in properties.items():
        if key.casefold() in wanted:
            return key, value
    return None, None


def _stedfestinger(obj: dict[str, Any]) -> list[dict[str, Any]]:
    value = (obj.get("lokasjon") or {}).get("stedfestinger")
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def summarize_type(type_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    objects = [item for item in payload.get("objekter", []) if isinstance(item, dict)]
    property_names: set[str] = set()
    location_keys: set[str] = set()
    geometry_count = 0
    line_location_count = 0
    sequence_ids: set[int] = set()
    width_values: list[float] = []
    surface_values: dict[str, int] = {}
    samples: list[dict[str, Any]] = []

    for obj in objects:
        properties = _property_map(obj)
        property_names.update(properties)
        geometry = obj.get("geometri")
        if isinstance(geometry, dict) and isinstance(geometry.get("wkt"), str) and geometry["wkt"]:
            geometry_count += 1
        locations = _stedfestinger(obj)
        for location in locations:
            location_keys.update(str(key) for key in location)
            sequence_id = location.get("veglenkesekvensid")
            if isinstance(sequence_id, int):
                sequence_ids.add(sequence_id)
            if str(location.get("type") or "").casefold() in {"strekning", "linje"}:
                line_location_count += 1

        if type_id in {TYPE_WIDTH_PRIMARY, TYPE_WIDTH_FALLBACK}:
            width_name, raw_width = _case_property(properties, ("Dekkebredde", "dekkebredde"))
            try:
                width = float(raw_width)
            except (TypeError, ValueError):
                width = None
            if width is not None and 0.5 <= width <= 40:
                width_values.append(width)
        else:
            for key, value in properties.items():
                lowered = key.casefold()
                if any(token in lowered for token in ("dekk", "material", "type")) and value not in (None, ""):
                    surface_values[str(value)] = surface_values.get(str(value), 0) + 1

        if len(samples) < 3:
            samples.append(
                {
                    "id": obj.get("id"),
                    "metadata_type": (obj.get("metadata") or {}).get("type"),
                    "properties": properties,
                    "stedfestinger": locations[:3],
                    "geometri_srid": geometry.get("srid") if isinstance(geometry, dict) else None,
                    "geometri_type": (
                        str(geometry.get("wkt") or "").split("(", 1)[0].strip()
                        if isinstance(geometry, dict)
                        else None
                    ),
                }
            )

    return {
        "type_id": type_id,
        "request_url": request_url(type_id),
        "object_count": len(objects),
        "geometry_count": geometry_count,
        "line_location_count": line_location_count,
        "unique_sequence_id_count": len(sequence_ids),
        "property_names": sorted(property_names, key=str.casefold),
        "location_keys": sorted(location_keys, key=str.casefold),
        "valid_dekkebredde_count": len(width_values),
        "dekkebredde_range_m": [min(width_values), max(width_values)] if width_values else None,
        "surface_candidate_values": dict(sorted(surface_values.items(), key=lambda item: (-item[1], item[0]))) if surface_values else {},
        "samples": samples,
    }


def probe() -> dict[str, Any]:
    types: dict[str, Any] = {}
    for type_id, label in (
        (TYPE_WIDTH_PRIMARY, "width_primary_838"),
        (TYPE_WIDTH_FALLBACK, "width_fallback_583"),
        (TYPE_SURFACE, "surface_241"),
    ):
        types[label] = summarize_type(type_id, fetch_json(request_url(type_id)))

    primary = types["width_primary_838"]
    fallback = types["width_fallback_583"]
    surface = types["surface_241"]
    width_available = primary["valid_dekkebredde_count"] > 0 or fallback["valid_dekkebredde_count"] > 0
    return {
        "schema": "nwe.nvdb-road-semantics-live-probe/0.1",
        "status": "PASS" if width_available else "NO_WIDTH_COVERAGE",
        "tile_id": "epsg25832_611000_6677000_1000m",
        "source_crs": SOURCE_CRS,
        "source_srid": SOURCE_SRID,
        "query_bounds": list(query_bounds()),
        "types": types,
        "policy": {
            "width_primary_type_id": TYPE_WIDTH_PRIMARY,
            "width_fallback_type_id": TYPE_WIDTH_FALLBACK,
            "surface_type_id": TYPE_SURFACE,
            "width_field": "Dekkebredde",
            "priority": "838 where present; 583 only where 838 absent",
            "truth_guard": "no width is emitted without a concrete NVDB object and compatible line location/geometry",
        },
        "coverage": {
            "source_width_available": width_available,
            "primary_width_objects": primary["valid_dekkebredde_count"],
            "fallback_width_objects": fallback["valid_dekkebredde_count"],
            "surface_objects": surface["object_count"],
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = probe()
    encoded = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    if result["status"] == "NO_WIDTH_COVERAGE":
        raise SystemExit(2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
