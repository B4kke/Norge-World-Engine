from __future__ import annotations

import pytest

from nwe_compiler.tiles import (
    NANNESTAD_TILE,
    TileContractError,
    TileSpec,
    prototype_tile,
    square_tile_grid,
)


def test_nannestad_tile_preserves_proven_identity():
    assert NANNESTAD_TILE.tile_id == "epsg25832_611000_6677000_1000m"
    assert NANNESTAD_TILE.bounds == (611000.0, 6677000.0, 612000.0, 6678000.0)
    assert NANNESTAD_TILE.center == (611500.0, 6677500.0)
    assert NANNESTAD_TILE.scheduler_record() == {
        "id": "epsg25832_611000_6677000_1000m",
        "centerE": 611500.0,
        "centerN": 6677500.0,
    }


def test_square_grid_is_unique_contiguous_and_deterministic():
    grid = square_tile_grid(radius=1)
    assert len(grid) == 9
    assert len({tile.tile_id for tile in grid}) == 9
    assert grid[0].tile_id == "epsg25832_610000_6678000_1000m"
    assert grid[4] == NANNESTAD_TILE
    assert grid[-1].tile_id == "epsg25832_612000_6676000_1000m"

    expected_origins = {
        (610000.0, 6678000.0),
        (611000.0, 6678000.0),
        (612000.0, 6678000.0),
        (610000.0, 6677000.0),
        (611000.0, 6677000.0),
        (612000.0, 6677000.0),
        (610000.0, 6676000.0),
        (611000.0, 6676000.0),
        (612000.0, 6676000.0),
    }
    assert {(tile.bounds[0], tile.bounds[1]) for tile in grid} == expected_origins
    assert square_tile_grid(radius=1) == grid


def test_prototype_tile_fails_closed_on_non_integer_grid_identity():
    with pytest.raises(TileContractError, match="whole metres"):
        prototype_tile(611000.5, 6677000)
    with pytest.raises(TileContractError, match="whole metres"):
        TileSpec("fractional", (611000.25, 6677000.0, 612000.25, 6678000.0))
    with pytest.raises(TileContractError, match="positive"):
        prototype_tile(611000, 6677000, 0)
    with pytest.raises(TileContractError, match="radius"):
        square_tile_grid(radius=-1)
