from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Mapping


class RasterSamplePlanError(ValueError):
    pass


@dataclass(frozen=True)
class RasterSampleCandidate:
    name: str
    center_x_m: float
    center_y_m: float
    deviation_m: float


def _finite(value: object, *, label: str) -> float:
    result = float(value)
    if not math.isfinite(result):
        raise RasterSamplePlanError(f"{label} must be finite")
    return result


def _normalize(values: list[float]) -> list[float]:
    low = min(values)
    high = max(values)
    if high == low:
        return [0.0 for _ in values]
    scale = high - low
    return [(value - low) / scale for value in values]


def _coerce_candidates(candidates: Iterable[Mapping[str, object]]) -> list[RasterSampleCandidate]:
    result: list[RasterSampleCandidate] = []
    seen_names: set[str] = set()
    for raw in candidates:
        name = str(raw.get("name") or "").strip()
        if not name:
            raise RasterSamplePlanError("candidate name is required")
        if name in seen_names:
            raise RasterSamplePlanError(f"duplicate candidate name: {name}")
        seen_names.add(name)
        deviation = _finite(raw.get("deviation_m"), label=f"{name}.deviation_m")
        if deviation < 0:
            raise RasterSamplePlanError(f"{name}.deviation_m must be non-negative")
        result.append(
            RasterSampleCandidate(
                name=name,
                center_x_m=_finite(raw.get("center_x_m"), label=f"{name}.center_x_m"),
                center_y_m=_finite(raw.get("center_y_m"), label=f"{name}.center_y_m"),
                deviation_m=deviation,
            )
        )
    if not result:
        raise RasterSamplePlanError("at least one candidate is required")
    return result


def select_spatial_deviation_samples(
    candidates: Iterable[Mapping[str, object]],
    *,
    sample_count: int,
) -> list[str]:
    """Select a deterministic metadata-audit sample with spatial/deviation spread.

    This is an evidence collection plan only. It intentionally does not infer source
    priority, core/halo semantics, clipping rules or any production seam authority.
    """

    items = _coerce_candidates(candidates)
    if not isinstance(sample_count, int) or isinstance(sample_count, bool) or sample_count <= 0:
        raise RasterSamplePlanError("sample_count must be a positive integer")
    if sample_count >= len(items):
        return sorted(item.name for item in items)

    by_name = {item.name: item for item in items}
    selected: list[str] = []

    def add(item: RasterSampleCandidate) -> None:
        if item.name not in selected and len(selected) < sample_count:
            selected.append(item.name)

    # Force observable extremes into the plan before space-filling selection.
    for key in (
        lambda item: item.deviation_m,
        lambda item: -item.deviation_m,
        lambda item: item.center_x_m,
        lambda item: -item.center_x_m,
        lambda item: item.center_y_m,
        lambda item: -item.center_y_m,
    ):
        add(min(items, key=lambda item: (key(item), item.name)))

    xs = _normalize([item.center_x_m for item in items])
    ys = _normalize([item.center_y_m for item in items])
    ds = _normalize([item.deviation_m for item in items])
    normalized = {
        item.name: (xs[index], ys[index], ds[index])
        for index, item in enumerate(items)
    }

    def squared_distance(left: tuple[float, float, float], right: tuple[float, float, float]) -> float:
        return sum((a - b) ** 2 for a, b in zip(left, right, strict=True))

    while len(selected) < sample_count:
        remaining = [item for item in items if item.name not in selected]
        if not selected:
            add(min(remaining, key=lambda item: item.name))
            continue
        selected_points = [normalized[name] for name in selected]
        scored: list[tuple[float, str]] = []
        for item in remaining:
            point = normalized[item.name]
            min_distance = min(squared_distance(point, chosen) for chosen in selected_points)
            scored.append((min_distance, item.name))
        best_distance = max(score for score, _ in scored)
        best_name = min(name for score, name in scored if score == best_distance)
        add(by_name[best_name])

    return selected
