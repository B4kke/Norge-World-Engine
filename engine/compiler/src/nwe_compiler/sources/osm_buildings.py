from __future__ import annotations

import re
from dataclasses import dataclass
from math import isfinite

from pyproj import Transformer
from shapely.geometry import MultiPolygon, Polygon, box as shapely_box

TARGET_BOUNDS = (611000.0, 6677000.0, 612000.0, 6678000.0)


class OsmBuildingContractError(RuntimeError):
    pass


@dataclass(frozen=True)
class BuildingFeature:
    source_id: str
    polygon: tuple[tuple[float, float], ...]
    tags: dict[str, str]
    area_m2: float
    height_m: float | None
    height_source: str
    clipped: bool


def _height(tags: dict[str, str]) -> tuple[float | None, str]:
    value = tags.get("height")
    if value:
        match = re.fullmatch(r"\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m|meter|meters)?\s*", value, flags=re.IGNORECASE)
        if match:
            height = float(match.group(1))
            if 0.5 <= height <= 300:
                return height, "osm:height"
    levels = tags.get("building:levels")
    if levels:
        try:
            count = float(levels)
        except ValueError:
            count = float("nan")
        if isfinite(count) and 0 < count <= 100:
            return count * 3.0, "osm:building:levels*3m"
    return None, "unresolved"


def _candidate_ways(payload: dict) -> list[tuple[str, dict[str, str], list[tuple[float, float]]]]:
    elements = payload.get("elements") if isinstance(payload, dict) else None
    if not isinstance(elements, list):
        raise OsmBuildingContractError("OSM payload lacks elements")

    nodes: dict[int, tuple[float, float]] = {}
    for element in elements:
        if not isinstance(element, dict) or element.get("type") != "node" or element.get("id") is None:
            continue
        try:
            nodes[int(element["id"])] = (float(element["lon"]), float(element["lat"]))
        except (KeyError, TypeError, ValueError):
            continue

    output = []
    for element in elements:
        if not isinstance(element, dict):
            continue
        tags = element.get("tags") or {}
        if element.get("type") != "way" or not tags.get("building"):
            continue
        normalized_tags = {str(key): str(value) for key, value in tags.items()}

        coords: list[tuple[float, float]] = []
        refs = element.get("nodes")
        if nodes and isinstance(refs, list):
            for ref in refs:
                try:
                    coordinate = nodes.get(int(ref))
                except (TypeError, ValueError):
                    coordinate = None
                if coordinate is None:
                    coords = []
                    break
                coords.append(coordinate)
        elif isinstance(element.get("geometry"), list):
            for point in element["geometry"]:
                try:
                    coords.append((float(point["lon"]), float(point["lat"])))
                except (KeyError, TypeError, ValueError):
                    coords = []
                    break
        if len(coords) >= 3:
            output.append((f"osm:way:{element.get('id')}", normalized_tags, coords))
    return output


def normalize_osm_buildings(
    payload: dict,
    *,
    bounds: tuple[float, float, float, float] = TARGET_BOUNDS,
) -> list[BuildingFeature]:
    """Normalize OSM Main API or Overpass building ways to validated EPSG:25832 polygons."""
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:25832", always_xy=True)
    tile = shapely_box(*bounds)
    output: list[BuildingFeature] = []

    for source_id, tags, lonlat in _candidate_ways(payload):
        projected = [transformer.transform(lon, lat) for lon, lat in lonlat]
        if projected[0] != projected[-1]:
            projected.append(projected[0])
        polygon = Polygon(projected)
        if polygon.is_empty or not polygon.is_valid:
            continue
        if polygon.area < 4.0 or polygon.area > 100000.0:
            continue
        if not polygon.intersects(tile):
            continue

        clipped_geometry = polygon.intersection(tile)
        if isinstance(clipped_geometry, Polygon):
            parts = [clipped_geometry]
        elif isinstance(clipped_geometry, MultiPolygon):
            parts = [part for part in clipped_geometry.geoms if part.area >= 4.0]
        else:
            continue

        height_m, height_source = _height(tags)
        clipped = not polygon.equals(clipped_geometry)
        for index, part in enumerate(parts):
            if part.is_empty or not part.is_valid or part.area < 4.0:
                continue
            coords = tuple((float(x), float(y)) for x, y in part.exterior.coords)
            output.append(
                BuildingFeature(
                    source_id=source_id if len(parts) == 1 else f"{source_id}:part{index}",
                    polygon=coords,
                    tags=tags,
                    area_m2=float(part.area),
                    height_m=height_m,
                    height_source=height_source,
                    clipped=clipped,
                )
            )

    return sorted(output, key=lambda item: item.source_id)
