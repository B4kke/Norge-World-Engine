#!/usr/bin/env python3
"""Acquire a legal no-key Sentinel-2 ground-color fallback for Nannestad.

This is a presentation fallback, not orthophoto truth. The tool queries Element 84
Earth Search for public Copernicus Sentinel-2 L2A scenes, selects a low-cloud
summer scene, reads only the accepted 1x1 km tile from public HTTPS COG assets,
writes a local 10 m RGB GeoTIFF, then delegates the exact EPSG:25832/PNG bake to
prepare_ground_imagery.py.

All generated/source-cache files stay below apps/unreal-runtime/Saved and are
ignored by Git. A user-supplied lawful orthophoto remains the preferred path.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
from typing import Any
from urllib.request import Request, urlopen

import numpy as np
from pyproj import Transformer
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject


STAC_ROOT = "https://earth-search.aws.element84.com/v1"
STAC_SEARCH_URL = f"{STAC_ROOT}/search"
DEFAULT_COLLECTIONS = ("sentinel-2-c1-l2a", "sentinel-2-l2a")
TARGET_CRS = "EPSG:25832"
TARGET_BOUNDS = (611000.0, 6677000.0, 612000.0, 6678000.0)
TARGET_NATIVE_SIZE = 100  # Sentinel-2 RGB/visual ground sampling is 10 m.
USER_AGENT = "NorgeWorldEngine-SentinelAuthoring/0.1 (+https://github.com/B4kke/Norge-World-Engine)"
SELECTION_SCHEMA = "nwe.sentinel-ground-selection/0.1"
GROUND_SCHEMA = "nwe.private-ground-imagery/0.1"
COPERNICUS_RIGHTS_BASIS = (
    "Copernicus Sentinel data licence: free, full and open lawful use; "
    "public distribution of modified data requires source notice."
)


class SentinelGroundError(RuntimeError):
    pass


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def target_bbox_wgs84() -> tuple[float, float, float, float]:
    transformer = Transformer.from_crs(TARGET_CRS, "EPSG:4326", always_xy=True)
    min_e, min_n, max_e, max_n = TARGET_BOUNDS
    corners = [
        transformer.transform(min_e, min_n),
        transformer.transform(min_e, max_n),
        transformer.transform(max_e, min_n),
        transformer.transform(max_e, max_n),
    ]
    return (
        min(point[0] for point in corners),
        min(point[1] for point in corners),
        max(point[0] for point in corners),
        max(point[1] for point in corners),
    )


def default_search_window(today: date | None = None) -> tuple[str, str]:
    today = today or datetime.now(timezone.utc).date()
    if today.month < 5 or (today.month == 5 and today.day < 15):
        end_year = today.year - 1
        end = date(end_year, 9, 15)
    else:
        end = min(today, date(today.year, 9, 15))
        end_year = end.year
    start = date(end_year - 2, 5, 15)
    return start.isoformat(), end.isoformat()


def _request_json(url: str, *, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/geo+json, application/json",
    }
    if data is not None:
        headers["Content-Type"] = "application/json"
    request = Request(url, data=data, headers=headers, method="POST" if data is not None else "GET")
    try:
        with urlopen(request, timeout=90) as response:
            if getattr(response, "status", 200) != 200:
                raise SentinelGroundError(f"HTTP {response.status}: {url}")
            value = json.loads(response.read().decode("utf-8"))
    except SentinelGroundError:
        raise
    except Exception as exc:
        raise SentinelGroundError(f"request failed: {url}: {exc}") from exc
    if not isinstance(value, dict):
        raise SentinelGroundError(f"JSON response is not an object: {url}")
    return value


def search_items(
    *,
    collection: str,
    start_date: str,
    end_date: str,
    fetch_json=_request_json,
) -> list[dict[str, Any]]:
    response = fetch_json(
        STAC_SEARCH_URL,
        payload={
            "collections": [collection],
            "bbox": list(target_bbox_wgs84()),
            "datetime": f"{start_date}T00:00:00Z/{end_date}T23:59:59Z",
            "limit": 100,
        },
    )
    features = response.get("features")
    if not isinstance(features, list):
        raise SentinelGroundError("Earth Search response has no features list")
    return [item for item in features if isinstance(item, dict)]


def _item_datetime(item: dict[str, Any]) -> datetime:
    raw = (item.get("properties") or {}).get("datetime")
    if not isinstance(raw, str) or not raw:
        raise SentinelGroundError(f"STAC item {item.get('id')!r} has no datetime")
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise SentinelGroundError(f"STAC item {item.get('id')!r} has invalid datetime") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _https_asset(asset: Any) -> bool:
    return (
        isinstance(asset, dict)
        and isinstance(asset.get("href"), str)
        and asset["href"].startswith("https://")
    )


def asset_plan(item: dict[str, Any]) -> dict[str, Any] | None:
    assets = item.get("assets")
    if not isinstance(assets, dict):
        return None
    visual = assets.get("visual")
    if _https_asset(visual):
        return {"mode": "visual", "assets": {"visual": visual}}
    rgb = {key: assets.get(key) for key in ("red", "green", "blue")}
    if all(_https_asset(asset) for asset in rgb.values()):
        return {"mode": "reflectance-rgb", "assets": rgb}
    return None


def select_item(
    items: list[dict[str, Any]],
    *,
    max_cloud_percent: float,
) -> tuple[dict[str, Any], dict[str, Any]]:
    candidates: list[tuple[tuple[float, int, float, str], dict[str, Any], dict[str, Any]]] = []
    for item in items:
        item_id = item.get("id")
        if not isinstance(item_id, str) or not item_id:
            continue
        try:
            captured = _item_datetime(item)
        except SentinelGroundError:
            continue
        if captured.month < 5 or captured.month > 9:
            continue
        raw_cloud = (item.get("properties") or {}).get("eo:cloud_cover")
        if isinstance(raw_cloud, bool) or not isinstance(raw_cloud, (int, float)):
            continue
        cloud = float(raw_cloud)
        if not math.isfinite(cloud) or cloud < 0 or cloud > max_cloud_percent:
            continue
        plan = asset_plan(item)
        if plan is None:
            continue
        midsummer = datetime(captured.year, 7, 15, tzinfo=timezone.utc)
        seasonal_distance = abs((captured - midsummer).days)
        score = (cloud, seasonal_distance, -captured.timestamp(), item_id)
        candidates.append((score, item, plan))
    if not candidates:
        raise SentinelGroundError(
            f"no May-September Sentinel-2 L2A scene <= {max_cloud_percent:.1f}% cloud "
            "with public HTTPS visual/RGB COG assets covers Nannestad"
        )
    candidates.sort(key=lambda entry: entry[0])
    _, item, plan = candidates[0]
    return item, plan


def _raster_band_scale(asset: dict[str, Any]) -> tuple[float, float]:
    bands = asset.get("raster:bands")
    descriptor = bands[0] if isinstance(bands, list) and bands and isinstance(bands[0], dict) else {}
    scale = descriptor.get("scale", 0.0001)
    offset = descriptor.get("offset", 0.0)
    try:
        scale = float(scale)
        offset = float(offset)
    except (TypeError, ValueError) as exc:
        raise SentinelGroundError("invalid STAC raster scale/offset") from exc
    if not math.isfinite(scale) or scale <= 0 or not math.isfinite(offset):
        raise SentinelGroundError("invalid STAC raster scale/offset")
    return scale, offset


def _reproject_remote_band(href: str, *, band_index: int = 1, dtype=np.float32) -> np.ndarray:
    destination = np.zeros((TARGET_NATIVE_SIZE, TARGET_NATIVE_SIZE), dtype=dtype)
    target_transform = from_bounds(*TARGET_BOUNDS, TARGET_NATIVE_SIZE, TARGET_NATIVE_SIZE)
    env = {
        "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
        "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif,.tiff",
        "GDAL_HTTP_MULTIRANGE": "YES",
        "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    }
    try:
        with rasterio.Env(**env), rasterio.open(href) as source:
            if source.crs is None:
                raise SentinelGroundError(f"Sentinel COG has no CRS: {href}")
            reproject(
                source=rasterio.band(source, band_index),
                destination=destination,
                src_transform=source.transform,
                src_crs=source.crs,
                src_nodata=source.nodata,
                dst_transform=target_transform,
                dst_crs=TARGET_CRS,
                dst_nodata=0,
                resampling=Resampling.bilinear,
            )
    except SentinelGroundError:
        raise
    except Exception as exc:
        raise SentinelGroundError(f"could not window/reproject public Sentinel COG {href}: {exc}") from exc
    return destination


def compose_reflectance_rgb(
    raw_rgb: dict[str, np.ndarray],
    assets: dict[str, dict[str, Any]],
) -> np.ndarray:
    channels: list[np.ndarray] = []
    for key in ("red", "green", "blue"):
        scale, offset = _raster_band_scale(assets[key])
        reflectance = raw_rgb[key].astype(np.float32) * scale + offset
        # Presentation-only natural-color stretch. It does not modify world
        # geometry and is recorded in provenance.
        display = np.clip(reflectance / 0.30, 0.0, 1.0)
        display = np.power(display, 1.0 / 2.2)
        channels.append(np.rint(display * 255.0).astype(np.uint8))
    return np.stack(channels, axis=0)


def materialize_selected_source(
    item: dict[str, Any],
    plan: dict[str, Any],
    destination: Path,
) -> dict[str, Any]:
    destination = destination.resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    mode = plan["mode"]
    assets = plan["assets"]
    if mode == "visual":
        href = assets["visual"]["href"]
        first = _reproject_remote_band(href, band_index=1, dtype=np.uint8)
        second = _reproject_remote_band(href, band_index=2, dtype=np.uint8)
        third = _reproject_remote_band(href, band_index=3, dtype=np.uint8)
        rgb = np.stack((first, second, third), axis=0)
        display_transform = "earth-search-visual-cog-rgb8"
    elif mode == "reflectance-rgb":
        raw = {
            key: _reproject_remote_band(asset["href"], band_index=1, dtype=np.float32)
            for key, asset in assets.items()
        }
        rgb = compose_reflectance_rgb(raw, assets)
        display_transform = "sentinel-l2a-reflectance-scale-offset-0.30-stretch-gamma2.2"
    else:
        raise SentinelGroundError(f"unsupported Sentinel asset plan mode: {mode!r}")

    transform = from_bounds(*TARGET_BOUNDS, TARGET_NATIVE_SIZE, TARGET_NATIVE_SIZE)
    with rasterio.open(
        destination,
        "w",
        driver="GTiff",
        width=TARGET_NATIVE_SIZE,
        height=TARGET_NATIVE_SIZE,
        count=3,
        dtype="uint8",
        crs=TARGET_CRS,
        transform=transform,
        compress="deflate",
        tiled=False,
    ) as target:
        target.write(rgb)

    return {
        "source_tile_path": str(destination),
        "source_tile_sha256": sha256_path(destination),
        "source_tile_byte_size": destination.stat().st_size,
        "native_ground_sample_distance_m": 10.0,
        "display_transform": display_transform,
        "asset_mode": mode,
        "asset_keys": sorted(assets),
        "asset_hrefs": {key: assets[key]["href"] for key in sorted(assets)},
    }


def _valid_cached_ground(ground_root: Path) -> dict[str, Any] | None:
    manifest_path = ground_root / "ground-imagery.json"
    if not manifest_path.is_file():
        return None
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    source = manifest.get("source")
    texture = manifest.get("texture")
    if (
        manifest.get("schema") != GROUND_SCHEMA
        or not isinstance(source, dict)
        or source.get("provider") != "Copernicus Sentinel-2 via Earth Search"
        or not isinstance(texture, dict)
    ):
        return None
    texture_path = ground_root / str(texture.get("path") or "")
    if (
        not texture_path.is_file()
        or texture_path.stat().st_size != int(texture.get("byte_size") or -1)
        or sha256_path(texture_path) != texture.get("sha256")
    ):
        return None
    return manifest


def acquire(
    *,
    project_root: Path,
    start_date: str,
    end_date: str,
    max_cloud_percent: float,
    collections: tuple[str, ...],
    refresh: bool,
    item_id: str | None = None,
    fetch_json=_request_json,
) -> dict[str, Any]:
    visual_root = project_root / "Saved" / "NWE" / "PrivateVisual"
    ground_root = visual_root / "ground"
    source_root = visual_root / "sentinel-source"
    if not refresh:
        cached = _valid_cached_ground(ground_root)
        if cached is not None:
            return {"status": "PASS", "mode": "verified-cache-hit", "manifest": cached}

    selected_item = None
    selected_plan = None
    selected_collection = None
    if item_id:
        for collection in collections:
            try:
                candidate = fetch_json(f"{STAC_ROOT}/collections/{collection}/items/{item_id}")
            except SentinelGroundError:
                continue
            plan = asset_plan(candidate)
            if plan is not None:
                selected_item, selected_plan, selected_collection = candidate, plan, collection
                break
        if selected_item is None:
            raise SentinelGroundError(f"requested Sentinel item {item_id!r} was not found with usable HTTPS COG assets")
    else:
        errors: list[str] = []
        for collection in collections:
            try:
                items = search_items(
                    collection=collection,
                    start_date=start_date,
                    end_date=end_date,
                    fetch_json=fetch_json,
                )
                candidate, plan = select_item(items, max_cloud_percent=max_cloud_percent)
            except SentinelGroundError as exc:
                errors.append(f"{collection}: {exc}")
                continue
            selected_item, selected_plan, selected_collection = candidate, plan, collection
            break
        if selected_item is None:
            raise SentinelGroundError("; ".join(errors) or "no Sentinel collection produced a candidate")

    captured = _item_datetime(selected_item)
    cloud = float((selected_item.get("properties") or {}).get("eo:cloud_cover"))
    source_tif = source_root / f"{selected_item['id']}.tif"
    materialized = materialize_selected_source(selected_item, selected_plan, source_tif)

    prepare_tool = project_root / "Tools" / "prepare_ground_imagery.py"
    command = [
        sys.executable,
        str(prepare_tool),
        "--source",
        str(source_tif),
        "--source-name",
        f"Copernicus Sentinel-2 L2A {selected_item['id']}",
        "--rights-basis",
        COPERNICUS_RIGHTS_BASIS,
        "--redistribution",
        "allowed-by-license",
        "--output-root",
        str(ground_root),
        "--output-size",
        "2048",
    ]
    completed = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if completed.returncode != 0:
        raise SentinelGroundError(
            "ground imagery bake failed: "
            + (completed.stderr.strip() or completed.stdout.strip() or f"exit {completed.returncode}")
        )

    ground_manifest_path = ground_root / "ground-imagery.json"
    ground_manifest = json.loads(ground_manifest_path.read_text(encoding="utf-8"))
    source = ground_manifest.setdefault("source", {})
    source.update(
        {
            "provider": "Copernicus Sentinel-2 via Earth Search",
            "stac_api": STAC_ROOT,
            "stac_collection": selected_collection,
            "stac_item_id": selected_item["id"],
            "stac_datetime": captured.isoformat().replace("+00:00", "Z"),
            "eo_cloud_cover_percent": cloud,
            "copernicus_notice": f"Contains modified Copernicus Sentinel data {captured.year}",
            "selection_policy": (
                "May-September; scene cloud cover ascending; distance to July 15 ascending; "
                "capture time newest tie-break"
            ),
            "search_window": {"start_date": start_date, "end_date": end_date},
            **materialized,
        }
    )
    ground_manifest.setdefault("transform", {})["sentinel_ground_truth"] = (
        "presentation-only-10m-satellite-ground-color-not-orthophoto"
    )
    ground_manifest_path.write_text(
        json.dumps(ground_manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    selection = {
        "schema": SELECTION_SCHEMA,
        "status": "PASS",
        "stac_collection": selected_collection,
        "stac_item_id": selected_item["id"],
        "stac_datetime": source["stac_datetime"],
        "eo_cloud_cover_percent": cloud,
        "search_window": source["search_window"],
        "bbox_wgs84": list(target_bbox_wgs84()),
        "tile_bounds_epsg25832": list(TARGET_BOUNDS),
        "asset_mode": materialized["asset_mode"],
        "asset_keys": materialized["asset_keys"],
        "asset_hrefs": materialized["asset_hrefs"],
        "source_tile_sha256": materialized["source_tile_sha256"],
        "ground_texture_sha256": ground_manifest["texture"]["sha256"],
        "copernicus_notice": source["copernicus_notice"],
        "truth": "presentation-only-ground-color-fallback-not-orthophoto",
    }
    selection_path = source_root / "sentinel-selection.json"
    selection_path.write_text(json.dumps(selection, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return {
        "status": "PASS",
        "mode": "acquired",
        "selection_path": str(selection_path),
        "ground_manifest_path": str(ground_manifest_path),
        "selection": selection,
    }


def main() -> int:
    project_root = Path(__file__).resolve().parents[1]
    default_start, default_end = default_search_window()
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-date", default=default_start)
    parser.add_argument("--end-date", default=default_end)
    parser.add_argument("--max-cloud-percent", type=float, default=20.0)
    parser.add_argument("--collection", action="append", dest="collections")
    parser.add_argument("--item-id")
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    if not (0.0 <= args.max_cloud_percent <= 100.0):
        parser.error("--max-cloud-percent must be between 0 and 100")

    result = acquire(
        project_root=project_root,
        start_date=args.start_date,
        end_date=args.end_date,
        max_cloud_percent=args.max_cloud_percent,
        collections=tuple(args.collections or DEFAULT_COLLECTIONS),
        refresh=args.refresh,
        item_id=args.item_id,
    )
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SentinelGroundError as exc:
        print(f"NWE_SENTINEL_GROUND_REJECTED: {exc}", file=sys.stderr)
        raise SystemExit(1)
