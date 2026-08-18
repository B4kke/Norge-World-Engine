from __future__ import annotations

import pytest

from nwe_compiler.dtm1_source_grid_audit import (
    SourceGridAuditError,
    audit_declared_route_pair,
    infer_route_extent,
)


SOURCE_116 = (275425.00010278344, 6665994.99998838, 290435.000100316, 6681005.000012783)
SOURCE_117 = (275425.00010301, 6680994.999986657, 290435.0001004398, 6696005.000011843)


def test_nannestad_declared_extents_fit_buffered_15km_route_hypothesis():
    audit = audit_declared_route_pair(SOURCE_116, SOURCE_117)

    assert audit["schema"] == "nwe.dtm1-source-grid-geometry-audit/0.1"
    assert audit["first"]["inferred_buffer_x_m"] == pytest.approx(5.0, abs=0.001)
    assert audit["first"]["inferred_buffer_y_m"] == pytest.approx(5.0, abs=0.001)
    assert audit["second"]["inferred_buffer_x_m"] == pytest.approx(5.0, abs=0.001)
    assert audit["second"]["inferred_buffer_y_m"] == pytest.approx(5.0, abs=0.001)
    assert audit["pair"]["axis"] == "y"
    assert audit["pair"]["center_spacing_m"] == pytest.approx(15_000.0, abs=0.001)
    assert audit["pair"]["raw_overlap_m"] == pytest.approx(10.0, abs=0.001)
    assert audit["pair"]["inferred_buffer_sum_m"] == pytest.approx(10.0, abs=0.001)
    assert audit["pair"]["nominal_core_gap_m"] == pytest.approx(0.0, abs=0.001)
    assert audit["pair"]["hypothesis_supported"] is True
    assert audit["pair"]["authority_status"] == "UNPROVEN"
    assert audit["claim_calibration"]["production_seam_authority"] is False


def test_asymmetric_declared_extent_is_rejected():
    with pytest.raises(SourceGridAuditError, match="symmetric XY buffer"):
        infer_route_extent((0.0, 0.0, 15_010.0, 15_020.0))


def test_non_adjacent_route_pair_is_rejected():
    with pytest.raises(SourceGridAuditError, match="not adjacent"):
        audit_declared_route_pair(
            (0.0, 0.0, 15_010.0, 15_010.0),
            (0.0, 30_000.0, 15_010.0, 45_010.0),
        )
