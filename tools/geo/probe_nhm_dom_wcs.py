#!/usr/bin/env python3
"""Probe Kartverket's public NHM DOM EPSG:25832 WCS without downloading raster data.

This is source-admission evidence only. It verifies that the official service
advertises one unambiguous digital-surface-model coverage for UTM32 and that
DescribeCoverage identifies the same coverage/CRS before any NWE compiler
contract is allowed to depend on it.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


WCS_ENDPOINT = "https://wcs.geonorge.no/skwms1/wcs.hoyde-dom-nhm-25832"
USER_AGENT = "NorgeWorldEngine/0.1 nhm-dom-source-probe"
EXPECTED_CRS_TOKENS = ("EPSG:25832", "EPSG::25832", "25832")


class DomProbeError(RuntimeError):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def request_xml(url: str) -> tuple[str | None, bytes]:
    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.1",
        },
    )
    try:
        with urlopen(request, timeout=90) as response:
            if getattr(response, "status", 200) != 200:
                raise DomProbeError(f"HTTP {response.status}: {url}")
            return response.headers.get("Content-Type"), response.read()
    except DomProbeError:
        raise
    except Exception as exc:
        raise DomProbeError(f"request failed: {url}: {exc}") from exc


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_coverages(raw: bytes) -> list[dict[str, str]]:
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise DomProbeError("GetCapabilities is not valid XML") from exc
    result: list[dict[str, str]] = []
    for element in root.iter():
        if local_name(element.tag) != "CoverageOfferingBrief":
            continue
        values: dict[str, str] = {}
        for child in list(element):
            name = local_name(child.tag)
            if name in {"name", "label", "description"} and child.text and child.text.strip():
                values[name] = child.text.strip()
        if values.get("name"):
            result.append(values)
    if not result:
        raise DomProbeError("GetCapabilities advertises no WCS 1.0 CoverageOfferingBrief entries")
    return result


def choose_dom_25832(coverages: list[dict[str, str]]) -> dict[str, str]:
    matches = []
    for coverage in coverages:
        haystack = " ".join(
            str(coverage.get(key, "")) for key in ("name", "label", "description")
        ).casefold()
        if "dom" in haystack and "25832" in haystack:
            matches.append(coverage)
    if len(matches) != 1:
        raise DomProbeError(
            "expected exactly one DOM/25832 coverage, found "
            + json.dumps(matches, ensure_ascii=False, sort_keys=True)
        )
    return matches[0]


def probe() -> dict:
    capabilities_url = WCS_ENDPOINT + "?" + urlencode(
        {"SERVICE": "WCS", "VERSION": "1.0.0", "REQUEST": "GetCapabilities"}
    )
    cap_type, cap = request_xml(capabilities_url)
    coverages = parse_coverages(cap)
    selected = choose_dom_25832(coverages)
    coverage_id = selected["name"]

    describe_url = WCS_ENDPOINT + "?" + urlencode(
        {
            "SERVICE": "WCS",
            "VERSION": "1.0.0",
            "REQUEST": "DescribeCoverage",
            "COVERAGE": coverage_id,
        }
    )
    describe_type, describe = request_xml(describe_url)
    try:
        describe_root = ET.fromstring(describe)
    except ET.ParseError as exc:
        raise DomProbeError("DescribeCoverage is not valid XML") from exc
    describe_text = " ".join(
        (element.text or "").strip()
        for element in describe_root.iter()
        if (element.text or "").strip()
    )
    if coverage_id not in describe_text:
        raise DomProbeError("DescribeCoverage does not identify selected coverage")
    normalized = re.sub(r"\s+", "", describe_text).upper()
    if not any(token.replace(":", "").upper() in normalized.replace(":", "") for token in EXPECTED_CRS_TOKENS):
        raise DomProbeError("DescribeCoverage does not expose EPSG:25832 identity")

    return {
        "schema": "nwe.nhm-dom-wcs-source-probe/0.1",
        "status": "PASS",
        "publisher": "Statens kartverk",
        "role": "national-digital-surface-model",
        "endpoint": WCS_ENDPOINT,
        "protocol": "OGC WCS 1.0.0",
        "coverage": coverage_id,
        "coverage_label": selected.get("label"),
        "horizontal_crs": "EPSG:25832",
        "access": "public-service-probe",
        "capabilities_url": capabilities_url,
        "capabilities_content_type": cap_type,
        "capabilities_sha256": sha256(cap),
        "advertised_coverage_count": len(coverages),
        "describe_coverage_url": describe_url,
        "describe_coverage_content_type": describe_type,
        "describe_coverage_sha256": sha256(describe),
        "truth": "source-service-admission-only-no-dom-raster-downloaded",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    args = parser.parse_args()
    result = probe()
    encoded = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output:
        from pathlib import Path
        path = Path(args.output)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except DomProbeError as exc:
        print(f"NWE_NHM_DOM_PROBE_REJECTED: {exc}", file=__import__("sys").stderr)
        raise SystemExit(1)
