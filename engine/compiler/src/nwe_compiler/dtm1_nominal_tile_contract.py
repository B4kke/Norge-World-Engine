from __future__ import annotations

from dataclasses import asdict, dataclass
from math import isclose


class Dtm1NominalTileContractError(RuntimeError):
    pass


@dataclass(frozen=True)
class NominalTileCoreCandidate:
    provider_nominal_tile_size_m: float
    raster_width_px: int
    raster_height_px: int
    pixel_size_x_m: float
    pixel_size_y_m: float
    raster_span_x_m: float
    raster_span_y_m: float
    symmetric_inset_x_px: int
    symmetric_inset_y_px: int
    core_width_px: int
    core_height_px: int
    core_span_x_m: float
    core_span_y_m: float


def derive_nominal_tile_core_candidate(
    *,
    provider_nominal_tile_size_m: float,
    raster_width_px: int,
    raster_height_px: int,
    pixel_size_x_m: float,
    pixel_size_y_m: float,
    provider_describes_national_model_as_stitched: bool,
    tolerance_m: float = 1e-6,
) -> dict:
    """Derive the unique symmetric integer-pixel core compatible with provider facts.

    Provider documentation currently establishes that DTM1 is the national 1 m
    elevation model divided into 15 km tiles, and Høydedata describes national
    height models as current projects stitched together. Existing real-raster
    evidence establishes 15010 x 15010, 1 m tiles for the tested population.

    This function derives geometry only. It deliberately does NOT authorize
    discarding the derived border or selecting it as a production seam rule.
    That semantic step remains fail-closed until provider-owned documentation or
    equivalent authority explicitly establishes the border/core relationship.
    """
    if provider_nominal_tile_size_m <= 0:
        raise Dtm1NominalTileContractError("provider nominal tile size must be positive")
    if raster_width_px <= 0 or raster_height_px <= 0:
        raise Dtm1NominalTileContractError("raster dimensions must be positive")
    if pixel_size_x_m <= 0 or pixel_size_y_m <= 0:
        raise Dtm1NominalTileContractError("pixel sizes must be positive")
    if tolerance_m < 0:
        raise Dtm1NominalTileContractError("tolerance must be non-negative")
    if not provider_describes_national_model_as_stitched:
        raise Dtm1NominalTileContractError(
            "provider stitched-national-model premise must be explicit"
        )

    span_x = raster_width_px * pixel_size_x_m
    span_y = raster_height_px * pixel_size_y_m
    excess_x = span_x - provider_nominal_tile_size_m
    excess_y = span_y - provider_nominal_tile_size_m
    if excess_x < -tolerance_m or excess_y < -tolerance_m:
        raise Dtm1NominalTileContractError("raster is smaller than provider nominal tile")

    inset_x_float = excess_x / (2.0 * pixel_size_x_m)
    inset_y_float = excess_y / (2.0 * pixel_size_y_m)
    inset_x = round(inset_x_float)
    inset_y = round(inset_y_float)
    if not isclose(inset_x_float, inset_x, abs_tol=tolerance_m):
        raise Dtm1NominalTileContractError(
            "x excess does not admit a symmetric integer-pixel core"
        )
    if not isclose(inset_y_float, inset_y, abs_tol=tolerance_m):
        raise Dtm1NominalTileContractError(
            "y excess does not admit a symmetric integer-pixel core"
        )

    core_width = raster_width_px - 2 * inset_x
    core_height = raster_height_px - 2 * inset_y
    if core_width <= 0 or core_height <= 0:
        raise Dtm1NominalTileContractError("derived core is empty")

    core_span_x = core_width * pixel_size_x_m
    core_span_y = core_height * pixel_size_y_m
    if not isclose(core_span_x, provider_nominal_tile_size_m, abs_tol=tolerance_m):
        raise Dtm1NominalTileContractError("derived x core does not match provider tile size")
    if not isclose(core_span_y, provider_nominal_tile_size_m, abs_tol=tolerance_m):
        raise Dtm1NominalTileContractError("derived y core does not match provider tile size")

    candidate = NominalTileCoreCandidate(
        provider_nominal_tile_size_m=provider_nominal_tile_size_m,
        raster_width_px=raster_width_px,
        raster_height_px=raster_height_px,
        pixel_size_x_m=pixel_size_x_m,
        pixel_size_y_m=pixel_size_y_m,
        raster_span_x_m=span_x,
        raster_span_y_m=span_y,
        symmetric_inset_x_px=inset_x,
        symmetric_inset_y_px=inset_y,
        core_width_px=core_width,
        core_height_px=core_height,
        core_span_x_m=core_span_x,
        core_span_y_m=core_span_y,
    )
    return {
        "schema": "nwe.dtm1-nominal-tile-core-candidate/0.1",
        "candidate": asdict(candidate),
        "claim_calibration": {
            "fact": "a unique symmetric integer-pixel core is derivable from the provider nominal tile size and measured raster geometry",
            "inference": "the excess border may be a processing/export halo",
            "authorizes_border_discard": False,
            "authorizes_source_priority": False,
            "production_seam_authority": False,
            "authority_status": "UNPROVEN",
        },
    }
