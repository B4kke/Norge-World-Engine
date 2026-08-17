import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from nwe_compiler.acquisition import (
    TILE_BOUNDS,
    AcquisitionError,
    NVDB_X_CLIENT,
    _default_fetch,
    _request_headers,
    acquire_source,
    nvdb_contract,
    osm_contract,
    transformed_envelope,
)


def test_source_envelopes_transform_all_four_tile_corners():
    nvdb = nvdb_contract()
    osm = osm_contract()
    exact_33 = transformed_envelope(TILE_BOUNDS, "EPSG:25832", "EPSG:25833")
    assert nvdb.query_bounds[0] < exact_33[0]
    assert nvdb.query_bounds[1] < exact_33[1]
    assert nvdb.query_bounds[2] > exact_33[2]
    assert nvdb.query_bounds[3] > exact_33[3]
    assert abs(osm.query_bounds[0] - 11.00323908421006) < 1e-12
    assert abs(osm.query_bounds[1] - 60.214367176568494) < 1e-12
    assert abs(osm.query_bounds[2] - 11.021825770804512) < 1e-12
    assert abs(osm.query_bounds[3] - 60.223614277941905) < 1e-12


def test_nvdb_request_contract_is_v4_srid5973():
    contract = nvdb_contract()
    parsed = urlparse(contract.request_url)
    query = parse_qs(parsed.query)
    assert parsed.path.endswith("/vegnett/api/v4/veglenkesekvenser/segmentert")
    assert query["srid"] == ["5973"]
    assert query["antall"] == ["1000"]
    assert query["inkluderAntall"] == ["false"]
    assert len(query["kartutsnitt"][0].split(",")) == 4


def test_nvdb_requests_identify_world_compiler_but_osm_does_not():
    assert _request_headers(nvdb_contract().request_url)["X-Client"] == NVDB_X_CLIENT
    assert "X-Client" not in _request_headers(osm_contract().request_url)


def test_default_fetch_passes_x_client_to_nvdb(monkeypatch):
    raw = b'{"objekter":[{"geometri":{"wkt":"LINESTRING Z (1 2 3, 4 5 6)"}}]}'
    captured = {}

    class Response:
        status = 200
        headers = {"Content-Type": "application/json"}

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return None

        def read(self):
            return raw

    def fake_urlopen(request, timeout):
        captured["request"] = request
        captured["timeout"] = timeout
        return Response()

    monkeypatch.setattr("nwe_compiler.acquisition.urlopen", fake_urlopen)
    assert _default_fetch(nvdb_contract().request_url, 7.5) == raw
    assert captured["request"].get_header("X-client") == NVDB_X_CLIENT
    assert captured["timeout"] == 7.5


def test_raw_cache_cold_then_warm_has_zero_second_fetch(tmp_path: Path):
    contract = nvdb_contract()
    raw = json.dumps({
        "objekter": [
            {"veglenkesekvensid": 1, "segmentnummer": 1, "geometri": {"wkt": "LINESTRING Z (278700 6682000 190, 278710 6682010 191)"}}
        ]
    }).encode()
    calls = []

    def fetcher(url, timeout):
        calls.append((url, timeout))
        return raw

    cold = acquire_source(contract, tmp_path, fetcher=fetcher)
    warm = acquire_source(contract, tmp_path, fetcher=lambda *_: (_ for _ in ()).throw(AssertionError("network used")))
    assert not cold.cache_hit
    assert warm.cache_hit
    assert cold.raw_sha256 == warm.raw_sha256
    assert cold.raw_bytes == warm.raw_bytes == raw
    assert len(calls) == 1


def test_offline_cache_miss_fails_closed(tmp_path: Path):
    try:
        acquire_source(osm_contract(), tmp_path, offline=True)
    except AcquisitionError as exc:
        assert "offline cache miss" in str(exc)
    else:
        raise AssertionError("offline cache miss must fail")
