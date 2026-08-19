from __future__ import annotations

import hashlib
import html
import json
import re
import sys
import urllib.request

SOURCE_URL = (
    "https://data.norge.no/nb/data-services/"
    "8cf50db2-aa33-3320-b5f9-dc47adb080b3/"
    "hoydedata-laser-digital-terrengmodell-wms"
)


def _visible_text(payload: bytes) -> str:
    text = payload.decode("utf-8", errors="replace")
    text = re.sub(r"<script\b[^>]*>.*?</script>", " ", text, flags=re.I | re.S)
    text = re.sub(r"<style\b[^>]*>.*?</style>", " ", text, flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return " ".join(text.split())


def main() -> int:
    request = urllib.request.Request(
        SOURCE_URL,
        headers={"User-Agent": "NorgeWorldEngine-FORGE/0.1 (+provider-metadata-proof)"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = response.read()
        status = getattr(response, "status", 200)

    visible = _visible_text(payload)
    lower = visible.lower()
    markers = {
        "latest_project_display": "siste prosjekt vises" in lower,
        "updates_national_height_model": "oppdaterer nasjonal høydemodell" in lower,
        "digital_terrain_model_service": "digitale terrengmodellen" in lower,
    }
    if status != 200:
        raise RuntimeError(f"provider metadata returned HTTP {status}")
    missing = [name for name, present in markers.items() if not present]
    if missing:
        raise RuntimeError(f"provider metadata missing required semantics: {', '.join(missing)}")

    result = {
        "schema": "nwe.dtm1-nhm-update-scope-live-proof/0.1",
        "source_url": SOURCE_URL,
        "http_status": status,
        "source_bytes": len(payload),
        "source_sha256": hashlib.sha256(payload).hexdigest(),
        "markers": markers,
        "scope": {
            "nhm_update_semantics_supported": True,
            "downloadable_dtm1_source_bound": False,
            "explicit_dtm1_overlap_rule": False,
            "production_seam_authority": False,
            "authority_status": "UNPROVEN",
        },
    }
    json.dump(result, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
