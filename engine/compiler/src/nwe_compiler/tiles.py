from __future__ import annotations

from dataclasses import dataclass
from math import isfinite

PROTOTYPE_HORIZONTAL_CRS = "EPSG:25832"
DEFAULT_TILE_SIZE_M = 1000


class TileContractError(ValueError):
    pass


@dataclass(frozen=True)
class TileSpec:
    """Explicit Prototype-0 tile identity and canonical projected bounds.

    This is intentionally a small compiler/runtime contract, not a final
    whole-Norway indexing decision. Tile ids stay deterministic and independent
    of renderer-local/floating origins.
    """

    tile_id: str
    bounds: tuple[float, float, float, float]
    horizontal_crs: str = PROTOTYPE_HORIZONTAL_CRS

    def __post_init__(self) -> None:
        if not isinstance(self.tile_id, str) or not self.tile_id:
            raise TileContractError("tile_id must be a non-empty string")
        if self.horizontal_crs != PROTOTYPE_HORIZONTAL_CRS:
            raise TileContractError(
                f"Prototype 0 tile CRS must be {PROTOTYPE_HORIZONTAL_CRS}, got {self.horizontal_crs}"
            )
        if len(self.bounds) != 4 or not all(isfinite(value) for value in self.bounds):
            raise TileContractError("tile bounds must contain four finite values")
        left, bottom, right, top = self.bounds
        if not (right > left and top > bottom):
            raise TileContractError("tile bounds must have positive width and height")
        if abs((right - left) - (top - bottom)) > 1e-9:
            raise TileContractError("Prototype 0 tiles must be square")

    @property
    def size_m(self) -> float:
        return self.bounds[2] - self.bounds[0]

    @property
    def center(self) -> tuple[float, float]:
        left, bottom, right, top = self.bounds
        return (left + right) / 2.0, (bottom + top) / 2.0

    def scheduler_record(self) -> dict:
        center_e, center_n = self.center
        return {"id": self.tile_id, "centerE": center_e, "centerN": center_n}


def _integer_meter(value: float | int, label: str) -> int:
    numeric = float(value)
    if not isfinite(numeric):
        raise TileContractError(f"{label} must be finite")
    rounded = round(numeric)
    if abs(numeric - rounded) > 1e-9:
        raise TileContractError(f"{label} must be aligned to whole metres for Prototype 0")
    return int(rounded)


def prototype_tile(
    origin_e: float | int,
    origin_n: float | int,
    tile_size_m: float | int = DEFAULT_TILE_SIZE_M,
) -> TileSpec:
    """Build the current deterministic EPSG:25832 Prototype-0 tile id.

    The id grammar preserves the already-proven Nannestad tile identity. It is
    explicitly a prototype convention and must not be promoted to a whole-Norway
    indexing standard without a separate decision and measurement.
    """

    easting = _integer_meter(origin_e, "origin_e")
    northing = _integer_meter(origin_n, "origin_n")
    size = _integer_meter(tile_size_m, "tile_size_m")
    if size <= 0:
        raise TileContractError("tile_size_m must be positive")
    return TileSpec(
        tile_id=f"epsg25832_{easting}_{northing}_{size}m",
        bounds=(float(easting), float(northing), float(easting + size), float(northing + size)),
    )


NANNESTAD_TILE = prototype_tile(611000, 6677000)


def square_tile_grid(center: TileSpec = NANNESTAD_TILE, *, radius: int = 1) -> tuple[TileSpec, ...]:
    """Return a deterministic north-to-south square grid around ``center``.

    Ordering intentionally matches the runtime scheduler helper: north rows
    first, then west-to-east. The compiler remains free to consume the tuple in
    any priority order; this function only makes the candidate set reproducible.
    """

    if not isinstance(radius, int) or isinstance(radius, bool) or radius < 0:
        raise TileContractError("radius must be a non-negative integer")
    size = _integer_meter(center.size_m, "center.size_m")
    left, bottom, _, _ = center.bounds
    origin_e = _integer_meter(left, "center.left")
    origin_n = _integer_meter(bottom, "center.bottom")
    tiles: list[TileSpec] = []
    for north in range(radius, -radius - 1, -1):
        for east in range(-radius, radius + 1):
            tiles.append(prototype_tile(origin_e + east * size, origin_n + north * size, size))
    return tuple(tiles)
