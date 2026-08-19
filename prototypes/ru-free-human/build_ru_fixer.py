#!/usr/bin/env python3
"""Build an RU Fixer prototype around a real downloaded CC0 human base mesh.

This script deliberately keeps source acquisition, source verification, generated
clothing and the static preview derivative separate. The downloaded source GLB
remains untouched and keeps its original humanoid rig. The generated clothes are
currently static and are NOT yet skinned to the source rig.
"""

from __future__ import annotations

import hashlib
import json
import math
import shutil
import urllib.request
import zipfile
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "output"
OUT.mkdir(parents=True, exist_ok=True)

SOURCE_URL = "https://raw.githubusercontent.com/BoQsc/Godot-3D-Male-Base-Mesh/main/Original/male_base_mesh.glb"
SOURCE_GIT_BLOB_SHA1 = "d479680210d4192d880580786d899a80cdd4ff56"
SOURCE_BYTES = 93936
SOURCE_LICENSE = "CC0-1.0"
SOURCE_AUTHOR = "orange-juice-games"
SOURCE_MIRROR = "BoQsc/Godot-3D-Male-Base-Mesh"
TARGET_HEIGHT_M = 1.84


def rgba(hex_color: str) -> np.ndarray:
    h = hex_color.lstrip("#")
    if len(h) == 6:
        h += "ff"
    return np.array([int(h[i:i+2], 16) for i in (0, 2, 4, 6)], dtype=np.uint8)


COLORS = {
    "skin": rgba("#B77D61"),
    "jacket": rgba("#202428"),
    "hoodie": rgba("#353B42"),
    "pants": rgba("#54584F"),
    "shoe": rgba("#D5D1C9"),
    "sole": rgba("#262A2D"),
    "cap": rgba("#171A1D"),
    "bag": rgba("#1B1E21"),
    "strap": rgba("#111315"),
    "metal": rgba("#8E9498"),
}


def git_blob_sha1(data: bytes) -> str:
    prefix = b"blob " + str(len(data)).encode("ascii") + b"\0"
    return hashlib.sha1(prefix + data).hexdigest()


def fetch_source(path: Path) -> dict:
    request = urllib.request.Request(
        SOURCE_URL,
        headers={"User-Agent": "NorgeWorldEngine-RU-FreeHuman-Prototype/0.1"},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        data = response.read()
    observed_git_sha = git_blob_sha1(data)
    if len(data) != SOURCE_BYTES:
        raise RuntimeError(f"source byte-size mismatch: {len(data)} != {SOURCE_BYTES}")
    if observed_git_sha != SOURCE_GIT_BLOB_SHA1:
        raise RuntimeError(
            f"source git blob SHA mismatch: {observed_git_sha} != {SOURCE_GIT_BLOB_SHA1}"
        )
    path.write_bytes(data)
    return {
        "bytes": len(data),
        "git_blob_sha1": observed_git_sha,
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def colorize(mesh: trimesh.Trimesh, color: np.ndarray) -> trimesh.Trimesh:
    mesh.visual.face_colors = np.tile(color, (len(mesh.faces), 1))
    return mesh


def ellipsoid(center, radii, color, subdivisions=2):
    m = trimesh.creation.icosphere(subdivisions=subdivisions, radius=1.0)
    m.apply_scale(radii)
    m.apply_translation(center)
    return colorize(m, color)


def box(center, extents, color, rotation=(0.0, 0.0, 0.0)):
    m = trimesh.creation.box(extents=extents)
    if any(abs(v) > 1e-12 for v in rotation):
        m.apply_transform(trimesh.transformations.euler_matrix(*rotation, axes="sxyz"))
    m.apply_translation(center)
    return colorize(m, color)


def frustum_between(p1, p2, r1, r2, color, sections=18):
    p1, p2 = np.asarray(p1, float), np.asarray(p2, float)
    vec = p2 - p1
    length = float(np.linalg.norm(vec))
    if length < 1e-8:
        return ellipsoid(p1, (r1, r1, r1), color, subdivisions=1)
    angles = np.linspace(0.0, 2.0 * np.pi, sections, endpoint=False)
    verts = (
        [[r1 * np.cos(a), r1 * np.sin(a), -length / 2] for a in angles]
        + [[r2 * np.cos(a), r2 * np.sin(a), length / 2] for a in angles]
    )
    faces = []
    for i in range(sections):
        j = (i + 1) % sections
        faces.extend([[i, j, sections + j], [i, sections + j, sections + i]])
    verts.extend([[0, 0, -length / 2], [0, 0, length / 2]])
    cb, ct = 2 * sections, 2 * sections + 1
    for i in range(sections):
        j = (i + 1) % sections
        faces.extend([[cb, j, i], [ct, sections + i, sections + j]])
    m = trimesh.Trimesh(vertices=np.asarray(verts), faces=np.asarray(faces), process=True)
    align = trimesh.geometry.align_vectors([0, 0, 1], vec / length)
    if align is not None:
        m.apply_transform(align)
    m.apply_translation((p1 + p2) / 2)
    return colorize(m, color)


def loft_y(rings, color, sections=26):
    angles = np.linspace(0.0, 2.0 * np.pi, sections, endpoint=False)
    verts = []
    for y, rx, rz, zoff in rings:
        verts.extend([[rx * np.cos(a), y, zoff + rz * np.sin(a)] for a in angles])
    faces = []
    nr = len(rings)
    for k in range(nr - 1):
        b, n = k * sections, (k + 1) * sections
        for i in range(sections):
            j = (i + 1) % sections
            faces.extend([[b + i, b + j, n + j], [b + i, n + j, n + i]])
    verts.extend([[0, rings[0][0], rings[0][3]], [0, rings[-1][0], rings[-1][3]]])
    cb, ct = len(verts) - 2, len(verts) - 1
    for i in range(sections):
        j = (i + 1) % sections
        faces.extend([[cb, j, i], [ct, (nr - 1) * sections + i, (nr - 1) * sections + j]])
    return colorize(
        trimesh.Trimesh(vertices=np.asarray(verts), faces=np.asarray(faces), process=True),
        color,
    )


def bake_scene(scene: trimesh.Scene) -> trimesh.Trimesh:
    meshes = []
    for node_name in scene.graph.nodes_geometry:
        transform, geom_name = scene.graph[node_name]
        g = scene.geometry[geom_name].copy()
        g.apply_transform(transform)
        meshes.append(g)
    if not meshes:
        raise RuntimeError("source GLB contains no renderable geometry")
    return trimesh.util.concatenate(meshes)


def node_world_position(scene: trimesh.Scene, names: list[str]) -> np.ndarray | None:
    node_set = set(scene.graph.nodes)
    lower = {str(n).lower(): n for n in node_set}
    for candidate in names:
        key = candidate.lower()
        exact = lower.get(key)
        if exact is not None:
            transform, _ = scene.graph.get(exact)
            return np.asarray(transform[:3, 3], dtype=float)
    # Suffix/substring fallback because importers can rename nodes.
    for candidate in names:
        key = candidate.lower()
        for lower_name, original in lower.items():
            if key in lower_name:
                transform, _ = scene.graph.get(original)
                return np.asarray(transform[:3, 3], dtype=float)
    return None


def transform_point(p: np.ndarray | None, scale: float, y_shift: float) -> np.ndarray | None:
    if p is None:
        return None
    q = np.asarray(p, float) * scale
    q[1] += y_shift
    return q


def slice_radius(vertices: np.ndarray, y0: float, y1: float, x_limit=0.38) -> tuple[float, float]:
    mask = (vertices[:, 1] >= y0) & (vertices[:, 1] <= y1) & (np.abs(vertices[:, 0]) <= x_limit)
    pts = vertices[mask]
    if len(pts) < 20:
        return 0.20, 0.13
    rx = float(np.quantile(np.abs(pts[:, 0]), 0.98))
    rz = float(np.quantile(np.abs(pts[:, 2] - np.median(pts[:, 2])), 0.98))
    return max(rx, 0.16), max(rz, 0.10)


def infer_front_sign(vertices: np.ndarray) -> int:
    head = vertices[vertices[:, 1] > 0.84 * vertices[:, 1].max()]
    if len(head) < 20:
        return -1
    med = float(np.median(head[:, 2]))
    pos = float(head[:, 2].max() - med)
    neg = float(med - head[:, 2].min())
    return 1 if pos > neg else -1


def build_outfit(body: trimesh.Trimesh, source_scene: trimesh.Scene, scale: float, y_shift: float):
    v = body.vertices
    front_sign = infer_front_sign(v)
    torso_rx_low, torso_rz_low = slice_radius(v, 1.05, 1.20)
    torso_rx_mid, torso_rz_mid = slice_radius(v, 1.20, 1.40)
    torso_rx_top, torso_rz_top = slice_radius(v, 1.40, 1.56)

    clothes: list[trimesh.Trimesh] = []

    # Hoodie + bomber body derived from actual source-body cross sections.
    clothes.append(loft_y([
        (1.02, torso_rx_low + 0.020, torso_rz_low + 0.025, 0.0),
        (1.16, torso_rx_low + 0.035, torso_rz_low + 0.035, 0.0),
        (1.37, torso_rx_mid + 0.040, torso_rz_mid + 0.040, 0.0),
        (1.53, torso_rx_top + 0.035, torso_rz_top + 0.035, 0.0),
    ], COLORS["jacket"]))

    # Hoodie collar and back hood.
    clothes.append(loft_y([
        (1.48, 0.105, 0.085, -front_sign * 0.010),
        (1.56, 0.082, 0.070, -front_sign * 0.015),
    ], COLORS["hoodie"], sections=22))
    clothes.append(ellipsoid((0.0, 1.47, -front_sign * 0.095), (0.14, 0.11, 0.085), COLORS["hoodie"], 2))

    # Zipper on front.
    front_z = front_sign * (torso_rz_mid + 0.045)
    clothes.append(box((0.0, 1.285, front_z), (0.010, 0.42, 0.010), COLORS["metal"]))

    # Pants: actual leg centres estimated from source vertices.
    leg_band = v[(v[:, 1] > 0.25) & (v[:, 1] < 0.95)]
    left = leg_band[leg_band[:, 0] < 0]
    right = leg_band[leg_band[:, 0] > 0]
    x_left = float(np.median(left[:, 0])) if len(left) else -0.11
    x_right = float(np.median(right[:, 0])) if len(right) else 0.11
    leg_radius = 0.105
    for x, side in ((x_left, -1), (x_right, 1)):
        clothes.append(frustum_between((x, 0.13, 0.0), (x, 0.58, 0.0), 0.080, leg_radius, COLORS["pants"], 22))
        clothes.append(frustum_between((x, 0.56, 0.0), (x + side * 0.012, 1.02, 0.0), leg_radius, 0.125, COLORS["pants"], 22))
        clothes.append(box((x + side * 0.105, 0.77, front_sign * 0.020), (0.075, 0.150, 0.105), COLORS["pants"], rotation=(0, 0, side * 0.03)))

    # Waist/pelvis shell.
    clothes.append(loft_y([
        (0.91, 0.225, 0.130, 0.0),
        (1.02, 0.205, 0.125, 0.0),
        (1.08, 0.180, 0.115, 0.0),
    ], COLORS["pants"], sections=24))

    # Sleeves are anchored to the actual imported skeleton where available.
    bones = {}
    for side, suffix in ((-1, "L"), (1, "R")):
        shoulder = node_world_position(source_scene, [f"shoulder.{suffix}", f"upper_arm.{suffix}"])
        elbow = node_world_position(source_scene, [f"forearm.{suffix}"])
        wrist = node_world_position(source_scene, [f"hand.{suffix}"])
        shoulder = transform_point(shoulder, scale, y_shift)
        elbow = transform_point(elbow, scale, y_shift)
        wrist = transform_point(wrist, scale, y_shift)
        if shoulder is None or elbow is None or wrist is None:
            # Fail-soft visual fallback; source body remains authoritative geometry.
            shoulder = np.array([side * 0.22, 1.44, 0.0])
            elbow = np.array([side * 0.38, 1.26, 0.0])
            wrist = np.array([side * 0.50, 1.11, 0.0])
        bones[suffix] = {"shoulder": shoulder.tolist(), "elbow": elbow.tolist(), "wrist": wrist.tolist()}
        clothes.append(ellipsoid(shoulder, (0.078, 0.082, 0.078), COLORS["jacket"], 2))
        clothes.append(frustum_between(shoulder, elbow, 0.076, 0.061, COLORS["jacket"], 20))
        clothes.append(frustum_between(elbow, wrist, 0.061, 0.046, COLORS["jacket"], 20))

    # Cap centered from actual head vertices.
    head = v[v[:, 1] > 0.84 * v[:, 1].max()]
    hc = np.median(head, axis=0) if len(head) else np.array([0.0, 1.70, 0.0])
    cap_y = float(v[:, 1].max() - 0.025)
    clothes.append(ellipsoid((hc[0], cap_y, hc[2]), (0.115, 0.055, 0.110), COLORS["cap"], 2))
    clothes.append(box((hc[0], cap_y - 0.016, hc[2] + front_sign * 0.095), (0.150, 0.018, 0.110), COLORS["cap"], rotation=(front_sign * -0.08, 0, 0)))

    # Cross-body bag and strap, on actual front side inferred from head geometry.
    strap_z = front_sign * (torso_rz_mid + 0.052)
    clothes.append(frustum_between((0.17, 1.49, strap_z), (-0.15, 1.05, strap_z), 0.014, 0.014, COLORS["strap"], 12))
    clothes.append(box((-0.17, 1.02, front_sign * 0.175), (0.205, 0.175, 0.080), COLORS["bag"], rotation=(0, 0, -0.12)))
    clothes.append(box((-0.17, 1.02, front_sign * 0.216), (0.050, 0.030, 0.010), COLORS["metal"]))

    # Sneakers are accessory shells; hands/fingers remain from the downloaded base.
    for x in (x_left, x_right):
        clothes.append(ellipsoid((x, 0.058, front_sign * 0.025), (0.083, 0.055, 0.155), COLORS["shoe"], 2))
        clothes.append(box((x, 0.030, front_sign * 0.020), (0.165, 0.028, 0.255), COLORS["sole"]))

    return clothes, front_sign, bones


def render_scene(mesh: trimesh.Trimesh, camera_sign: int, label: str, output: Path):
    verts = mesh.vertices
    tris = verts[mesh.faces]
    polys = tris[:, :, [0, 1]]
    depth = tris[:, :, 2].mean(axis=1)
    # Matplotlib draws later polygons over earlier polygons: far -> near.
    order = np.argsort(depth) if camera_sign > 0 else np.argsort(-depth)
    colors = np.asarray(mesh.visual.face_colors)[:, :4] / 255.0
    light = np.array([-0.45, 0.80, float(camera_sign)])
    light /= np.linalg.norm(light)
    diffuse = np.clip(mesh.face_normals @ light, 0, 1)
    shaded = colors.copy()
    shaded[:, :3] *= (0.55 + 0.45 * diffuse)[:, None]

    fig, ax = plt.subplots(figsize=(5.8, 8.2), dpi=180, facecolor="#0A0D10")
    ax.set_facecolor("#0A0D10")
    ax.add_collection(PolyCollection(polys[order], facecolors=shaded[order], edgecolors=(0,0,0,0.08), linewidths=0.08))
    minx, maxx = verts[:, 0].min(), verts[:, 0].max()
    miny, maxy = verts[:, 1].min(), verts[:, 1].max()
    ax.set_xlim(minx - 0.14, maxx + 0.14)
    ax.set_ylim(miny - 0.05, maxy + 0.12)
    ax.set_aspect("equal")
    ax.axis("off")
    ax.plot([minx - 0.08, maxx + 0.08], [0, 0], color=(0.25,0.29,0.32), lw=1, alpha=0.65)
    ax.text(0.04, 0.965, label, transform=ax.transAxes, ha="left", va="top", color="white", fontsize=14, fontweight="bold")
    ax.text(0.04, 0.925, "RU · FIXER · DOWNLOADED CC0 BASE", transform=ax.transAxes, ha="left", va="top", color="#A3ADB4", fontsize=8.4)
    ax.text(0.04, 0.892, "actual source mesh + generated outfit", transform=ax.transAxes, ha="left", va="top", color="#737F87", fontsize=7.5)
    fig.savefig(output, bbox_inches="tight", pad_inches=0.10, facecolor=fig.get_facecolor())
    plt.close(fig)


def main() -> None:
    source_path = OUT / "male_base_mesh_source_cc0.glb"
    source_proof = fetch_source(source_path)

    source_scene = trimesh.load(source_path, force="scene", process=False)
    raw_body = bake_scene(source_scene)
    raw_bounds = raw_body.bounds.copy()
    raw_extents = raw_bounds[1] - raw_bounds[0]
    height_axis = int(np.argmax(raw_extents))
    if height_axis != 1:
        raise RuntimeError(f"unexpected source height axis {height_axis}; fail closed")

    scale = TARGET_HEIGHT_M / float(raw_extents[1])
    body = raw_body.copy()
    body.apply_scale(scale)
    y_shift = -float(body.bounds[0, 1])
    body.apply_translation([0.0, y_shift, 0.0])
    colorize(body, COLORS["skin"])

    outfit, front_sign, bone_anchors = build_outfit(body, source_scene, scale, y_shift)

    outfit_scene = trimesh.Scene()
    for i, item in enumerate(outfit):
        outfit_scene.add_geometry(item, geom_name=f"outfit_{i:03d}", node_name=f"outfit_{i:03d}")
    outfit_path = OUT / "ru_fixer_outfit_static.glb"
    outfit_path.write_bytes(outfit_scene.export(file_type="glb"))

    combined_scene = trimesh.Scene()
    combined_scene.add_geometry(body, geom_name="downloaded_cc0_body", node_name="downloaded_cc0_body")
    for i, item in enumerate(outfit):
        combined_scene.add_geometry(item, geom_name=f"outfit_{i:03d}", node_name=f"outfit_{i:03d}")
    combined_path = OUT / "ru_fixer_freebase_combined_static.glb"
    combined_path.write_bytes(combined_scene.export(file_type="glb"))

    # Load the exported derivative again; previews must come from exact exported bytes.
    reloaded = trimesh.load(combined_path, force="scene", process=False)
    preview_mesh = bake_scene(reloaded)
    front_path = OUT / "ru_fixer_freebase_front.png"
    back_path = OUT / "ru_fixer_freebase_back.png"
    render_scene(preview_mesh, front_sign, "FORAN", front_path)
    render_scene(preview_mesh, -front_sign, "BAK", back_path)

    from PIL import Image
    front_img = Image.open(front_path).convert("RGB")
    back_img = Image.open(back_path).convert("RGB")
    combo = Image.new("RGB", (front_img.width + back_img.width, max(front_img.height, back_img.height)), (10, 13, 16))
    combo.paste(front_img, (0, 0))
    combo.paste(back_img, (front_img.width, 0))
    combo_path = OUT / "ru_fixer_freebase_front_back.png"
    combo.save(combo_path, optimize=True)

    source_triangles = int(len(body.faces))
    outfit_triangles = int(sum(len(m.faces) for m in outfit))
    combined_triangles = int(len(preview_mesh.faces))

    # Validation readback.
    for p in (source_path, outfit_path, combined_path):
        trimesh.load(p, force="scene", process=False)

    metadata = {
        "schema": "nwe.character-prototype/0.1",
        "id": "ru_fixer_freebase_01",
        "project": "Romerikes Underverden / Norge World Engine prototype",
        "source": {
            "url": SOURCE_URL,
            "mirror_repository": SOURCE_MIRROR,
            "original_author": SOURCE_AUTHOR,
            "license": SOURCE_LICENSE,
            "expected_git_blob_sha1": SOURCE_GIT_BLOB_SHA1,
            **source_proof,
        },
        "source_model": {
            "rig_present_in_original_glb": True,
            "uv_unwrapped": True,
            "source_geometry_triangles": source_triangles,
            "target_height_m": TARGET_HEIGHT_M,
            "source_raw_bounds": raw_bounds.tolist(),
            "source_raw_extents": raw_extents.tolist(),
        },
        "derived": {
            "combined_static_file": combined_path.name,
            "outfit_static_file": outfit_path.name,
            "combined_triangles": combined_triangles,
            "outfit_triangles": outfit_triangles,
            "front_sign_z": front_sign,
            "bone_anchors_used_for_sleeves": bone_anchors,
            "outfit_skinned": False,
            "body_rebuilt_from_primitives": False,
            "preview_rendered_from_exported_combined_glb": True,
        },
        "limitations": [
            "The original downloaded CC0 GLB retains its rig; the current generated outfit is static and not yet skin-weighted.",
            "The combined preview GLB is a static derivative for visual validation, not the final animated NPC asset.",
            "No claim of photorealism; this proves the real-source-model modification pipeline.",
        ],
    }
    meta_path = OUT / "ru_fixer_freebase.asset.json"
    meta_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    license_note = OUT / "SOURCE_AND_LICENSE.txt"
    license_note.write_text(
        "RU Fixer free-base prototype\n"
        "============================\n\n"
        f"Source: {SOURCE_URL}\n"
        f"Mirror: https://github.com/{SOURCE_MIRROR}\n"
        f"Original author: {SOURCE_AUTHOR}\n"
        f"License: {SOURCE_LICENSE}\n"
        f"Verified Git blob SHA-1: {source_proof['git_blob_sha1']}\n"
        f"Source SHA-256: {source_proof['sha256']}\n\n"
        "The source model is preserved unchanged as male_base_mesh_source_cc0.glb.\n"
        "Generated RU clothing is project-created prototype geometry.\n",
        encoding="utf-8",
    )

    package = OUT / "ru_fixer_freebase_01.zip"
    if package.exists():
        package.unlink()
    with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for p in sorted(OUT.iterdir()):
            if p.name == package.name:
                continue
            zf.write(p, arcname=f"ru_fixer_freebase_01/{p.name}")

    print(json.dumps({
        "status": "PASS",
        "source_git_blob_sha1": source_proof["git_blob_sha1"],
        "source_sha256": source_proof["sha256"],
        "source_triangles": source_triangles,
        "outfit_triangles": outfit_triangles,
        "combined_triangles": combined_triangles,
        "front_sign_z": front_sign,
        "preview": str(combo_path),
        "package": str(package),
    }, indent=2))


if __name__ == "__main__":
    main()
