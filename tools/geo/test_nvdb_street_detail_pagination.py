#!/usr/bin/env python3
"""Offline NVDB V4 cursor-admission regressions (no provider contact)."""
import importlib.util
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

path = Path(__file__).with_name("compile_nvdb_street_detail.py")
spec = importlib.util.spec_from_file_location("street_detail", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

INITIAL = (
    "https://nvdbapiles.atlas.vegvesen.no/vegobjekter/api/v4/vegobjekter/95"
    "?kartutsnitt=1,2,3,4&antall=1000&srid=5973&inkluder=metadata,relasjoner"
)

def response(items, next_start=None, next_href=None):
    metadata = {"returnert": len(items)}
    if next_start is not None:
        metadata["neste"] = {
            "start": next_start,
            "href": next_href or (
                "https://nvdbapiles.atlas.vegvesen.no/vegobjekter/api/v4/vegobjekter/95"
                "?start=" + next_start
            ),
        }
    return json.dumps({"objekter": [{"id": item} for item in items], "metadata": metadata}).encode()

def fetch_from(pages, seen):
    def fetch(url):
        parsed = urlsplit(url)
        query = parse_qs(parsed.query)
        assert query["kartutsnitt"] == ["1,2,3,4"], "initial tile filter must survive every cursor"
        assert query["srid"] == ["5973"], "CRS filter must survive every cursor"
        key = query.get("start", [""])[0]
        seen.append((key, url))
        return pages[key]
    return fetch

seen = []
objects, source = module.fetch_collection_pages(INITIAL, fetch=fetch_from({
    "": response([1, 2], "page-b"),
    "page-b": response([3], "page-c"),
    # NVDB documents an empty terminal page, possibly with a cursor repeated.
    "page-c": response([], "page-c"),
}, seen))
assert [obj["id"] for obj in objects] == [1, 2, 3]
assert [cursor for cursor, _ in seen] == ["", "page-b", "page-c"]
assert source["page_count"] == 3
assert len({page["raw_sha256"] for page in source["page_snapshots"]}) == 3
assert source["raw_byte_size"] == sum(page["raw_byte_size"] for page in source["page_snapshots"])
assert len(source["raw_sha256"]) == 64

# A full page is not itself a truncation if the provider explicitly ends it.
objects, source = module.fetch_collection_pages(INITIAL, fetch=lambda _: response(range(1000)))
assert len(objects) == 1000 and source["page_count"] == 1

def must_reject(pages, pattern):
    try:
        module.fetch_collection_pages(INITIAL, fetch=fetch_from(pages, []))
    except RuntimeError as error:
        assert pattern in str(error), str(error)
    else:
        raise AssertionError("unsafe/incomplete NVDB pagination was admitted")

must_reject({"": response([1], "cycle"), "cycle": response([2], "cycle")}, "cycle")
must_reject({"": response([1], "dup"), "dup": response([1])}, "duplicate")
# A foreign href is harmless when the provider separately supplies a valid
# opaque cursor: the compiler NEVER follows the href.
objects, _ = module.fetch_collection_pages(INITIAL, fetch=fetch_from({
    "": response([1], "good", "https://evil.example.net/other"),
    "good": response([2]),
}, []))
assert [obj["id"] for obj in objects] == [1, 2]
# An href is only interpreted if the start cursor is missing.
malicious = json.dumps({
    "objekter": [{"id": 1}], "metadata": {
        "returnert": 1, "neste": {"href": "https://evil.example.net/other?start=attack"},
    },
}).encode()
must_reject({"": malicious}, "trusted")
try:
    module.fetch_collection_pages(INITIAL, fetch=fetch_from({
        "": response([1], "more"),
        "more": response([2]),
    }, []), max_pages=1)
except RuntimeError as error:
    assert "budget" in str(error)
else:
    raise AssertionError("page budget was not enforced")

try:
    module.parse_payload(json.dumps({
        "objekter": [{"id": 1}],
        "metadata": {"returnert": 2},
    }).encode())
except RuntimeError as error:
    assert "returnert" in str(error)
else:
    raise AssertionError("returnert mismatch was admitted")

print("NVDB_STREET_DETAIL_COMPLETE_PAGINATION_PASS")
