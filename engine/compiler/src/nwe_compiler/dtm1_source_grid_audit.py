from __future__ import annotations

from dataclasses import asdict, dataclass
from itertools import combinations
from statistics import mean


class SourceGridAuditError(RuntimeError):
    pass


@dataclass(frozen=True)
class RouteExtentAudit:
    bounds: tuple[float, float, float, float]
    width_m: float
    height_m: float
    nominal_route_size_m: float
    inferred_buffer_x_m: float
    inferred_buffer_y_m: float
    nominal_core_bounds: tuple[float, float, float, float]


@dataclass(frozen=True)
class AdjacentRouteAudit:
    axis: str
    center_spacing_m: float
    raw_overlap_m: float
    inferred_buffer_sum_m: float
    nominal_core_gap_m: float
    hypothesis_supported: bool
    authority_status: str = "UNPROVEN"


def infer_route_extent(
    bounds: tuple[float, float, float, float],
    *,
    nominal_route_size_m: float = 15_000.0,
    tolerance_m: float = 0.25,
) -> RouteExtentAudit:
    """Infer a symmetric padding hypothesis from one declared source extent.

    This is diagnostic evidence only. The inferred buffer MUST NOT be used as a
    production seam authority unless the source provider documents equivalent
    semantics or another authoritative contract proves them.
    """

    if nominal_route_size_m <= 0 or tolerance_m < 0:
        raise SourceGridAuditError("invalid route-size/tolerance contract")

    left, bottom, right, top = (float(value) for value in bounds)
    width = right - left
    height = top - bottom
    if width <= 0 or height <= 0:
        raise SourceGridAuditError("declared route extent must have positive area")
    if width + tolerance_m < nominal_route_size_m or height + tolerance_m < nominal_route_size_m:
        raise SourceGridAuditError("declared route extent is smaller than nominal route size")

    buffer_x = (width - nominal_route_size_m) / 2.0
    buffer_y = (height - nominal_route_size_m) / 2.0
    if buffer_x < -tolerance_m or buffer_y < -tolerance_m:
        raise SourceGridAuditError("negative inferred route buffer")
    if abs(buffer_x - buffer_y) > tolerance_m:
        raise SourceGridAuditError(
            "declared route extent is not consistent with a symmetric XY buffer: "
            f"x={buffer_x:.6f} m y={buffer_y:.6f} m"
        )

    return RouteExtentAudit(
        bounds=(left, bottom, right, top),
        width_m=width,
        height_m=height,
        nominal_route_size_m=nominal_route_size_m,
        inferred_buffer_x_m=buffer_x,
        inferred_buffer_y_m=buffer_y,
        nominal_core_bounds=(
            left + buffer_x,
            bottom + buffer_y,
            right - buffer_x,
            top - buffer_y,
        ),
    )


def audit_adjacent_routes(
    first: RouteExtentAudit,
    second: RouteExtentAudit,
    *,
    tolerance_m: float = 0.25,
) -> AdjacentRouteAudit:
    """Test whether two declared extents fit the same buffered-route hypothesis."""

    if tolerance_m < 0:
        raise SourceGridAuditError("tolerance must be non-negative")
    if abs(first.nominal_route_size_m - second.nominal_route_size_m) > tolerance_m:
        raise SourceGridAuditError("route nominal-size mismatch")

    def center(bounds: tuple[float, float, float, float]) -> tuple[float, float]:
        left, bottom, right, top = bounds
        return ((left + right) / 2.0, (bottom + top) / 2.0)

    c1x, c1y = center(first.bounds)
    c2x, c2y = center(second.bounds)
    dx = abs(c2x - c1x)
    dy = abs(c2y - c1y)
    nominal = first.nominal_route_size_m

    if dx <= tolerance_m and abs(dy - nominal) <= tolerance_m:
        axis = "y"
        lower, upper = (first, second) if c1y <= c2y else (second, first)
        raw_overlap = lower.bounds[3] - upper.bounds[1]
        buffer_sum = lower.inferred_buffer_y_m + upper.inferred_buffer_y_m
        core_gap = upper.nominal_core_bounds[1] - lower.nominal_core_bounds[3]
        spacing = dy
    elif dy <= tolerance_m and abs(dx - nominal) <= tolerance_m:
        axis = "x"
        lower, upper = (first, second) if c1x <= c2x else (second, first)
        raw_overlap = lower.bounds[2] - upper.bounds[0]
        buffer_sum = lower.inferred_buffer_x_m + upper.inferred_buffer_x_m
        core_gap = upper.nominal_core_bounds[0] - lower.nominal_core_bounds[2]
        spacing = dx
    else:
        raise SourceGridAuditError(
            "declared route centers are not adjacent on the nominal route grid: "
            f"dx={dx:.6f} m dy={dy:.6f} m nominal={nominal:.6f} m"
        )

    supported = (
        abs(spacing - nominal) <= tolerance_m
        and raw_overlap >= -tolerance_m
        and abs(raw_overlap - buffer_sum) <= tolerance_m
        and abs(core_gap) <= tolerance_m
    )
    return AdjacentRouteAudit(
        axis=axis,
        center_spacing_m=spacing,
        raw_overlap_m=raw_overlap,
        inferred_buffer_sum_m=buffer_sum,
        nominal_core_gap_m=core_gap,
        hypothesis_supported=supported,
    )


def audit_declared_route_pair(
    first_bounds: tuple[float, float, float, float],
    second_bounds: tuple[float, float, float, float],
    *,
    nominal_route_size_m: float = 15_000.0,
    tolerance_m: float = 0.25,
) -> dict:
    first = infer_route_extent(
        first_bounds,
        nominal_route_size_m=nominal_route_size_m,
        tolerance_m=tolerance_m,
    )
    second = infer_route_extent(
        second_bounds,
        nominal_route_size_m=nominal_route_size_m,
        tolerance_m=tolerance_m,
    )
    pair = audit_adjacent_routes(first, second, tolerance_m=tolerance_m)
    return {
        "schema": "nwe.dtm1-source-grid-geometry-audit/0.1",
        "nominal_route_size_m": nominal_route_size_m,
        "tolerance_m": tolerance_m,
        "first": asdict(first),
        "second": asdict(second),
        "pair": asdict(pair),
        "claim_calibration": {
            "fact": "declared extents are geometrically consistent with buffered nominal routes"
            if pair.hypothesis_supported
            else "declared extents are not geometrically consistent with the tested buffered-route hypothesis",
            "assumption": "the inferred buffer is a non-authoritative processing halo",
            "production_seam_authority": False,
            "authority_status": "UNPROVEN",
        },
    }


def audit_declared_route_grid(
    routes: dict[str, tuple[float, float, float, float]],
    *,
    nominal_route_size_m: float = 15_000.0,
    tolerance_m: float = 0.25,
) -> dict:
    """Audit every nominally adjacent pair in a declared source-route set.

    This intentionally measures regularity only. Even a perfectly regular grid
    does not authorize dropping overlap samples or choosing a source winner.
    """

    if len(routes) < 2:
        raise SourceGridAuditError("route-grid audit requires at least two routes")

    inferred = {
        route_id: infer_route_extent(
            bounds,
            nominal_route_size_m=nominal_route_size_m,
            tolerance_m=tolerance_m,
        )
        for route_id, bounds in sorted(routes.items())
    }

    pairs: list[dict] = []
    for first_id, second_id in combinations(sorted(inferred), 2):
        try:
            pair = audit_adjacent_routes(
                inferred[first_id],
                inferred[second_id],
                tolerance_m=tolerance_m,
            )
        except SourceGridAuditError as exc:
            if "not adjacent" in str(exc):
                continue
            raise
        pairs.append(
            {
                "first_id": first_id,
                "second_id": second_id,
                **asdict(pair),
            }
        )

    if not pairs:
        raise SourceGridAuditError("route-grid audit found no nominally adjacent route pairs")

    supported_pairs = sum(1 for pair in pairs if pair["hypothesis_supported"])
    overlaps = [float(pair["raw_overlap_m"]) for pair in pairs]
    spacings = [float(pair["center_spacing_m"]) for pair in pairs]
    core_gaps = [float(pair["nominal_core_gap_m"]) for pair in pairs]

    return {
        "schema": "nwe.dtm1-source-grid-regularity-audit/0.1",
        "nominal_route_size_m": nominal_route_size_m,
        "tolerance_m": tolerance_m,
        "route_count": len(inferred),
        "adjacent_pair_count": len(pairs),
        "supported_pair_count": supported_pairs,
        "all_adjacent_pairs_support_hypothesis": supported_pairs == len(pairs),
        "summary": {
            "raw_overlap_m": {
                "min": min(overlaps),
                "max": max(overlaps),
                "mean": mean(overlaps),
            },
            "center_spacing_m": {
                "min": min(spacings),
                "max": max(spacings),
                "mean": mean(spacings),
            },
            "nominal_core_gap_m": {
                "min": min(core_gaps),
                "max": max(core_gaps),
                "mean": mean(core_gaps),
            },
        },
        "routes": {route_id: asdict(audit) for route_id, audit in inferred.items()},
        "pairs": pairs,
        "claim_calibration": {
            "fact": "grid regularity was measured from declared provider extents",
            "inference": "regularity may support the buffered-route geometry hypothesis",
            "assumption": "any inferred buffer is a disposable processing halo",
            "production_seam_authority": False,
            "authority_status": "UNPROVEN",
        },
    }
