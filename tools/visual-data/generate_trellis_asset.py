#!/usr/bin/env python3
"""Generate one presentation-only GLB through a locally running NVIDIA TRELLIS NIM.

The NIM itself is external tooling. This script deliberately talks only to an
operator-started local endpoint and never stores NGC/API credentials.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import struct
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

SCHEMA = "nwe.ai-generated-presentation-asset/0.1"
DEFAULT_ENDPOINT = "http://127.0.0.1:8000/v1/infer"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def validate_glb(data: bytes) -> dict[str, int]:
    if len(data) < 12:
        raise ValueError("TRELLIS_GLB_TOO_SMALL")
    magic, version, declared_length = struct.unpack("<4sII", data[:12])
    if magic != b"glTF":
        raise ValueError("TRELLIS_GLB_MAGIC_INVALID")
    if version != 2:
        raise ValueError(f"TRELLIS_GLB_VERSION_UNSUPPORTED:{version}")
    if declared_length != len(data):
        raise ValueError(f"TRELLIS_GLB_LENGTH_MISMATCH:{declared_length}!={len(data)}")
    return {"glb_version": version, "byte_size": len(data)}


def decode_first_artifact(payload: dict[str, Any]) -> bytes:
    artifacts = payload.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        raise ValueError("TRELLIS_RESPONSE_ARTIFACT_MISSING")
    encoded = artifacts[0].get("base64") if isinstance(artifacts[0], dict) else None
    if not isinstance(encoded, str) or not encoded:
        raise ValueError("TRELLIS_RESPONSE_BASE64_MISSING")
    try:
        return base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise ValueError("TRELLIS_RESPONSE_BASE64_INVALID") from exc


def is_loopback_endpoint(endpoint: str) -> bool:
    parsed = urllib.parse.urlsplit(endpoint)
    return parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}


def invoke_local_trellis(endpoint: str, prompt: str, seed: int, timeout_seconds: float) -> dict[str, Any]:
    if not is_loopback_endpoint(endpoint):
        raise ValueError("TRELLIS_REMOTE_ENDPOINT_FORBIDDEN")
    body = json.dumps({"prompt": prompt, "seed": seed}, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={"Accept": "application/json", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        if getattr(response, "status", 200) != 200:
            raise RuntimeError(f"TRELLIS_HTTP_{getattr(response, 'status', 'UNKNOWN')}")
        return json.loads(response.read().decode("utf-8"))


def build_manifest(*, glb: bytes, output_name: str, prompt: str, seed: int, role: str, endpoint: str) -> dict[str, Any]:
    info = validate_glb(glb)
    return {
        "schema": SCHEMA,
        "status": "GENERATED_UNREVIEWED",
        "asset": {
            "path": output_name,
            "sha256": sha256_bytes(glb),
            "byte_size": len(glb),
            "glb_version": info["glb_version"],
            "intended_role": role,
        },
        "generator": {
            "provider_surface": "NVIDIA NIM local deployment",
            "model": "microsoft/trellis",
            "mode": "text-to-3d",
            "seed": seed,
            "prompt": prompt,
            "endpoint_semantics": "operator-started-loopback-only",
            "endpoint": endpoint,
        },
        "licensing": {
            "model_card_terms": "NVIDIA Community Model License; additional information: MIT",
            "generated_asset_license_review_required": True,
        },
        "truth": {
            "classification": "presentation-only-generated-asset",
            "geographic_source_truth": False,
            "allowed_use": "generic reusable visual prop after human/automated asset QA",
            "forbidden_claim": "generated geometry must not be represented as surveyed or source-observed Norwegian geometry",
        },
        "admission": {
            "runtime_ready": False,
            "required_next": [
                "visual review",
                "scale/orientation check",
                "triangle/material/texture budget check",
                "LOD/retopology decision",
                "license/terms review",
                "runtime asset manifest promotion",
            ],
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--role", required=True, help="Generic presentation role, e.g. norwegian-road-sign-support-prop")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--timeout-seconds", type=float, default=300.0)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    response = invoke_local_trellis(args.endpoint, args.prompt, args.seed, args.timeout_seconds)
    glb = decode_first_artifact(response)
    manifest = build_manifest(
        glb=glb,
        output_name=args.output.name,
        prompt=args.prompt,
        seed=args.seed,
        role=args.role,
        endpoint=args.endpoint,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(glb)
    manifest_path = args.output.with_suffix(args.output.suffix + ".nwe.json")
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": "PASS",
        "glb": str(args.output),
        "manifest": str(manifest_path),
        "sha256": manifest["asset"]["sha256"],
        "runtime_ready": False,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
