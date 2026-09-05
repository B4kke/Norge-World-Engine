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
):
    asset_path = f"{TEXTURE_ROOT}/{asset_name}"
    texture = unreal.load_asset(asset_path)
    if texture is None:
        task = unreal.AssetImportTask()
        task.set_editor_property("filename", str(source_path))
        task.set_editor_property("destination_path", TEXTURE_ROOT)
        task.set_editor_property("destination_name", asset_name)
        task.set_editor_property("automated", True)
        task.set_editor_property("replace_existing", False)
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


def ensure_polyhaven_materials() -> None:
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
    unreal.log(
        "NWE_MATERIAL_IMPORT_PASS: verified local CC0 catalog, DirectX normals, "
        "roughness maps, anisotropic filtering, and six PBR materials."
    )


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
    ensure_polyhaven_materials()
    create_or_load_open_world_level()
    if find_actor_by_class_name("NweWorldBootstrap") is None:
        remove_template_geometry()
    configure_level(package)
    unreal.log(
        "NWE_UNREAL_LEVEL_PASS: World Partition map, verified Nannestad bootstrap, "
        "human player start, and verified local PBR material assets are ready."
    )


main()
