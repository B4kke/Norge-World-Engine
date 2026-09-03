"""Create the canonical Nannestad UE level after the C++ module is compiled.

Run with UnrealEditor-Cmd. Existing authored material assets are preserved. The
script refuses to create a fake "human" if Epic's Third Person mannequin pack
has not been added to the project.
"""

from __future__ import annotations

import json
from pathlib import Path

import unreal


MAP_PATH = "/Game/Maps/Nannestad"
OPEN_WORLD_TEMPLATE = "/Engine/Maps/Templates/OpenWorld"
QUINN_MESH = "/Game/Characters/Mannequins/Meshes/SKM_Quinn_Simple"
QUINN_ANIMATION = "/Game/Characters/Mannequins/Animations/ABP_Quinn"
MATERIAL_ROOT = "/Game/Nannestad/Materials"


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


def create_material(name: str, color: tuple[float, float, float], roughness: float) -> None:
    asset_path = f"{MATERIAL_ROOT}/{name}"
    if unreal.EditorAssetLibrary.does_asset_exist(asset_path):
        unreal.log(f"Preserving authored material: {asset_path}")
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

    base_color = unreal.MaterialEditingLibrary.create_material_expression(
        material, unreal.MaterialExpressionVectorParameter, -300, -50
    )
    base_color.set_editor_property("parameter_name", "BaseColor")
    base_color.set_editor_property(
        "default_value", unreal.LinearColor(color[0], color[1], color[2], 1.0)
    )
    surface_roughness = unreal.MaterialEditingLibrary.create_material_expression(
        material, unreal.MaterialExpressionScalarParameter, -300, 100
    )
    surface_roughness.set_editor_property("parameter_name", "Roughness")
    surface_roughness.set_editor_property("default_value", roughness)

    unreal.MaterialEditingLibrary.connect_material_property(
        base_color, "", unreal.MaterialProperty.MP_BASE_COLOR
    )
    unreal.MaterialEditingLibrary.connect_material_property(
        surface_roughness, "", unreal.MaterialProperty.MP_ROUGHNESS
    )
    unreal.MaterialEditingLibrary.recompile_material(material)
    unreal.EditorAssetLibrary.save_loaded_asset(material, only_if_is_dirty=False)


def ensure_baseline_materials() -> None:
    # Conservative PBR baselines, not a photorealism claim. Authored materials
    # can replace them in-place without changing world or geometry identities.
    create_material("M_Terrain", (0.19, 0.24, 0.12), 0.92)
    create_material("M_Road_Asphalt", (0.035, 0.04, 0.045), 0.80)
    create_material("M_Wall_Source", (0.46, 0.44, 0.39), 0.72)
    create_material("M_Roof_Source", (0.13, 0.08, 0.06), 0.78)
    create_material("M_Wall_Fallback", (0.52, 0.48, 0.38), 0.76)
    create_material("M_Roof_Fallback", (0.18, 0.09, 0.055), 0.82)


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
    ensure_baseline_materials()
    create_or_load_open_world_level()
    if find_actor_by_class_name("NweWorldBootstrap") is None:
        remove_template_geometry()
    configure_level(package)
    unreal.log(
        "NWE_UNREAL_LEVEL_PASS: World Partition map, verified Nannestad bootstrap, "
        "human player start, and baseline PBR material slots are ready."
    )


main()
