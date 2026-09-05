from __future__ import annotations

import configparser
import json
from pathlib import Path


PROJECT_ROOT = Path(__file__).parents[1]


def test_uproject_targets_ue58_and_required_runtime_plugins() -> None:
    project = json.loads((PROJECT_ROOT / "Nannestad.uproject").read_text(encoding="utf-8"))
    assert project["EngineAssociation"] == "5.8"
    assert project["Modules"] == [
        {"Name": "Nannestad", "Type": "Runtime", "LoadingPhase": "Default"}
    ]
    plugins = {entry["Name"]: entry for entry in project["Plugins"]}
    assert plugins["ProceduralMeshComponent"]["Enabled"] is True
    assert plugins["GeoReferencing"]["Enabled"] is True
    assert plugins["PythonScriptPlugin"]["TargetAllowList"] == ["Editor"]
    assert plugins["EditorScriptingUtilities"]["TargetAllowList"] == ["Editor"]


def test_renderer_configuration_selects_the_declared_pc_baseline() -> None:
    parser = configparser.ConfigParser(strict=False)
    parser.optionxform = str
    parser.read(PROJECT_ROOT / "Config" / "DefaultEngine.ini", encoding="utf-8")
    renderer = parser["/Script/Engine.RendererSettings"]
    assert renderer["r.DynamicGlobalIlluminationMethod"] == "1"
    assert renderer["r.ReflectionMethod"] == "1"
    assert renderer["r.Shadow.Virtual.Enable"] == "1"
    assert renderer["r.GenerateMeshDistanceFields"] == "True"
    assert renderer["r.AllowStaticLighting"] == "False"
    assert renderer["r.AntiAliasingMethod"] == "4"
    assert renderer["r.Nanite.ProjectEnabled"] == "True"
    assert renderer["r.VirtualTextures"] == "True"
    assert renderer["r.SupportSkyAtmosphereAffectsHeightFog"] == "True"
    windows = parser["/Script/WindowsTargetPlatform.WindowsTargetSettings"]
    assert windows["DefaultGraphicsRHI"] == "DefaultGraphicsRHI_DX12"
    assert windows["+D3D12TargetedShaderFormats"] == "PCD3D_SM6"


def test_runtime_code_preserves_offline_provenance_and_coordinate_contracts() -> None:
    private_source = (PROJECT_ROOT / "Source" / "Nannestad" / "Private")
    bootstrap = (private_source / "NweWorldBootstrap.cpp").read_text(encoding="utf-8")
    georeference = (private_source / "NweGeoReference.cpp").read_text(encoding="utf-8")
    assert "VERIFIED_DERIVED_RENDER_PACKAGE" in bootstrap
    assert "READY_FOR_RUNTIME" in bootstrap
    assert "RawSourceRuntimeCalls != 0.0" in bootstrap
    assert "611500.0" in (PROJECT_ROOT / "Source" / "Nannestad" / "Public" / "NweGeoReference.h").read_text(encoding="utf-8")
    assert "-(NorthingM - OriginNorthingM)" in georeference
    assert "* UnrealUnitsPerMetre" in georeference
    forbidden_runtime_sources = ("kartverket.no", "vegvesen.no", "openstreetmap.org", "overpass")
    all_runtime_source = "\n".join(
        path.read_text(encoding="utf-8")
        for path in (PROJECT_ROOT / "Source").rglob("*.*")
        if path.suffix in {".h", ".cpp", ".cs"}
    ).casefold()
    assert not any(source in all_runtime_source for source in forbidden_runtime_sources)


def test_character_fails_visibly_when_human_assets_are_absent() -> None:
    character = (
        PROJECT_ROOT / "Source" / "Nannestad" / "Private" / "NannestadCharacter.cpp"
    ).read_text(encoding="utf-8")
    assert "SKM_Quinn_Simple" in character
    assert "ABP_Quinn" in character
    assert "Human character assets are missing" in character
    assert "SetSkeletalMesh" in character


def test_visual_pipeline_uses_verified_local_pbr_assets_and_pc_quality_ceiling() -> None:
    level_script = (PROJECT_ROOT / "Content" / "Python" / "create_nannestad_level.py").read_text(
        encoding="utf-8"
    )
    bootstrap = (
        PROJECT_ROOT / "Source" / "Nannestad" / "Private" / "NweWorldBootstrap.cpp"
    ).read_text(encoding="utf-8")
    scalability = (PROJECT_ROOT / "Config" / "DefaultScalability.ini").read_text(
        encoding="utf-8"
    )
    user_settings = (
        PROJECT_ROOT / "Config" / "DefaultGameUserSettings.ini"
    ).read_text(encoding="utf-8")

    assert 'MATERIAL_CATALOG_SCHEMA = "nwe.polyhaven-material-catalog/0.1"' in level_script
    assert 'catalog.get("license") != "CC0-1.0"' in level_script
    assert "hashlib.sha256(file_bytes).hexdigest()" in level_script
    assert '"normal_dx"' in level_script
    assert "MaterialExpressionTextureSampleParameter2D" in level_script
    assert "SAMPLERTYPE_NORMAL" in level_script
    assert "GeneratedVisuals/Materials" in level_script
    assert "GeneratedVisuals/Materials" in bootstrap
    assert "SetIntensity(75000.0f)" in bootstrap
    assert "[ShadowQuality@Cine]" in scalability
    assert "r.MaxAnisotropy=16" in scalability
    assert "r.MotionBlurQuality=0" in scalability
    assert "sg.GlobalIlluminationQuality=3" in user_settings
