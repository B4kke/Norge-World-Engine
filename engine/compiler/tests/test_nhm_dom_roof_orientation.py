from __future__ import annotations

import importlib.util
import math
from pathlib import Path
import sys

import numpy as np
import pytest


MODULE_PATH = Path(__file__).parents[3] / "tools" / "geo" / "probe_nhm_dom_roof_orientation.py"
SPEC = importlib.util.spec_from_file_location("probe_nhm_dom_roof_orientation", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
roof = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = roof
SPEC.loader.exec_module(roof)


def _grid(step: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
    x_values = np.arange(-5.0, 5.0 + step, step)
    y_values = np.arange(-4.0, 4.0 + step, step)
    x, y = np.meshgrid(x_values, y_values)
    return x.ravel(), y.ravel()


def test_known_gable_ridge_direction_is_recovered() -> None:
    east, north = _grid()
    expected = 30.0
    theta = math.radians(expected)
    along = math.cos(theta) * east + math.sin(theta) * north
    cross = -math.sin(theta) * east + math.cos(theta) * north
    heights = 8.0 - 0.55 * np.abs(cross) + 0.02 * along
    result = roof.fit_roof_orientation(east, north, heights)
    assert result["status"] == "ACCEPTED_GABLE_LIKE_DIRECTION"
    assert roof._angular_difference_deg(
        result["ridge_orientation_deg_from_east_ccw"], expected
    ) <= roof.ANGLE_STEP_DEG
    assert result["tent_r2"] > 0.95
    assert result["r2_improvement_over_plane"] > 0.5
    assert result["orthogonal_gap"] > 0.5


def test_flat_surface_is_rejected_by_relief_gate() -> None:
    east, north = _grid()
    heights = 5.0 + 0.02 * np.sin(east)
    result = roof.fit_roof_orientation(east, north, heights)
    assert result["status"] == "REJECTED"
    assert result["rejection_reason"] == "low-relief"


def test_single_sloping_plane_is_not_mislabelled_as_gable() -> None:
    east, north = _grid()
    heights = 5.0 + 0.25 * east + 0.08 * north
    result = roof.fit_roof_orientation(east, north, heights)
    assert result["status"] == "REJECTED"
    assert result["rejection_reason"] == "tent-not-better-than-plane"
    # The fitter winsorizes p10-p95 before model comparison, so even an exact\n    # synthetic plane is slightly clipped at the tails. It must still be a\n    # very strong plane and, critically, reject the gable interpretation.\n    assert result["plane_r2"] > 0.98\n

def test_angular_difference_is_180_degree_periodic() -> None:
    assert roof._angular_difference_deg(2.0, 178.0) == pytest.approx(4.0)
    assert roof._angular_difference_deg(10.0, 100.0) == pytest.approx(90.0)
