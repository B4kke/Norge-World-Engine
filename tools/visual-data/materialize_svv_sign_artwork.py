#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import zipfile
from pathlib import Path
from typing import Any

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}
_CODE_RE = re.compile(r"(?<!\d)([1-9]\d{2}(?:[._-]\d+)?)(?!\d)")


def normalize_provider_code(value: str) -> str:
    code = value.replace("_", ".").replace("-", ".").strip(".")
    while code.endswith(".0"):
        code = code[:-2]
    return code


def infer_sign_code(filename: str) -> str | None:
    match = _CODE_RE.search(Path(filename).stem)
    return normalize_provider_code(match.group(1)) if match else None


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def materialize(
    archive_path: Path,
    output_dir: Path,
    requested_codes: list[str],
    *,
    family: str,
    source_url: str,
    license_profile: str = "NLOD-1.0",
) -> dict[str, Any]:
    archive_raw = archive_path.read_bytes()
    archive_sha = sha256_bytes(archive_raw)
    normalized_requested = [normalize_provider_code(code) for code in requested_codes]
    if len(set(normalized_requested)) != len(normalized_requested):
        raise RuntimeError("SVV_SIGN_DUPLICATE_REQUEST_CODE")

    with zipfile.ZipFile(archive_path) as archive:
        bad = archive.testzip()
        if bad:
            raise RuntimeError(f"SVV_SIGN_ARCHIVE_CORRUPT:{bad}")
        candidates: dict[str, list[zipfile.ZipInfo]] = {}
        for info in archive.infolist():
            if info.is_dir() or Path(info.filename).suffix.lower() not in IMAGE_SUFFIXES:
                continue
            code = infer_sign_code(info.filename)
            if code:
                candidates.setdefault(code, []).append(info)

        unresolved = [code for code in normalized_requested if code not in candidates]
        if unresolved:
            raise RuntimeError(f"SVV_SIGN_CODES_UNRESOLVED:{','.join(unresolved)}")
        ambiguous = {
            code: [item.filename for item in candidates.get(code, [])]
            for code in normalized_requested
            if len(candidates.get(code, [])) != 1
        }
        if ambiguous:
            raise RuntimeError(f"SVV_SIGN_CODES_AMBIGUOUS:{json.dumps(ambiguous, sort_keys=True)}")

        output_dir.mkdir(parents=True, exist_ok=True)
        assets = []
        for code in normalized_requested:
            info = candidates[code][0]
            raw = archive.read(info)
            suffix = Path(info.filename).suffix.lower()
            if suffix == ".jpeg":
                suffix = ".jpg"
            destination = output_dir / f"{code}{suffix}"
            destination.write_bytes(raw)
            assets.append({
                "sign_code": code,
                "runtime_filename": destination.name,
                "source_archive_entry": info.filename,
                "sha256": sha256_bytes(raw),
                "byte_size": len(raw),
                "media_type": "image/png" if suffix == ".png" else "image/jpeg",
            })

    manifest = {
        "schema": "nwe.svv-sign-artwork-runtime-manifest/0.1",
        "status": "PASS",
        "family": family,
        "source_url": source_url,
        "source_archive_sha256": archive_sha,
        "license_profile": license_profile,
        "requested_sign_codes": normalized_requested,
        "assets": assets,
        "policy": {
            "mapping": "exactly one provider image entry must resolve for each normalized requested sign code; unresolved or ambiguous codes fail closed",
            "normalization": "provider filename suffix .0 is normalized only as an explicit base-sign variant, e.g. 202_0 -> NVDB 202",
            "runtime": "browser consumes materialized image bytes plus this manifest, never the provider ZIP",
            "truth_guard": "this manifest proves provider artwork identity, bytes and mapping only; physical plate size/orientation remain separate NVDB/render concerns",
        },
        "attribution": "Inneholder trafikkskiltgrafikk tilgjengeliggjort av Statens vegvesen under NLOD 1.0.",
    }
    encoded = json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    (output_dir / "manifest.json").write_text(encoded, encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--codes", required=True, help="Comma-separated NVDB sign codes, e.g. 202,206")
    parser.add_argument("--family", required=True)
    parser.add_argument("--source-url", required=True)
    args = parser.parse_args()
    codes = [item.strip() for item in args.codes.split(",") if item.strip()]
    if not codes:
        raise SystemExit("at least one sign code is required")
    if args.output_dir.exists():
        shutil.rmtree(args.output_dir)
    manifest = materialize(args.archive, args.output_dir, codes, family=args.family, source_url=args.source_url)
    print(json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
