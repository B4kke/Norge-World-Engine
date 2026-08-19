from __future__ import annotations

import hashlib
import html
import json
import re
import sys
import urllib.request

DTM1_DATASET_URL = (
    "https://data.norge.no/nb/datasets/"
    "1a7327eb-1fa5-3432-8dea-fc198a5ede13/hoyde-dtm1"
)
PUNKTSKY_SPEC_URL = (
    "https://dokument.geonorge.no/produktspesifikasjoner/"
    "punktsky/1.0.3/index.html"
)
EXPORT_HELP_URL = (
    "https://test.hoydedata.no/LaserInnsyn2/help_no/topics/idh-topic130.htm"
)
DOWNLOAD_HELP_URL = (
    "https://test.hoydedata.no/LaserInnsyn2/help_no/topics/idh-topic210.htm"
)
EXPORT_SERVICE_PDF_URL = "https://hoydedata.no/LaserInnsyn2/dok/webtjenester.pdf"


def _fetch(url: str) -> tuple[int, bytes]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "NorgeWorldEngine-FORGE/0.1 (+provider-generation-proof)"
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return getattr(response, "status", 200), response.read()


def _visible_text(payload: bytes) -> str:
    text = payload.decode("utf-8", errors="replace")
    text = re.sub(r"<script\b[^>]*>.*?</script>", " ", text, flags=re.I | re.S)
    text = re.sub(r"<style\b[^>]*>.*?</style>", " ", text, flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    return " ".join(html.unescape(text).split()).lower()


def _html_evidence(url: str, required_markers: dict[str, str]) -> dict:
    status, payload = _fetch(url)
    if status != 200:
        raise RuntimeError(f"provider source returned HTTP {status}: {url}")
    visible = _visible_text(payload)
    markers = {
        name: marker.lower() in visible for name, marker in required_markers.items()
    }
    missing = [name for name, present in markers.items() if not present]
    if missing:
        raise RuntimeError(
            f"provider source missing required markers ({', '.join(missing)}): {url}"
        )
    return {
        "url": url,
        "http_status": status,
        "source_bytes": len(payload),
        "source_sha256": hashlib.sha256(payload).hexdigest(),
        "markers": markers,
    }


def main() -> int:
    dtm1_dataset = _html_evidence(
        DTM1_DATASET_URL,
        {
            "project_grid_to_nhm1m": "prosjektgrid generaliseres ned til 1m nhm grid",
            "dtm1_atom_service": "dtm1 atom feed-tjeneste",
            "atom_nominal_15km": "dataene er delt opp i 15 km-ruter",
        },
    )
    punktsky_spec = _html_evidence(
        PUNKTSKY_SPEC_URL,
        {
            "nhm_update_rule": (
                "nhm oppdateres forteller hvorvidt høydedata.no automatisk oppdaterer "
                "nasjonal detaljert høydemodell"
            ),
            "automatic_fvl_derivation": "alle produkt avledes fra denne automatisk",
            "national_grid_artifact_warning": "artefakter i prosjektgrid og i nasjonale grid",
        },
    )
    export_help = _html_evidence(
        EXPORT_HELP_URL,
        {
            "national_model_stitched": (
                "nasjonale høydemodeller der alle aktuelle prosjekt er sydd sammen"
            ),
            "map_sheet_file_division": "klippe prosjektet til andre kartblad-inndelinger",
            "start_export_service": "starteksport",
        },
    )
    download_help = _html_evidence(
        DOWNLOAD_HELP_URL,
        {
            "dtm1_map_sheet_groups": (
                "dom1 og dtm1 er gruppert i blokker av filer basert på gruppering av "
                "nærliggende kartblad"
            ),
            "nhm_metadata_map_sheets": "nhm metadata inneholder kartbladinndelinger",
            "nhm_metadata_generation_projects": "prosjektene som er brukt til å generere nhm",
        },
    )

    pdf_status, pdf_payload = _fetch(EXPORT_SERVICE_PDF_URL)
    if pdf_status != 200:
        raise RuntimeError(f"export service PDF returned HTTP {pdf_status}")
    if not pdf_payload.startswith(b"%PDF"):
        raise RuntimeError("export service documentation is not a PDF")

    result = {
        "schema": "nwe.dtm1-nhm-generation-distribution-live-proof/0.1",
        "sources": {
            "dtm1_dataset": dtm1_dataset,
            "punktsky_spec": punktsky_spec,
            "export_help": export_help,
            "download_help": download_help,
            "export_service_pdf": {
                "url": EXPORT_SERVICE_PDF_URL,
                "http_status": pdf_status,
                "source_bytes": len(pdf_payload),
                "source_sha256": hashlib.sha256(pdf_payload).hexdigest(),
                "pdf_signature_valid": True,
                "semantic_parse_in_ci": False,
            },
        },
        "scope": {
            "generation_to_dtm1_source_family_live_supported": True,
            "nominal_atom_tile_m": 15_000,
            "export_configuration_document_reachable": True,
            "export_pdf_semantics_require_reviewed_text_or_pdf_extraction": True,
            "atom_export_byte_identity_proven": False,
            "authorizes_excess_border_discard": False,
            "production_seam_authority": False,
            "authority_status": "UNPROVEN",
        },
    }
    json.dump(result, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
