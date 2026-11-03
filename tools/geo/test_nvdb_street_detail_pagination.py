#!/usr/bin/env python3
"""Adversarial pagination checks: never certify a truncated NVDB inventory."""
import importlib.util
import json
from pathlib import Path

path = Path(__file__).with_name("compile_nvdb_street_detail.py")
spec = importlib.util.spec_from_file_location("street_detail", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def payload(objects, metadata=None):
    return json.dumps({"objekter": objects, "metadata": metadata or {}}).encode()


assert len(module.parse_payload(payload([{"id": 1}]))["objekter"]) == 1
for raw in (
    payload([], {"neste": {"href": "https://example.invalid/next"}}),
    payload([{"id": i} for i in range(1000)]),
):
    try:
        module.parse_payload(raw)
    except RuntimeError:
        pass
    else:
        raise AssertionError("truncated collection was incorrectly accepted")
print("NVDB_STREET_DETAIL_PAGINATION_FAIL_CLOSED_PASS")
