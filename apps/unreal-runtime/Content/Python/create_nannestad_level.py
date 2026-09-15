"""Create the canonical Nannestad UE level after the C++ module is compiled.

Run with UnrealEditor-Cmd. Pinned local CC0 textures are hash-verified before
import and existing generated or authored material assets are preserved. The
script refuses to create a fake "human" if Epic's Third Person mannequin pack
has not been added to the project.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re

import unreal


MAP_PATH = "/Game/Maps/Nannestad"
OPEN_WORLD_TEMPLATE = "/Engine/Maps/Templates/OpenWorld"
QUINN_MESH = "/Game/Characters/Mannequins/Meshes/SKM_Quinn_Simple"
QUINN_ANIMATION = "/Game/Characters/Mannequins/Animations/ABP_Quinn"
MATERIAL_ROOT = "/Game/Nannestad/GeneratedVisuals/Materials"
TEXTURE_ROOT = "/Game/Nannestad/GeneratedVisuals/Textures"
MATERIAL_CATALOG_SCHEMA = "nwe.polyhaven-material-catalog/0.1"
MATERIAL_CATALOG_RELATIVE_PATH = Path(
    "apps/world-viewer/public/assets/materials/polyhaven/manifest.json"
)
REQUIRED_MATERIAL_SURFACES = (
    "terrain",
    "road_asphalt",
    "building_walls",
    "building_roofs",
)
REQUIRED_MATERIAL_MAPS = ("diffuse", "normal_gl", "normal_dx", "roughness")
PRIVATE_GROUND_SCHEMA = "nwe.private-ground-imagery/0.1"
VEGETATION_LOCK_SCHEMA = "nwe.unreal-visual-asset-lock/0.1"
PRIVATE_VISUAL_ROOT_RELATIVE = Path("NWE/PrivateVisual")
VEGETATION_ASSET_ROOT = "/Game/Nannestad/GeneratedVisuals/Vegetation"


def require_world_package() -> dict:
    package_path = (
        Path(unreal.Paths.project_content_dir())
        / "Nannestad"
        / "Generated"
        / "world-package.json"
    )
    if not package_path.is_file():
        raise RuntimeError(
            f"Missing {package_path}. Run Tools/nwe_unreal_pipeline.py all first."
        )
    package = json.loads(package_path.read_text(encoding="utf-8"))
    if package.get("schema") != "nwe.unreal-world-package/0.1":
        raise RuntimeError("Generated world package has an unsupported schema")
    if package.get("status") != "VERIFIED_DERIVED_RENDER_PACKAGE":
        raise RuntimeError("Generated world package has not passed the required verifier")
    return package


def require_human_assets() -> None:
    missing = [
        path
        for path in (QUINN_MESH, QUINN_ANIMATION)
        if not unreal.EditorAssetLibrary.does_asset_exist(path)
    ]
    if missing:
        raise RuntimeError(
            "Add Epic's Third Person feature/content pack before creating the level. "
            f"Missing assets: {', '.join(missing)}"
        )


def require_material_catalog() -> tuple[dict, Path]:
    project_dir = Path(unreal.Paths.project_dir()).resolve()
    repository_root = project_dir.parents[1]
    catalog_path = repository_root / MATERIAL_CATALOG_RELATIVE_PATH
    if not catalog_path.is_file():
        raise RuntimeError(f"Missing pinned material catalog: {catalog_path}")
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    if catalog.get("schema") != MATERIAL_CATALOG_SCHEMA:
        raise RuntimeError("Material catalog has an unsupported schema")
    if catalog.get("license") != "CC0-1.0":
        raise RuntimeError("Material catalog must retain its CC0-1.0 license identity")
    if catalog.get("runtime_policy") != "same-origin-local-assets-only":
        raise RuntimeError("Material catalog must contain only local runtime assets")

    asset_root = catalog_path.parent
    for surface_id in REQUIRED_MATERIAL_SURFACES:
        surface = catalog.get("assets", {}).get(surface_id)
        if not isinstance(surface, dict):
            raise RuntimeError(f"Material catalog is missing {surface_id}")
        for map_id in REQUIRED_MATERIAL_MAPS:
            descriptor = surface.get("maps", {}).get(map_id)
            if not isinstance(descriptor, dict):
                raise RuntimeError(f"Material catalog is missing {surface_id}/{map_id}")
            relative_path = Path(str(descriptor.get("path", "")))
            if relative_path.is_absolute() or ".." in relative_path.parts:
                raise RuntimeError(f"Unsafe material path for {surface_id}/{map_id}")
            source_path = asset_root / relative_path
            if not source_path.is_file():
                raise RuntimeError(f"Missing pinned material map: {source_path}")
            file_bytes = source_path.read_bytes()
            if len(file_bytes) != int(descriptor.get("byte_size", -1)):
                raise RuntimeError(f"Material byte-size mismatch: {surface_id}/{map_id}")
            if hashlib.sha256(file_bytes).hexdigest() != descriptor.get("sha256"):
                raise RuntimeError(f"Material SHA-256 mismatch: {surface_id}/{map_id}")
    return catalog, asset_root


def import_texture(
    source_path: Path,
    asset_name: str,
    *,
    normal_map: bool = False,
    srgb: bool = False,
    replace_existing: bool = False,
):
    asset_path = f"{TEXTURE_ROOT}/{asset_name}"
    texture = unreal.load_asset(asset_path)
    if texture is None or replace_existing:
        task = unreal.AssetImportTask()
        task.set_editor_property("filename", str(source_path))
        task.set_editor_property("destination_path", TEXTURE_ROOT)
        task.set_editor_property("destination_name", asset_name)
        task.set_editor_property("automated", True)
        task.set_editor_property("replace_existing", replace_existing)
        task.set_editor_property("save", True)
        unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
        texture = unreal.load_asset(asset_path)
    if texture is None:
        raise RuntimeError(f"Could not import texture {source_path} as {asset_path}")

    texture.set_editor_property("srgb", srgb)
    texture.set_editor_property("filter", unreal.TextureFilter.TF_ANISOTROPIC)
    if normal_map:
        texture.set_editor_property(
            "compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP
        )
    elif not srgb:
        texture.set_editor_property(
            "compression_settings", unreal.TextureCompressionSettings.TC_MASKS
        )
    unreal.EditorAssetLibrary.save_loaded_asset(texture, only_if_is_dirty=False)
    return texture


def create_material(
    name: str,
    textures: dict,
    tint: tuple[float, float, float],
    *,
    tiling: float = 1.0,
    two_sided: bool = False,
) -> None:
    asset_path = f"{MATERIAL_ROOT}/{name}"
    if unreal.EditorAssetLibrary.does_asset_exist(asset_path):
        unreal.log(f"Preserving existing material: {asset_path}")
        return

    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    material = asset_tools.create_asset(
        name,
        MATERIAL_ROOT,
        unreal.Material,
        unreal.MaterialFactoryNew(),
    )
    if material is None:
        raise RuntimeError(f"Could not create {asset_path}")
    material.set_editor_property("two_sided", two_sided)

    texture_coordinate = unreal.MaterialEditingLibrary.create_material_expression(
        material, unreal.MaterialExpressionTextureCoordinate, -900, 40
    )
    texture_coordinate.set_editor_property("coordinate_index", 0)
    texture_coordinate.set_editor_property("u_tiling", tiling)
    texture_coordinate.set_editor_property("v_tiling", tiling)

    diffuse = unreal.MaterialEditingLibrary.create_material_expression(
        material, unreal.MaterialExpressionTextureSampleParameter2D, -650, -160
    )
    diffuse.set_editor_property("parameter_name", "BaseColorTexture")
    diffuse.set_editor_property("texture", textures["diffuse"])
    diffuse.set_editor_property(
        "sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_COLOR
    )
    normal = unreal.MaterialEditingLibrary.create_material_expression(
        material, unreal.MaterialExpressionTextureSampleParameter2D, -650, 80
    )
    normal.set_editor_property("parameter_name", "NormalTexture")
    normal.set_editor_property("texture", textures["normal_dx"])
    normal.set_editor_property(
        "sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL
    )
    roughness = unreal.MaterialEditingLibrary.create_material_expression(
        material, unreal.MaterialExpressionTextureSampleParameter2D, -650, 300
    )
    roughness.set_editor_property("parameter_name", "RoughnessTexture")
    roughness.set_editor_property("texture", textures["roughness"])
    roughness.set_editor_property(
        "sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_MASKS
    )
    for sample in (diffuse, normal, roughness):
        unreal.MaterialEditingLibrary.connect_material_expressions(
            texture_coordinate, "", sample, "UVs"
        )

    color_tint = unreal.MaterialEditingLibrary.create_material_expression(
        material, unreal.MaterialExpressionVectorParameter, -400, -280
    )
    color_tint.set_editor_property("parameter_name", "ColorTint")
    color_tint.set_editor_property(
        "default_value", unreal.LinearColor(tint[0], tint[1], tint[2], 1.0)
    )
    tinted_color = unreal.MaterialEditingLibrary.create_material_expression(
        material, unreal.MaterialExpressionMultiply, -150, -100
    )
    unreal.MaterialEditingLibrary.connect_material_expressions(
        diffuse, "RGB", tinted_color, "A"
    )
    unreal.MaterialEditingLibrary.connect_material_expressions(
        color_tint, "", tinted_color, "B"
    )

    unreal.MaterialEditingLibrary.connect_material_property(
        tinted_color, "", unreal.MaterialProperty.MP_BASE_COLOR
    )
    unreal.MaterialEditingLibrary.connect_material_property(
        roughness, "R", unreal.MaterialProperty.MP_ROUGHNESS
    )
    unreal.MaterialEditingLibrary.connect_material_property(
        normal, "RGB", unreal.MaterialProperty.MP_NORMAL
    )
    unreal.MaterialEditingLibrary.recompile_material(material)
    unreal.EditorAssetLibrary.save_loaded_asset(material, only_if_is_dirty=False)


def ensure_polyhaven_materials() -> dict[str, dict]:
    catalog, asset_root = require_material_catalog()
    imported: dict[str, dict] = {}
    map_suffix = {"diffuse": "D", "normal_dx": "N", "roughness": "R"}
    for surface_id in REQUIRED_MATERIAL_SURFACES:
        surface = catalog["assets"][surface_id]
        imported[surface_id] = {}
        for map_id in ("diffuse", "normal_dx", "roughness"):
            descriptor = surface["maps"][map_id]
            imported[surface_id][map_id] = import_texture(
                asset_root / descriptor["path"],
                f"T_{surface['asset_id']}_{map_suffix[map_id]}",
                normal_map=map_id == "normal_dx",
                srgb=map_id == "diffuse",
            )

    terrain_tiling = 1000.0 / float(catalog["assets"]["terrain"]["tile_size_m"])
    create_material(
        "M_Terrain", imported["terrain"], (0.92, 0.96, 0.86), tiling=terrain_tiling
    )
    create_material(
        "M_Road_Asphalt", imported["road_asphalt"], (0.72, 0.72, 0.70), two_sided=True
    )
    create_material(
        "M_Wall_Source", imported["building_walls"], (0.92, 0.87, 0.80), two_sided=True
    )
    create_material(
        "M_Roof_Source", imported["building_roofs"], (0.82, 0.84, 0.85), two_sided=True
    )
    create_material(
        "M_Wall_Fallback", imported["building_walls"], (0.55, 0.62, 0.62), two_sided=True
    )
    create_material(
        "M_Roof_Fallback", imported["building_roofs"], (0.54, 0.58, 0.60), two_sided=True
    )

    # Nannestad presentation palette. These tints are explicitly presentation
    # classes over the local CC0 PBR surfaces. When OSM colour/material tags
    # exist the compiler selects the nearest class; otherwise class choice is
    # deterministic by building type/id and never becomes world truth.
    wall_tints = {
        "White": (0.95, 0.93, 0.87),
        "Yellow": (0.88, 0.70, 0.34),
        "Red": (0.58, 0.20, 0.14),
        "Grey": (0.52, 0.56, 0.55),
        "Wood": (0.50, 0.34, 0.22),
    }
    roof_tints = {
        "Red": (0.52, 0.16, 0.11),
        "Dark": (0.19, 0.21, 0.21),
        "Grey": (0.50, 0.52, 0.52),
    }
    for label, tint in wall_tints.items():
        create_material(
            f"M_Wall_{label}",
            imported["building_walls"],
            tint,
            two_sided=True,
        )
    for label, tint in roof_tints.items():
        create_material(
            f"M_Roof_{label}",
            imported["building_roofs"],
            tint,
            two_sided=True,
        )

    unreal.log(
        "NWE_MATERIAL_IMPORT_PASS: verified local CC0 catalog, DirectX normals, "
        "roughness maps, anisotropic filtering, six compatibility PBR materials, "
        "and eight Nannestad building presentation classes."
    )
    return imported


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _private_visual_root() -> Path:
    return Path(unreal.Paths.project_saved_dir()).resolve() / PRIVATE_VISUAL_ROOT_RELATIVE


def require_private_ground_imagery():
    root = _private_visual_root() / "ground"
    manifest_path = root / "ground-imagery.json"
    if not manifest_path.is_file():
        unreal.log_warning(
            "NWE_PRIVATE_GROUND_IMAGERY_ABSENT: generic terrain PBR remains active. "
            "Run Tools/prepare_ground_imagery.py with a legal local orthophoto/satellite GeoTIFF."
        )
        return None
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema") != PRIVATE_GROUND_SCHEMA:
        raise RuntimeError("Private ground imagery manifest has unsupported schema")
    if manifest.get("tile_id") != "epsg25832_611000_6677000_1000m":
        raise RuntimeError("Private ground imagery targets the wrong tile")
    if manifest.get("horizontal_crs") != "EPSG:25832":
        raise RuntimeError("Private ground imagery must be EPSG:25832")
    if [float(value) for value in manifest.get("bounds", [])] != [
        611000.0, 6677000.0, 612000.0, 6678000.0
    ]:
        raise RuntimeError("Private ground imagery bounds must be the exact 1x1 km tile")
    texture = manifest.get("texture")
    source = manifest.get("source")
    if not isinstance(texture, dict) or not isinstance(source, dict):
        raise RuntimeError("Private ground imagery manifest is incomplete")
    relative = Path(str(texture.get("path", "")))
    if relative.is_absolute() or ".." in relative.parts:
        raise RuntimeError("Private ground imagery texture path is unsafe")
    texture_path = root / relative
    if not texture_path.is_file():
        raise RuntimeError(f"Private ground imagery texture missing: {texture_path}")
    if texture_path.stat().st_size != int(texture.get("byte_size", -1)):
        raise RuntimeError("Private ground imagery byte-size mismatch")
    if _sha256(texture_path) != texture.get("sha256"):
        raise RuntimeError("Private ground imagery SHA-256 mismatch")
    if source.get("redistribution") not in {"private-only", "allowed-by-license"}:
        raise RuntimeError("Private ground imagery redistribution policy is invalid")
    return manifest, texture_path


def create_ground_imagery_material(detail_textures: dict, ground_texture) -> None:
    asset_path = f"{MATERIAL_ROOT}/M_Terrain_Imagery"
    if unreal.EditorAssetLibrary.does_asset_exist(asset_path):
        unreal.log(f"Preserving existing imagery material: {asset_path}")
        return
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    material = asset_tools.create_asset(
        "M_Terrain_Imagery",
        MATERIAL_ROOT,
        unreal.Material,
        unreal.MaterialFactoryNew(),
    )
    if material is None:
        raise RuntimeError(f"Could not create {asset_path}")

    ground_uv = unreal.MaterialEditingLibrary.create_material_expression(
        material, unreal.MaterialExpressionTextureCoordinate, -900, -220
    )
    ground_uv.set_editor_property("coordinate_index", 0)
    ground = unreal.MaterialEditingLibrary.create_material_expression(
        material, unreal.MaterialExpressionTextureSampleParameter2D, -650, -260
    )
    ground.set_editor_property("parameter_name", "GroundColorTexture")
    ground.set_editor_property("texture", ground_texture)
    ground.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_COLOR)
    unreal.MaterialEditingLibrary.connect_material_expressions(ground_uv, "", ground, "UVs")

    detail_uv = unreal.MaterialEditingLibrary.create_material_expression(
        material, unreal.MaterialExpressionTextureCoordinate, -900, 140
    )
    detail_uv.set_editor_property("coordinate_index", 0)
    detail_uv.set_editor_property("u_tiling", 250.0)
    detail_uv.set_editor_property("v_tiling", 250.0)

    normal = unreal.MaterialEditingLibrary.create_material_expression(
        material, unreal.MaterialExpressionTextureSampleParameter2D, -650, 40
    )
    normal.set_editor_property("parameter_name", "DetailNormal")
    normal.set_editor_property("texture", detail_textures["normal_dx"])
    normal.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL)
    roughness = unreal.MaterialEditingLibrary.create_material_expression(
        material, unreal.MaterialExpressionTextureSampleParameter2D, -650, 280
    )
    roughness.set_editor_property("parameter_name", "DetailRoughness")
    roughness.set_editor_property("texture", detail_textures["roughness"])
    roughness.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_MASKS)
    unreal.MaterialEditingLibrary.connect_material_expressions(detail_uv, "", normal, "UVs")
    unreal.MaterialEditingLibrary.connect_material_expressions(detail_uv, "", roughness, "UVs")

    unreal.MaterialEditingLibrary.connect_material_property(
        ground, "RGB", unreal.MaterialProperty.MP_BASE_COLOR
    )
    unreal.MaterialEditingLibrary.connect_material_property(
        normal, "RGB", unreal.MaterialProperty.MP_NORMAL
    )
    unreal.MaterialEditingLibrary.connect_material_property(
        roughness, "R", unreal.MaterialProperty.MP_ROUGHNESS
    )
    unreal.MaterialEditingLibrary.recompile_material(material)
    unreal.EditorAssetLibrary.save_loaded_asset(material, only_if_is_dirty=False)


def ensure_private_ground_imagery(detail_textures: dict) -> bool:
    resolved = require_private_ground_imagery()
    if resolved is None:
        return False
    manifest, texture_path = resolved
    ground_texture = import_texture(
        texture_path,
        "T_Nannestad_GroundColor",
        srgb=True,
        replace_existing=True,
    )
    try:
        ground_texture.set_editor_property("address_x", unreal.TextureAddress.TA_CLAMP)
        ground_texture.set_editor_property("address_y", unreal.TextureAddress.TA_CLAMP)
    except Exception:
        unreal.log_warning("Could not force ground texture clamp addressing; verify seams in UE.")
    unreal.EditorAssetLibrary.save_loaded_asset(ground_texture, only_if_is_dirty=False)
    create_ground_imagery_material(detail_textures, ground_texture)
    unreal.log(
        "NWE_PRIVATE_GROUND_IMAGERY_PASS: exact 1x1 km ground color imported from "
        f"{manifest['source']['name']} ({manifest['source']['redistribution']}); "
        "generic PBR detail normal/roughness remains presentation-only."
    )
    return True


def require_vegetation_asset_lock():
    root = _private_visual_root()
    lock_path = root / "vegetation-assets.lock.json"
    if not lock_path.is_file():
        return None
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    if lock.get("schema") != VEGETATION_LOCK_SCHEMA:
        raise RuntimeError("Vegetation asset lock has unsupported schema")
    if lock.get("license") != "CC0-1.0" or lock.get("runtime_network_calls") != 0:
        raise RuntimeError("Vegetation asset lock must retain CC0/offline runtime policy")
    assets = lock.get("assets")
    if not isinstance(assets, dict) or set(assets) != {"spruce", "pine", "deciduous"}:
        raise RuntimeError("Vegetation asset lock must contain spruce/pine/deciduous proxies")
    for asset_class, descriptor in assets.items():
        files = descriptor.get("files") if isinstance(descriptor, dict) else None
        if not isinstance(files, list) or not files:
            raise RuntimeError(f"{asset_class}: vegetation lock has no files")
        for item in files:
            relative = Path(str(item.get("path", "")))
            if relative.is_absolute() or ".." in relative.parts:
                raise RuntimeError(f"{asset_class}: unsafe vegetation asset path")
            path = root / relative
            if not path.is_file():
                raise RuntimeError(f"{asset_class}: vegetation file missing: {path}")
            if path.stat().st_size != int(item.get("byte_size", -1)) or _sha256(path) != item.get("sha256"):
                raise RuntimeError(f"{asset_class}: vegetation asset hash/size mismatch: {path}")
    return lock, root


def _lod_index(asset_path: str):
    name = asset_path.rsplit("/", 1)[-1]
    matches = re.findall(r"(?:^|[_\-.])LOD[_\-.]?(\d+)(?:$|[_\-.])|_LOD(\d+)", name, flags=re.IGNORECASE)
    if not matches:
        return None
    first, second = matches[-1]
    return int(first or second)


def import_vegetation_proxy_assets(package: dict) -> bool:
    if "vegetation" not in package:
        return False
    resolved = require_vegetation_asset_lock()
    if resolved is None:
        raise RuntimeError(
            "World package contains source-backed vegetation but no authored tree assets. "
            "Run Tools/acquire_visual_assets.py before level creation."
        )
    lock, root = resolved
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    for asset_class in ("spruce", "pine", "deciduous"):
        descriptor = lock["assets"][asset_class]
        gltf_path = root / descriptor["gltf_path"]
        raw_folder = f"{VEGETATION_ASSET_ROOT}/{asset_class}/Raw"
        selected_folder = f"{VEGETATION_ASSET_ROOT}/{asset_class}/Selected"
        existing_selected = unreal.EditorAssetLibrary.list_assets(
            selected_folder, recursive=True, include_folder=False
        )
        if existing_selected:
            unreal.log(f"Preserving existing selected vegetation assets: {selected_folder}")
            continue

        task = unreal.AssetImportTask()
        task.set_editor_property("filename", str(gltf_path))
        task.set_editor_property("destination_path", raw_folder)
        task.set_editor_property("automated", True)
        task.set_editor_property("replace_existing", False)
        task.set_editor_property("save", True)
        asset_tools.import_asset_tasks([task])

        raw_assets = unreal.EditorAssetLibrary.list_assets(
            raw_folder, recursive=True, include_folder=False
        )
        static_mesh_paths = [
            path
            for path in raw_assets
            if isinstance(unreal.load_asset(path), unreal.StaticMesh)
        ]
        if not static_mesh_paths:
            raise RuntimeError(
                f"Poly Haven glTF for {asset_class} imported no StaticMesh assets: {gltf_path}"
            )
        lod_pairs = [(path, _lod_index(path)) for path in static_mesh_paths]
        marked = [pair for pair in lod_pairs if pair[1] is not None]
        if marked:
            selected_lod = max(index for _, index in marked)
            selected = [path for path, index in marked if index == selected_lod]
        else:
            selected_lod = None
            selected = static_mesh_paths

        for index, source_asset in enumerate(sorted(selected)):
            target = f"{selected_folder}/SM_NWE_{asset_class.capitalize()}_{index:02d}"
            if not unreal.EditorAssetLibrary.duplicate_asset(source_asset, target):
                raise RuntimeError(f"Could not duplicate vegetation mesh {source_asset} -> {target}")
        unreal.EditorAssetLibrary.save_directory(selected_folder, only_if_is_dirty=False, recursive=True)
        unreal.log(
            f"NWE_VEGETATION_ASSET_IMPORT: {asset_class} selected "
            f"{len(selected)} mesh part(s), LOD={selected_lod}, source={descriptor['source_page']}"
        )
    return True


def create_or_load_open_world_level() -> None:
    levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if unreal.EditorAssetLibrary.does_asset_exist(MAP_PATH):
        if not levels.load_level(MAP_PATH):
            raise RuntimeError(f"Could not load {MAP_PATH}")
        return

    created = levels.new_level_from_template(MAP_PATH, OPEN_WORLD_TEMPLATE)
    if not created:
        raise RuntimeError(
            "Could not create the Nannestad map from Epic's Open World template; "
            "World Partition is mandatory for this project direction."
        )


def remove_template_geometry() -> None:
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    removable_types = (
        unreal.LandscapeProxy,
        unreal.PlayerStart,
        unreal.DirectionalLight,
        unreal.SkyLight,
        unreal.SkyAtmosphere,
        unreal.ExponentialHeightFog,
        unreal.VolumetricCloud,
    )
    for actor in actors.get_all_level_actors():
        if isinstance(actor, removable_types):
            actors.destroy_actor(actor)


def find_actor_by_class_name(class_name: str):
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    for actor in actors.get_all_level_actors():
        if actor.get_class().get_name() == class_name:
            return actor
    return None


def configure_level(package: dict) -> None:
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    bootstrap_class = unreal.load_class(None, "/Script/Nannestad.NweWorldBootstrap")
    game_mode_class = unreal.load_class(None, "/Script/Nannestad.NannestadGameMode")
    if bootstrap_class is None or game_mode_class is None:
        raise RuntimeError("Compile the Nannestad C++ Editor target before running this script")

    bootstrap = find_actor_by_class_name("NweWorldBootstrap")
    if bootstrap is None:
        bootstrap = actors.spawn_actor_from_class(
            bootstrap_class, unreal.Vector(0.0, 0.0, 0.0), unreal.Rotator()
        )
        bootstrap.set_actor_label("NWE_Verified_Nannestad_World")

    player_start = find_actor_by_class_name("PlayerStart")
    spawn_cm = package["spawn"]["unreal_cm"]
    if player_start is None:
        player_start = actors.spawn_actor_from_class(
            unreal.PlayerStart,
            unreal.Vector(float(spawn_cm[0]), float(spawn_cm[1]), float(spawn_cm[2])),
            unreal.Rotator(0.0, 0.0, 0.0),
        )
        player_start.set_actor_label("PlayerStart_Nannestad_Centre")

    world = unreal.EditorLevelLibrary.get_editor_world()
    world.get_world_settings().set_editor_property("default_game_mode", game_mode_class)
    unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()


def main() -> None:
    package = require_world_package()
    require_human_assets()
    imported_materials = ensure_polyhaven_materials()
    private_ground = ensure_private_ground_imagery(imported_materials["terrain"])
    vegetation_assets = import_vegetation_proxy_assets(package)
    create_or_load_open_world_level()
    if find_actor_by_class_name("NweWorldBootstrap") is None:
        remove_template_geometry()
    configure_level(package)
    unreal.log(
        "NWE_UNREAL_LEVEL_PASS: World Partition map, verified Nannestad bootstrap, "
        "human player start, PBR assets, "
        f"private_ground={private_ground}, vegetation_assets={vegetation_assets}."
    )


main()
