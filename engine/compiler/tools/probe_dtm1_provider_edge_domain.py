from __future__ import annotations

import hashlib
import html
import json
import re
import sys
import urllib.request

from nwe_compiler.dtm1_provider_edge_domain import assess_provider_edge_domain

DTM1_DATASET_URL = (
    "https://data.norge.no/nb/datasets/"
    "1a7327eb-1fa5-3432-8dea-fc198a5ede13/hoyde-dtm1"
)
FILESIZE_LIMIT_URL = "https://hoydedata.no/laserservices/Config/FilesizeLimit.json"
DTM_IMAGE_SERVER_URL = "https://hoydedata.no/arcgis/rest/services/DTM/ImageServer?f=pjson"
EXPORT_SERVICE_PDF_URL = "https://hoydedata.no/LaserInnsyn2/dok/webtjenester.pdf"
REVIEWED_EXPORT_PDF_SHA256 = "dd04d9513669a922e892cb3f64febefb4c19bb0e6227b6979f5b8e08aa7a0017"


def _fetch(url: str) -> tuple[int, bytes]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "NorgeWorldEngine-FORGE/0.1 (+edge-domain-proof)"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return getattr(response, "status", 200), response.read()


def _visible_text(payload: bytes) -> str:
    text = payload.decode("utf-8", errors="replace")
    text = re.sub(r"<script\b[^>]*>.*?</script>", " ", text, flags=re.I | re.S)
    text = re.sub(r"<style\b[^>]*>.*?</style>", " ", text, flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    return " ".join(html.unescape(text).split()).lower()


def _source_record(url: str, payload: bytes, status: int) -> dict:
    return {
        "url": url,
        "http_status": status,
        "source_bytes": len(payload),
        "source_sha256": hashlib.sha256(payload).hexdigest(),
    }


def main() -> int:
    dataset_status, dataset_payload = _fetch(DTM1_DATASET_URL)
    if dataset_status != 200:
        raise RuntimeError(f"DTM1 dataset returned HTTP {dataset_status}")
    dataset_text = _visible_text(dataset_payload)
    dataset_markers = {
        "dtm1_atom_service": "dtm1 atom feed-tjeneste" in dataset_text,
        "nominal_15km": "dataene er delt opp i 15 km-ruter" in dataset_text,
    }
    if not all(dataset_markers.values()):
        raise RuntimeError("DTM1 dataset no longer exposes the required Atom/15 km semantics")

    config_status, config_payload = _fetch(FILESIZE_LIMIT_URL)
    if config_status != 200:
        raise RuntimeError(f"FilesizeLimit config returned HTTP {config_status}")
    config_text = config_payload.decode("utf-8", errors="strict")
    if "maptileArea" not in config_text:
        raise RuntimeError("provider export config no longer exposes maptileArea")
    match = re.search(r"\b15000\s*:\s*[\"'](\d+)[\"']", config_text)
    if match is None:
        raise RuntimeError("provider export config lacks the 15000 map-tile entry")
    maptile_area_m2 = int(match.group(1))
    if maptile_area_m2 != 225_000_000:
        raise RuntimeError(
            f"provider 15000 map-tile area changed: {maptile_area_m2} != 225000000"
        )

    service_status, service_payload = _fetch(DTM_IMAGE_SERVER_URL)
    if service_status != 200:
        raise RuntimeError(f"DTM ImageServer returned HTTP {service_status}")
    service = json.loads(service_payload.decode("utf-8"))
    max_width = int(service.get("maxImageWidth", 0))
    max_height = int(service.get("maxImageHeight", 0))
    if (max_width, max_height) != (15_000, 15_000):
        raise RuntimeError(
            f"DTM ImageServer 15000 output constraint changed: {max_width}x{max_height}"
        )

    pdf_status, pdf_payload = _fetch(EXPORT_SERVICE_PDF_URL)
    if pdf_status != 200 or not pdf_payload.startswith(b"%PDF"):
        raise RuntimeError("reviewed StartExport documentation is unavailable or not a PDF")
    pdf_sha = hashlib.sha256(pdf_payload).hexdigest()
    if pdf_sha != REVIEWED_EXPORT_PDF_SHA256:
        raise RuntimeError(
            "StartExport documentation changed; re-review MapsheetSize=0/original-partition semantics"
        )

    contract = assess_provider_edge_domain(
        provider_nominal_tile_m=15_000,
        source_raster_width_px=15_010,
        source_raster_height_px=15_010,
        pixel_size_m=1.0,
        export_maptile_size_m=15_000,
        export_maptile_area_m2=maptile_area_m2,
        export_original_partition_control_present=True,
        service_max_image_width_px=max_width,
        service_max_image_height_px=max_height,
        explicit_excess_border_semantics_present=False,
        explicit_core_domain_authoritative=False,
        explicit_semantics_source_family_bound=False,
        explicit_buffer_per_side_m=None,
    )
    if contract["evidence"]["authorizes_core_clip"]:
        raise RuntimeError("live evidence must not silently authorize DTM1 core clipping")

    result = {
        "schema": "nwe.dtm1-provider-edge-domain-live-proof/0.1",
        "sources": {
            "dtm1_dataset": {
                **_source_record(DTM1_DATASET_URL, dataset_payload, dataset_status),
                "markers": dataset_markers,
            },
            "export_filesize_limit": {
                **_source_record(FILESIZE_LIMIT_URL, config_payload, config_status),
                "maptile_size_m": 15_000,
                "maptile_area_m2": maptile_area_m2,
            },
            "dtm_image_server": {
                **_source_record(DTM_IMAGE_SERVER_URL, service_payload, service_status),
                "max_image_width_px": max_width,
                "max_image_height_px": max_height,
                "source_authority": False,
                "role": "supporting service-domain signal only",
            },
            "reviewed_start_export_pdf": {
                **_source_record(EXPORT_SERVICE_PDF_URL, pdf_payload, pdf_status),
                "reviewed_sha256": REVIEWED_EXPORT_PDF_SHA256,
                "reviewed_semantic": "MapsheetSize=0 means dataset original partitioning",
            },
        },
        "repository_measurement_input": {
            "source_raster_width_px": 15_010,
            "source_raster_height_px": 15_010,
            "pixel_size_m": 1.0,
            "measurement_is_live_repeated_here": False,
        },
        "contract": contract,
        "scope": {
            "provider_15000_domain_signals_live_supported": contract["evidence"][
                "provider_15000_domain_signals_consistent"
            ],
            "centered_core_inset_px": contract["evidence"]["centered_core_inset_px"],
            "explicit_excess_border_semantics_present": False,
            "authorizes_core_clip": False,
            "production_seam_authority": False,
            "authority_status": "UNPROVEN",
        },
    }
    json.dump(result, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
