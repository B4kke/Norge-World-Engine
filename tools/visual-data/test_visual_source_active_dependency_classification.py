#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def load(name: str):
    path = ROOT / name
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


order = load("probe_visual_order_selections.py")
sr16 = load("probe_sr16_metadata_links.py")

optional_drift = {
    "research": {"active_runtime_required": False, "status": "AMBIGUOUS"},
    "active": {"active_runtime_required": True, "status": "PASS"},
}
assert order.classify(optional_drift) == {
    "status": "PASS",
    "active_runtime_status": "PASS",
    "active_runtime_failures": [],
    "research_drift": ["research"],
}
assert sr16.classify(optional_drift)["status"] == "PASS"

active_failure = {
    "research": {"active_runtime_required": False, "status": "PASS"},
    "active": {"active_runtime_required": True, "status": "UNAVAILABLE"},
}
assert order.classify(active_failure)["status"] == "FAIL"
assert order.classify(active_failure)["active_runtime_failures"] == ["active"]
assert sr16.classify(active_failure)["status"] == "FAIL"

original_fetch = sr16.fetch_json
sr16.fetch_json = lambda url: (_ for _ in ()).throw(
    urllib.error.HTTPError(url, 404, "Not Found", hdrs=None, fp=None)
)
try:
    optional = sr16.probe_one("legacy", {
        "metadata_uuid": "legacy-id",
        "active_runtime_required": False,
        "role": "test research candidate",
    })
finally:
    sr16.fetch_json = original_fetch
assert optional["status"] == "UNAVAILABLE"
assert optional["metadata_http"]["status"] == 404
assert optional["active_runtime_required"] is False

print("visual source active dependency classification regressions: PASS")
