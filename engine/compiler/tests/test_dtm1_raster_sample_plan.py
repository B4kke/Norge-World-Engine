import pytest

from nwe_compiler.dtm1_raster_sample_plan import (
    RasterSamplePlanError,
    select_spatial_deviation_samples,
)


def candidate(name, x, y, deviation):
    return {
        "name": name,
        "center_x_m": x,
        "center_y_m": y,
        "deviation_m": deviation,
    }


def test_plan_is_deterministic_and_order_independent():
    candidates = [
        candidate("a", 0, 0, 0.1),
        candidate("b", 10, 0, 0.2),
        candidate("c", 0, 10, 0.3),
        candidate("d", 10, 10, 0.4),
        candidate("e", 5, 5, 2.0),
        candidate("f", 5, 0, 1.0),
        candidate("g", 0, 5, 1.2),
        candidate("h", 10, 5, 1.4),
    ]
    first = select_spatial_deviation_samples(candidates, sample_count=6)
    second = select_spatial_deviation_samples(list(reversed(candidates)), sample_count=6)
    assert first == second
    assert len(first) == 6
    assert len(set(first)) == 6


def test_plan_forces_deviation_and_spatial_extremes_when_capacity_allows():
    candidates = [
        candidate("min-dev", 5, 5, 0.0),
        candidate("max-dev", 5, 5, 9.0),
        candidate("west", -10, 5, 2.0),
        candidate("east", 20, 5, 3.0),
        candidate("south", 5, -30, 4.0),
        candidate("north", 5, 40, 5.0),
        candidate("middle", 6, 6, 6.0),
    ]
    chosen = set(select_spatial_deviation_samples(candidates, sample_count=6))
    assert {"min-dev", "max-dev", "west", "east", "south", "north"} <= chosen


def test_plan_returns_all_candidates_sorted_when_budget_covers_population():
    candidates = [candidate("z", 0, 0, 1), candidate("a", 1, 1, 2)]
    assert select_spatial_deviation_samples(candidates, sample_count=3) == ["a", "z"]


@pytest.mark.parametrize(
    "candidates,sample_count",
    [
        ([], 1),
        ([candidate("a", 0, 0, 1)], 0),
        ([candidate("a", float("nan"), 0, 1)], 1),
        ([candidate("a", 0, 0, -1)], 1),
        ([candidate("a", 0, 0, 1), candidate("a", 1, 1, 2)], 1),
    ],
)
def test_invalid_plans_fail_closed(candidates, sample_count):
    with pytest.raises(RasterSamplePlanError):
        select_spatial_deviation_samples(candidates, sample_count=sample_count)
