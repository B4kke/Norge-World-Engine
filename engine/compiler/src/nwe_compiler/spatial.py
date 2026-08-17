from __future__ import annotations

from dataclasses import dataclass

from pyproj import Transformer
from shapely.geometry import Polygon, box as shapely_box
from shapely.validation import explain_validity

TARGET_EPSG25832 = (611000.0, 6677000.0, 612000.0, 6678000.0)


class SpatialContractError(RuntimeError):
    pass


@dataclass(frozen=True)
class DeclaredExtent:
    geometry_type: str
    geometry: object
    raw_text: str


def parse_georss_pairs(text: str, *, minimum_pairs: int) -> list[tuple[float, float]]:
    values = [float(value) for value in text.split()]
    if len(values) % 2 or len(values) < minimum_pairs * 2:
        raise SpatialContractError("invalid GeoRSS coordinate list")
    # GeoRSS Simple is latitude longitude. Internal geometry is longitude latitude.
    return [(values[i + 1], values[i]) for i in range(0, len(values), 2)]


def parse_georss_polygon(text: str) -> DeclaredExtent:
    coordinates = parse_georss_pairs(text, minimum_pairs=4)
    if coordinates[0] != coordinates[-1]:
        raise SpatialContractError("GeoRSS polygon ring must be closed")
    polygon = Polygon(coordinates)
    if polygon.is_empty or not polygon.is_valid or polygon.area <= 0:
        raise SpatialContractError(f"invalid GeoRSS polygon: {explain_validity(polygon)}")
    return DeclaredExtent("polygon", polygon, " ".join(text.split()))


def parse_georss_box(text: str) -> DeclaredExtent:
    coordinates = parse_georss_pairs(text, minimum_pairs=2)
    if len(coordinates) != 2:
        raise SpatialContractError("GeoRSS box must contain exactly two coordinate pairs")
    (lon1, lat1), (lon2, lat2) = coordinates
    bounds = (min(lon1, lon2), min(lat1, lat2), max(lon1, lon2), max(lat1, lat2))
    if bounds[0] == bounds[2] or bounds[1] == bounds[3]:
        raise SpatialContractError("GeoRSS box has zero area")
    return DeclaredExtent("box", shapely_box(*bounds), " ".join(text.split()))


def target_wgs84_polygon(bounds: tuple[float, float, float, float] = TARGET_EPSG25832) -> Polygon:
    transformer = Transformer.from_crs("EPSG:25832", "EPSG:4326", always_xy=True)
    x0, y0, x1, y1 = bounds
    coordinates = [
        transformer.transform(x0, y0),
        transformer.transform(x1, y0),
        transformer.transform(x1, y1),
        transformer.transform(x0, y1),
        transformer.transform(x0, y0),
    ]
    return Polygon(coordinates)


def declared_extent_covers_target(extent: DeclaredExtent, target: Polygon) -> bool:
    # Cheap bbox prefilter. It is never authoritative for polygon sources.
    if not shapely_box(*extent.geometry.bounds).covers(target):
        return False
    return extent.geometry.covers(target)
