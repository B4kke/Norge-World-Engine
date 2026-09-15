#!/usr/bin/env python3
"""Acquire authored CC0 tree presentation assets into ignored local authoring cache.

The normal NWE runtime never contacts Poly Haven. This tool runs during authoring/setup,
downloads a catalog-pinned 1K glTF plus every relative buffer/image dependency, hashes
all bytes, and writes a local lock file below apps/unreal-runtime/Saved/NWE/PrivateVisual.
Nothing downloaded here is committed to Git.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import urllib.parse
import urllib.request
from typing import Any

CATALOG_SCHEMA = "nwe.unreal-visual-asset-catalog/0.1"
LOCK_SCHEMA = "nwe.unreal-visual-asset-lock/0.1"
ALLOWED_HOST = "dl.polyhaven.org"
USER_AGENT = "NorgeWorldEngine-VisualAssetAuthoring/0.1 (+https://github.com/B4kke/Norge-World-Engine)"
MAX_SINGLE_FILE_BYTES = 512 * 1024 * 1024
MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024


class VisualAssetError(RuntimeError):
    pass


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_catalog(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("schema") != CATALOG_SCHEMA:
        raise VisualAssetError("unsupported visual asset catalog schema")
    if value.get("provider") != "Poly Haven" or value.get("license") != "CC0-1.0":
        raise VisualAssetError("visual catalog must retain Poly Haven / CC0 identity")
    if value.get("runtime_policy") != "download-during-authoring-import-local-runtime-only":
        raise VisualAssetError("visual catalog runtime policy is not accepted")
    assets = value.get("assets")
    if not isinstance(assets, dict) or set(assets) != {"spruce", "pine", "deciduous"}:
        raise VisualAssetError("visual catalog must define spruce/pine/deciduous proxies")
    for asset_class, descriptor in assets.items():
        if not isinstance(descriptor, dict):
            raise VisualAssetError(f"{asset_class}: descriptor must be an object")
        source = urllib.parse.urlparse(str(descriptor.get("gltf_1k_url", "")))
        if source.scheme != "https" or source.hostname != ALLOWED_HOST or not source.path.endswith(".gltf"):
            raise VisualAssetError(f"{asset_class}: only pinned HTTPS Poly Haven glTF is accepted")
        if not str(descriptor.get("source_page", "")).startswith("https://polyhaven.com/a/"):
            raise VisualAssetError(f"{asset_class}: source page is invalid")
        if not descriptor.get("truth"):
            raise VisualAssetError(f"{asset_class}: truth boundary is required")
    return value


def safe_relative_uri(uri: str) -> Path:
    parsed = urllib.parse.urlparse(uri)
    if parsed.scheme or parsed.netloc:
        raise VisualAssetError(f"glTF dependency must be relative, got {uri!r}")
    decoded = urllib.parse.unquote(parsed.path)
    pure = PurePosixPath(decoded)
    if pure.is_absolute() or ".." in pure.parts or not pure.parts:
        raise VisualAssetError(f"unsafe glTF dependency path: {uri!r}")
    return Path(*pure.parts)


def download(url: str, destination: Path) -> dict[str, Any]:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != ALLOWED_HOST:
        raise VisualAssetError(f"refusing non-Poly-Haven download: {url}")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".partial")
    digest = hashlib.sha256()
    total = 0
    try:
        with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as handle:
            if response.status != 200:
                raise VisualAssetError(f"HTTP {response.status}: {url}")
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_SINGLE_FILE_BYTES:
                    raise VisualAssetError(f"asset file exceeds {MAX_SINGLE_FILE_BYTES} bytes: {url}")
                digest.update(chunk)
                handle.write(chunk)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return {"byte_size": total, "sha256": digest.hexdigest(), "url": url}


def dependency_uris(gltf: dict[str, Any]) -> list[str]:
    output: set[str] = set()
    for collection_name in ("buffers", "images"):
        collection = gltf.get(collection_name, [])
        if not isinstance(collection, list):
            raise VisualAssetError(f"glTF {collection_name} must be a list")
        for item in collection:
            if not isinstance(item, dict):
                continue
            uri = item.get("uri")
            if not isinstance(uri, str) or not uri or uri.startswith("data:"):
                continue
            safe_relative_uri(uri)
            output.add(uri)
    return sorted(output)


def verify_lock(lock_path: Path, cache_root: Path) -> dict[str, Any]:
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    if lock.get("schema") != LOCK_SCHEMA:
        raise VisualAssetError("unsupported local visual asset lock schema")
    assets = lock.get("assets")
    if not isinstance(assets, dict) or not assets:
        raise VisualAssetError("visual asset lock contains no assets")
    for asset_class, descriptor in assets.items():
        files = descriptor.get("files") if isinstance(descriptor, dict) else None
        if not isinstance(files, list) or not files:
            raise VisualAssetError(f"{asset_class}: lock contains no files")
        for file_descriptor in files:
            relative = Path(str(file_descriptor.get("path", "")))
            if relative.is_absolute() or ".." in relative.parts:
                raise VisualAssetError(f"{asset_class}: unsafe lock path")
            path = cache_root / relative
            if not path.is_file():
                raise VisualAssetError(f"{asset_class}: cached asset file missing: {path}")
            if path.stat().st_size != int(file_descriptor.get("byte_size", -1)):
                raise VisualAssetError(f"{asset_class}: cached asset byte-size mismatch: {path}")
            if sha256_path(path) != file_descriptor.get("sha256"):
                raise VisualAssetError(f"{asset_class}: cached asset SHA-256 mismatch: {path}")
    return lock


def acquire_asset(asset_class: str, descriptor: dict[str, Any], cache_root: Path) -> dict[str, Any]:
    slug = str(descriptor["slug"])
    asset_root = cache_root / "models" / asset_class / slug
    if asset_root.exists():
        shutil.rmtree(asset_root)
    asset_root.mkdir(parents=True, exist_ok=True)

    gltf_url = str(descriptor["gltf_1k_url"])
    gltf_name = Path(urllib.parse.urlparse(gltf_url).path).name
    gltf_path = asset_root / gltf_name
    primary = download(gltf_url, gltf_path)
    try:
        gltf = json.loads(gltf_path.read_text(encoding="utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise VisualAssetError(f"{asset_class}: downloaded glTF is invalid JSON: {exc}") from exc

    files = [
        {
            "path": str(gltf_path.relative_to(cache_root)).replace("\\", "/"),
            "byte_size": primary["byte_size"],
            "sha256": primary["sha256"],
            "role": "gltf",
        }
    ]
    total = primary["byte_size"]
    for uri in dependency_uris(gltf):
        relative_dependency = safe_relative_uri(uri)
        destination = asset_root / relative_dependency
        resolved_url = urllib.parse.urljoin(gltf_url, uri)
        info = download(resolved_url, destination)
        total += info["byte_size"]
        if total > MAX_TOTAL_BYTES:
            raise VisualAssetError(f"combined visual asset cache exceeds {MAX_TOTAL_BYTES} bytes")
        files.append(
            {
                "path": str(destination.relative_to(cache_root)).replace("\\", "/"),
                "byte_size": info["byte_size"],
                "sha256": info["sha256"],
                "role": "dependency",
            }
        )
    return {
        "slug": slug,
        "license": "CC0-1.0",
        "source_page": descriptor["source_page"],
        "truth": descriptor["truth"],
        "selection_policy": descriptor["selection_policy"],
        "gltf_path": str(gltf_path.relative_to(cache_root)).replace("\\", "/"),
        "total_byte_size": total,
        "files": files,
    }


def main() -> int:
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--catalog",
        type=Path,
        default=project_root / "Config" / "nannestad-visual-assets.json",
    )
    parser.add_argument(
        "--cache-root",
        type=Path,
        default=project_root / "Saved" / "NWE" / "PrivateVisual",
    )
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()

    catalog = require_catalog(args.catalog.resolve())
    cache_root = args.cache_root.resolve()
    lock_path = cache_root / "vegetation-assets.lock.json"
    if args.verify_only:
        lock = verify_lock(lock_path, cache_root)
        print(json.dumps({"status": "PASS", "mode": "verify-only", "lock": lock}, indent=2))
        return 0

    cache_root.mkdir(parents=True, exist_ok=True)
    assets: dict[str, Any] = {}
    for asset_class in ("spruce", "pine", "deciduous"):
        assets[asset_class] = acquire_asset(asset_class, catalog["assets"][asset_class], cache_root)
    lock = {
        "schema": LOCK_SCHEMA,
        "provider": catalog["provider"],
        "license": catalog["license"],
        "runtime_network_calls": 0,
        "cache_policy": "ignored-local-authoring-input",
        "assets": assets,
    }
    lock_path.write_text(json.dumps(lock, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    verify_lock(lock_path, cache_root)
    print(
        json.dumps(
            {
                "status": "PASS",
                "lock_path": str(lock_path),
                "asset_count": len(assets),
                "total_byte_size": sum(item["total_byte_size"] for item in assets.values()),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
