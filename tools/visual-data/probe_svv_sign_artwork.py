#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import zipfile
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

SOURCE_PAGE = "https://www.vegvesen.no/fag/veg-og-gate/trafikkskilt-og-vegoppmerking/filer-og-fargekoder-for-trafikkskilt/"
DATASET_PAGE = "https://dataut.vegvesen.no/dataset/trafikkskilt"
LICENSE_PROFILE = "NLOD-1.0"
USER_AGENT = "NorgeWorldEngine/0.1 sign-artwork-probe"

ARCHIVES = {
    "fare": "https://www.vegvesen.no/globalassets/fag/veg-og-gate/trafikkskilt-og-vegoppmerking/fareskilt-jpg.zip?v=499399",
    "vikeplikt": "https://www.vegvesen.no/globalassets/fag/veg-og-gate/trafikkskilt-og-vegoppmerking/vikeplikt-jpg.zip?v=49939c",
    "forbud": "https://www.vegvesen.no/globalassets/fag/veg-og-gate/trafikkskilt-og-vegoppmerking/forbudsskilt-jpg-png.zip?v=4a9199",
    "pabud": "https://www.vegvesen.no/globalassets/fag/veg-og-gate/trafikkskilt-og-vegoppmerking/pabudsskilt-jpg.zip?v=49937d",
    "opplysning": "https://www.vegvesen.no/globalassets/fag/veg-og-gate/trafikkskilt-og-vegoppmerking/opplysningsskilt-jpg.zip?v=499380",
    "service": "https://www.vegvesen.no/globalassets/fag/veg-og-gate/trafikkskilt-og-vegoppmerking/serviceskilt-jpg.zip?v=499384",
    "vegvisning": "https://www.vegvesen.no/globalassets/fag/veg-og-gate/trafikkskilt-og-vegoppmerking/vegvisningsskilt-jpg.zip?v=499387",
    "underskilt": "https://www.vegvesen.no/globalassets/fag/veg-og-gate/trafikkskilt-og-vegoppmerking/underskilt-jpg-og-png.zip?v=4a841c",
    "markering": "https://www.vegvesen.no/globalassets/fag/veg-og-gate/trafikkskilt-og-vegoppmerking/markeringsskilt-jpg.zip?v=49938d",
}

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}
_CODE_RE = re.compile(r"(?<!\d)([1-9]\d{2}(?:[._-]\d+)?)(?!\d)")


def fetch_bytes(url: str, timeout: int = 120) -> bytes:
    request = Request(url, headers={"Accept": "application/zip,*/*;q=0.8", "User-Agent": USER_AGENT})
    with urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError(f"SVV HTTP {response.status}: {url}")
        return response.read()


def infer_sign_code(filename: str) -> str | None:
    stem = Path(filename).stem
    match = _CODE_RE.search(stem)
    if not match:
        return None
    return match.group(1).replace("_", ".").replace("-", ".")


def inspect_archive(raw: bytes, *, family: str, url: str) -> dict[str, Any]:
    if not raw.startswith(b"PK"):
        raise RuntimeError("SVV_SIGN_ARCHIVE_NOT_ZIP")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        bad = archive.testzip()
        if bad:
            raise RuntimeError(f"SVV_SIGN_ARCHIVE_CORRUPT:{bad}")
        files = [info for info in archive.infolist() if not info.is_dir()]
        images = [info for info in files if Path(info.filename).suffix.lower() in IMAGE_SUFFIXES]
        inferred: dict[str, list[str]] = {}
        for info in images:
            code = infer_sign_code(info.filename)
            if code:
                inferred.setdefault(code, []).append(info.filename)
        return {
            "schema": "nwe.svv-sign-artwork-probe/0.1",
            "status": "PASS" if images else "NO_IMAGES",
            "family": family,
            "source_url": url,
            "source_page": SOURCE_PAGE,
            "dataset_page": DATASET_PAGE,
            "license_profile": LICENSE_PROFILE,
            "raw_sha256": hashlib.sha256(raw).hexdigest(),
            "raw_byte_size": len(raw),
            "file_count": len(files),
            "image_file_count": len(images),
            "inferred_sign_code_count": len(inferred),
            "inferred_sign_codes": dict(sorted(inferred.items())),
            "sample_entries": [info.filename for info in images[:40]],
            "policy": {
                "admission": "archive bytes are provider-authored artwork source evidence; filenames/codes are inspected before any runtime mapping is admitted",
                "runtime": "raw provider ZIP is preprocessing input only and must not be fetched by the browser runtime",
                "truth_guard": "filename inference is candidate mapping only; exact NVDB Skiltnummer to artwork mapping remains fail-closed until validated",
            },
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--family", choices=sorted(ARCHIVES), default="vikeplikt")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()
    url = ARCHIVES[args.family]
    if args.cache and args.cache.exists():
        raw = args.cache.read_bytes()
    else:
        raw = fetch_bytes(url, timeout=args.timeout)
        if args.cache:
            args.cache.parent.mkdir(parents=True, exist_ok=True)
            args.cache.write_bytes(raw)
    result = inspect_archive(raw, family=args.family, url=url)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False))
    return 0 if result["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
