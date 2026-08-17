from __future__ import annotations

from math import isfinite
from typing import Any

from pyproj import Transformer
from shapely import wkt
from shapely.geometry import LineString, MultiLineString, box as shapely_box

from nwe_compiler.roads import RoadPoint, RoadSegment

SOURCE_HORIZONTAL_CRS = "EPSG:25833"
SOURCE_COMPOUND_SRID = 5973
SOURCE_VERTICAL_DATUM = "NN2000"
TARGET_HORIZONTAL_CRS = "EPSG:25832"
TARGET_BOUNDS = (611000.0, 6677000.0, 612000.0, 6678000.0)


class NvdbContractError(RuntimeError):
    pass


def normalize_z(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not isfinite(number) or number <= -10000 or number >= 10000:
        return None
    return number


def _features(payload: Any) -> list[dict]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in ("objekter", "veglenkesekvenser", "features"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
    raise NvdbContractError("unsupported NVDB response shape")


def _coordinate_lines(geometry) -> list[tuple[RoadPoint, ...]]:
    if isinstance(geometry, LineString):
        geometries = [geometry]
    elif isinstance(geometry, MultiLineString):
        geometries = list(geometry.geoms)
    else:
        raise NvdbContractError(f"expected line geometry, got {geometry.geom_type}")
    output = []
    for line in geometries:
        points: list[RoadPoint] = []
        for coordinate in line.coords:
            z = coordinate[2] if len(coordinate) >= 3 else None
            points.append((float(coordinate[0]), float(coordinate[1]), normalize_z(z)))
        if len(points) >= 2:
            output.append(tuple(points))
    return output


def _interpolated_z(points: tuple[RoadPoint, ...], x: float, y: float, tolerance: float = 1e-7) -> float | None:
    """Recover NN2000 Z for a clipped 2D point without trusting GEOS Z semantics."""
    best_distance = float("inf")
    best_z: float | None = None
    for a, b in zip(points, points[1:]):
        ax, ay, az = a
        bx, by, bz = b
        dx, dy = bx - ax, by - ay
        length2 = dx * dx + dy * dy
        if length2 <= tolerance * tolerance:
            continue
        t = ((x - ax) * dx + (y - ay) * dy) / length2
        t_clamped = min(1.0, max(0.0, t))
        px, py = ax + dx * t_clamped, ay + dy * t_clamped
        distance = ((x - px) ** 2 + (y - py) ** 2) ** 0.5
        if distance >= best_distance:
            continue
        best_distance = distance
        if t_clamped <= tolerance:
            best_z = az
        elif t_clamped >= 1.0 - tolerance:
            best_z = bz
        elif az is not None and bz is not None:
            best_z = az + (bz - az) * t_clamped
        else:
            best_z = None
    if best_distance > 0.01:
        raise NvdbContractError(f"clipped coordinate is {best_distance:.6f} m from source line")
    return best_z


def clip_polyline(
    points: tuple[RoadPoint, ...],
    bounds: tuple[float, float, float, float] = TARGET_BOUNDS,
) -> list[tuple[RoadPoint, ...]]:
    """Clip a normalized NVDB polyline with Shapely and reconstruct safe Z values."""
    if len(points) < 2:
        return []
    source_2d = LineString([(x, y) for x, y, _ in points])
    clipped = source_2d.intersection(shapely_box(*bounds))
    if clipped.is_empty:
        return []
    if isinstance(clipped, LineString):
        lines = [clipped]
    elif isinstance(clipped, MultiLineString):
        lines = list(clipped.geoms)
    else:
        return []

    output: list[tuple[RoadPoint, ...]] = []
    for line in lines:
        normalized = tuple((float(x), float(y), _interpolated_z(points, float(x), float(y))) for x, y in line.coords)
        if len(normalized) >= 2:
            output.append(normalized)
    return output


def normalize_nvdb_segments(
    payload: Any,
    *,
    bounds: tuple[float, float, float, float] = TARGET_BOUNDS,
    source_horizontal_crs: str = SOURCE_HORIZONTAL_CRS,
    target_horizontal_crs: str = TARGET_HORIZONTAL_CRS,
) -> list[RoadSegment]:
    """Normalize NVDB segmented road geometry to EPSG:25832 while preserving valid NN2000 Z."""
    transformer = Transformer.from_crs(source_horizontal_crs, target_horizontal_crs, always_xy=True)
    output: list[RoadSegment] = []
    for feature in _features(payload):
        geometry_data = feature.get("geometri") or {}
        geometry_wkt = geometry_data.get("wkt") if isinstance(geometry_data, dict) else None
        if not geometry_wkt:
            continue
        try:
            geometry = wkt.loads(geometry_wkt)
        except Exception as exc:
            raise NvdbContractError(f"invalid WKT for feature {feature.get('veglenkesekvensid')}") from exc

        base_id = f"{feature.get('veglenkesekvensid', '')}:{feature.get('segmentnummer', '')}"
        sequence_id = str(feature.get("veglenkesekvensid")) if feature.get("veglenkesekvensid") is not None else None
        segment_number = feature.get("segmentnummer") if isinstance(feature.get("segmentnummer"), int) else None
        road_type = str(feature.get("typeVeg") or "Veg")
        start_position = _float_or_none(feature.get("startposisjon"))
        end_position = _float_or_none(feature.get("sluttposisjon"))

        part_index = 0
        for source_points in _coordinate_lines(geometry):
            transformed: tuple[RoadPoint, ...] = tuple(
                (float(east), float(north), z)
                for x, y, z in source_points
                for east, north in [transformer.transform(x, y)]
            )
            for clipped in clip_polyline(transformed, bounds):
                output.append(
                    RoadSegment(
                        source_id=f"{base_id}:part{part_index}",
                        sequence_id=sequence_id,
                        segment_number=segment_number,
                        road_type=road_type,
                        points=clipped,
                        start_position=start_position,
                        end_position=end_position,
                    )
                )
                part_index += 1
    return sorted(output, key=lambda item: item.source_id)


def _float_or_none(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if isfinite(number) else None
