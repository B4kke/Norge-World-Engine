from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from typing import Any

from shapely.geometry import Point, shape
from shapely.ops import unary_union

from .canonical import canonical_sha256

ARTIFACT_SCHEMA = "nwe.vegetation-representative-artifact/0.1-candidate"
NORMALIZED_SCHEMA = "nwe.vegetation-source-normalized-sample/0.1-candidate"
ALGORITHM_ID = "sr16v-ar50-representative-rejection-v0.1"
FOREST_AR50_CODE = 30
TREE_CLASS_LABELS = {
    1: "spruce-dominated",
    2: "pine-dominated",
    3: "conifer-mixed",
    4: "mixed",
    5: "deciduous-dominated",
    6: "unstocked",
    7: "not-estimated",
}
USABLE_TREE_CLASSES = frozenset({1, 2, 3, 4, 5})


class VegetationCompileError(ValueError):
    pass


@dataclass(frozen=True)
class VegetationRepresentativeConfig:
    representative_target_per_hectare: float = 16.0
    minimum_modeled_trees_per_segment: float = 1.0
    max_rejection_attempts: int = 128
    seed: str = "nwe-vegetation-representatives-v0.1"
    tree_density_field: str = "srtrean_ge16"
    height_field: str = "srhoydem"

    def as_dict(self) -> dict[str, Any]:
        if not (math.isfinite(self.representative_target_per_hectare) and self.representative_target_per_hectare > 0):
            raise VegetationCompileError("representative_target_per_hectare must be finite and > 0")
        if not (math.isfinite(self.minimum_modeled_trees_per_segment) and self.minimum_modeled_trees_per_segment >= 0):
            raise VegetationCompileError("minimum_modeled_trees_per_segment must be finite and >= 0")
        if not isinstance(self.max_rejection_attempts, int) or self.max_rejection_attempts < 1:
            raise VegetationCompileError("max_rejection_attempts must be an integer >= 1")
        if not self.seed:
            raise VegetationCompileError("seed must be non-empty")
        return {
            "schema": "nwe.vegetation-representative-compiler-config/0.1-candidate",
            "algorithm": ALGORITHM_ID,
            "representative_target_per_hectare": self.representative_target_per_hectare,
            "minimum_modeled_trees_per_segment": self.minimum_modeled_trees_per_segment,
            "max_rejection_attempts": self.max_rejection_attempts,
            "seed": self.seed,
            "tree_density_field": self.tree_density_field,
            "tree_density_unit": "trees-per-hectare-dbh-ge-16cm",
            "height_field": self.height_field,
            "height_source_unit": "decimetres",
            "height_artifact_unit": "metres",
            "ar50_forest_code": FOREST_AR50_CODE,
            "usable_sr16v_tree_classes": sorted(USABLE_TREE_CLASSES),
        }


def _as_float(properties: dict[str, Any], key: str) -> float | None:
    value = properties.get(key)
    if value in (None, "", "*"):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _as_int(properties: dict[str, Any], key: str) -> int | None:
    value = _as_float(properties, key)
    if value is None or not value.is_integer():
        return None
    return int(value)


def _unit_interval(*parts: Any) -> float:
    payload = "|".join(str(part) for part in parts).encode("utf-8")
    value = int.from_bytes(hashlib.sha256(payload).digest()[:8], "big")
    return value / ((1 << 64) - 1)


def _layer(sample: dict[str, Any], source_key: str) -> dict[str, Any]:
    matches = [item for item in sample.get("layers", []) if item.get("source_key") == source_key]
    if len(matches) != 1:
        raise VegetationCompileError(f"expected exactly one {source_key!r} normalized layer, found {len(matches)}")
    return matches[0]


def _validate_sample(sample: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    if sample.get("schema") != NORMALIZED_SCHEMA:
        raise VegetationCompileError(f"unexpected normalized vegetation schema: {sample.get('schema')!r}")
    if sample.get("horizontal_crs") != "EPSG:25832":
        raise VegetationCompileError("candidate vegetation compiler currently requires EPSG:25832")
    if not sample.get("tile_id"):
        raise VegetationCompileError("normalized vegetation sample is missing tile_id")
    sr16v = _layer(sample, "sr16v")
    ar50 = _layer(sample, "ar50")
    if sr16v.get("role") != "forest_structure":
        raise VegetationCompileError("SR16V layer role must be forest_structure")
    if ar50.get("role") != "coarse_area_classification":
        raise VegetationCompileError("AR50 layer role must be coarse_area_classification")
    return sr16v, ar50


def _nonforest_mask(ar50_layer: dict[str, Any]):
    geometries = []
    for feature in ar50_layer.get("features", []):
        properties = feature.get("properties") or {}
        code = _as_int(properties, "arealtype")
        if code is None:
            raise VegetationCompileError(f"AR50 feature {feature.get('source_id')!r} is missing numeric arealtype")
        if code == FOREST_AR50_CODE:
            continue
        geometry = shape(feature.get("geometry"))
        if geometry.is_empty or not geometry.is_valid:
            raise VegetationCompileError(f"invalid AR50 geometry for {feature.get('source_id')!r}")
        geometries.append(geometry)
    return unary_union(geometries) if geometries else None


def _source_uncertainty(properties: dict[str, Any], base: str, *, scale: float = 1.0) -> dict[str, Any]:
    lower = _as_float(properties, f"{base}_l")
    upper = _as_float(properties, f"{base}_u")
    std_error_percent = _as_float(properties, f"{base}_s")
    result: dict[str, Any] = {}
    if lower is not None:
        result["lower_95"] = lower * scale
    if upper is not None:
        result["upper_95"] = upper * scale
    if std_error_percent is not None:
        result["standard_error_percent"] = std_error_percent
    return result


def _representative_count(
    *,
    eligible_area_m2: float,
    modeled_tree_count: float,
    source_id: str,
    config: VegetationRepresentativeConfig,
) -> int:
    if modeled_tree_count < config.minimum_modeled_trees_per_segment or eligible_area_m2 <= 0:
        return 0
    target = min(modeled_tree_count, eligible_area_m2 / 10_000.0 * config.representative_target_per_hectare)
    base = math.floor(target)
    fraction = target - base
    count = base + int(_unit_interval(config.seed, source_id, "count") < fraction)
    # Retain one representative for a source-backed non-empty segment when the
    # modeled tree count passes the configured minimum. This is a representation
    # policy, not a claim that the point is an observed individual tree.
    return max(1, count)


def _representative_point(eligible_geometry, *, source_id: str, index: int, config: VegetationRepresentativeConfig):
    min_x, min_y, max_x, max_y = eligible_geometry.bounds
    for attempt in range(config.max_rejection_attempts):
        x = min_x + (max_x - min_x) * _unit_interval(config.seed, source_id, index, attempt, "x")
        y = min_y + (max_y - min_y) * _unit_interval(config.seed, source_id, index, attempt, "y")
        point = Point(x, y)
        if eligible_geometry.covers(point):
            return point, attempt + 1, False
    # Deterministic fail-safe for extremely thin/fragmented polygons. The point
    # is still guaranteed by Shapely to lie on/in the eligible source geometry.
    point = eligible_geometry.representative_point()
    if point.is_empty or not eligible_geometry.covers(point):
        raise VegetationCompileError(f"could not derive representative point for SR16V segment {source_id!r}")
    return point, config.max_rejection_attempts, True


def compile_vegetation_representatives(
    normalized_sample: dict[str, Any],
    *,
    config: VegetationRepresentativeConfig | None = None,
) -> dict[str, Any]:
    """Compile source-backed forest semantics into deterministic representative points.

    The points are deliberately *not* individual-tree truth. They are a bounded,
    deterministic representation of SR16V modeled forest density/height after a
    coarse AR50 non-forest exclusion. Terrain grounding, road/building exclusion,
    asset choice, LOD and render-origin conversion remain downstream concerns.
    """

    config = config or VegetationRepresentativeConfig()
    config_payload = config.as_dict()
    config_id = canonical_sha256(config_payload)
    sr16v, ar50 = _validate_sample(normalized_sample)
    nonforest_mask = _nonforest_mask(ar50)

    semantic_input = {key: value for key, value in normalized_sample.items() if key != "source_raw_bindings"}
    normalized_semantic_sha256 = canonical_sha256(semantic_input)

    segments: list[dict[str, Any]] = []
    instances: list[dict[str, Any]] = []
    source_area_m2 = 0.0
    eligible_area_m2 = 0.0
    ar50_suppressed_area_m2 = 0.0
    semantic_skipped_area_m2 = 0.0
    modeled_tree_count = 0.0
    rejection_fallbacks = 0
    skip_reasons: dict[str, int] = {}

    def skip(reason: str, area: float) -> None:
        nonlocal semantic_skipped_area_m2
        skip_reasons[reason] = skip_reasons.get(reason, 0) + 1
        semantic_skipped_area_m2 += area

    features = sorted(sr16v.get("features", []), key=lambda feature: str(feature.get("source_id", "")))
    for feature in features:
        source_id = str(feature.get("source_id") or "")
        if not source_id:
            raise VegetationCompileError("SR16V feature missing source_id")
        geometry = shape(feature.get("geometry"))
        if geometry.is_empty or not geometry.is_valid:
            raise VegetationCompileError(f"invalid SR16V geometry for {source_id!r}")
        area = float(geometry.area)
        source_area_m2 += area
        properties = feature.get("properties") or {}

        tree_class = _as_int(properties, "srtreslagsam")
        density = _as_float(properties, config.tree_density_field)
        mean_height_dm = _as_float(properties, config.height_field)
        if tree_class not in USABLE_TREE_CLASSES:
            skip("tree_class_not_usable", area)
            continue
        if density is None or density <= 0:
            skip("tree_density_missing_or_nonpositive", area)
            continue
        if mean_height_dm is None or mean_height_dm <= 0:
            skip("mean_height_missing_or_nonpositive", area)
            continue

        eligible = geometry.difference(nonforest_mask) if nonforest_mask is not None and not nonforest_mask.is_empty else geometry
        if eligible.is_empty or eligible.area <= 0:
            ar50_suppressed_area_m2 += area
            skip_reasons["ar50_nonforest_suppressed"] = skip_reasons.get("ar50_nonforest_suppressed", 0) + 1
            continue
        if not eligible.is_valid:
            raise VegetationCompileError(f"invalid eligible geometry after AR50 mask for {source_id!r}")
        eligible_area = float(eligible.area)
        eligible_area_m2 += eligible_area
        ar50_suppressed_area_m2 += max(0.0, area - eligible_area)
        source_modeled_tree_count = density * eligible_area / 10_000.0
        count = _representative_count(
            eligible_area_m2=eligible_area,
            modeled_tree_count=source_modeled_tree_count,
            source_id=source_id,
            config=config,
        )
        if count == 0:
            skip("below_modeled_tree_threshold", eligible_area)
            continue

        modeled_tree_count += source_modeled_tree_count
        segment_index = len(segments)
        mean_height_m = mean_height_dm / 10.0
        segment = {
            "source_id": source_id,
            "tree_class": tree_class,
            "tree_class_label": TREE_CLASS_LABELS[tree_class],
            "mean_height_m": mean_height_m,
            "mean_height_uncertainty": _source_uncertainty(properties, config.height_field, scale=0.1),
            "tree_density_ge16_per_ha": density,
            "tree_density_ge16_uncertainty": _source_uncertainty(properties, config.tree_density_field),
            "canopy_cover_percent": _as_float(properties, "srkronedek"),
            "remote_sensing_year": _as_int(properties, "sr3dfaar"),
            "source_update_date": properties.get("oppdateringsdato"),
            "eligible_area_m2": eligible_area,
            "modeled_tree_count_ge16": source_modeled_tree_count,
            "representative_count": count,
        }
        segments.append(segment)
        represented_tree_weight = source_modeled_tree_count / count
        for index in range(count):
            point, attempts, used_fallback = _representative_point(
                eligible,
                source_id=source_id,
                index=index,
                config=config,
            )
            rejection_fallbacks += int(used_fallback)
            instances.append(
                {
                    "id": hashlib.sha256(f"{config.seed}|{source_id}|{index}".encode("utf-8")).hexdigest()[:24],
                    "segment_index": segment_index,
                    "easting_m": point.x,
                    "northing_m": point.y,
                    "yaw_rad": _unit_interval(config.seed, source_id, index, "yaw") * math.tau,
                    "represented_tree_weight": represented_tree_weight,
                    "sampling_attempts": attempts,
                }
            )

    if not segments or not instances:
        raise VegetationCompileError("vegetation representative compiler produced no usable source-backed output")

    artifact = {
        "schema": ARTIFACT_SCHEMA,
        "tile_id": normalized_sample["tile_id"],
        "horizontal_crs": "EPSG:25832",
        "authority": {
            "source_geometry_and_attributes": "source-backed-modelled",
            "representative_positions": "deterministic-procedural-not-observed-individual-trees",
            "yaw": "deterministic-procedural",
            "terrain_height": "not-contained-ground-against-accepted-terrain-downstream",
            "road_building_exclusion": "not-yet-applied",
            "renderer_assets": "not-contained",
        },
        "source_semantics": {
            "sr16v_tree_class_field": "srtreslagsam",
            "sr16v_tree_class_labels": {str(key): value for key, value in TREE_CLASS_LABELS.items()},
            "mean_height_field": config.height_field,
            "mean_height_source_unit": "decimetres",
            "tree_density_field": config.tree_density_field,
            "tree_density_semantics": "trees-per-hectare-with-dbh-at-least-16cm",
            "ar50_role": "coarse-nonforest-exclusion-only",
            "ar50_forest_code": FOREST_AR50_CODE,
        },
        "input_binding": {
            "normalized_semantic_sha256": normalized_semantic_sha256,
            "source_raw_bindings": normalized_sample.get("source_raw_bindings", {}),
        },
        "compiler_config": config_payload,
        "compiler_config_id": config_id,
        "segments": segments,
        "instances": instances,
        "stats": {
            "sr16v_input_feature_count": len(features),
            "compiled_segment_count": len(segments),
            "representative_instance_count": len(instances),
            "source_area_m2": source_area_m2,
            "eligible_area_m2": eligible_area_m2,
            "ar50_suppressed_area_m2": ar50_suppressed_area_m2,
            "semantic_skipped_area_m2": semantic_skipped_area_m2,
            "modeled_tree_count_ge16_over_compiled_area": modeled_tree_count,
            "represented_tree_weight_sum": sum(item["represented_tree_weight"] for item in instances),
            "sampling_representative_point_fallbacks": rejection_fallbacks,
            "skipped_segments": {key: skip_reasons[key] for key in sorted(skip_reasons)},
        },
    }
    return artifact
