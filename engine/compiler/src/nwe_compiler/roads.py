from __future__ import annotations

from dataclasses import dataclass
from math import hypot
from typing import Iterable

RoadPoint = tuple[float, float, float | None]


@dataclass(frozen=True)
class RoadSegment:
    source_id: str
    sequence_id: str | None
    segment_number: int | None
    road_type: str
    points: tuple[RoadPoint, ...]
    start_position: float | None = None
    end_position: float | None = None


@dataclass(frozen=True)
class RoadPath:
    path_id: str
    road_type: str
    points: tuple[RoadPoint, ...]
    source_segment_ids: tuple[str, ...]
    source_sequence_ids: tuple[str, ...]
    length_m: float


def polyline_length(points: Iterable[RoadPoint]) -> float:
    points = tuple(points)
    return sum(hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(points, points[1:]))


def _snap_key(point: RoadPoint, snap_m: float) -> tuple[int, int]:
    if snap_m <= 0:
        raise ValueError("snap_m must be positive")
    return (round(point[0] / snap_m), round(point[1] / snap_m))


def _dedupe_segments(segments: Iterable[RoadSegment], precision_m: float = 0.01) -> list[RoadSegment]:
    seen: set[tuple] = set()
    out: list[RoadSegment] = []
    scale = 1.0 / precision_m
    for segment in sorted(segments, key=lambda item: item.source_id):
        if len(segment.points) < 2:
            continue
        rounded = tuple((round(p[0] * scale), round(p[1] * scale)) for p in segment.points)
        reverse = tuple(reversed(rounded))
        signature = (segment.road_type.casefold(), min(rounded, reverse))
        if signature in seen:
            continue
        seen.add(signature)
        out.append(segment)
    return out


def compile_road_paths(segments: Iterable[RoadSegment], *, snap_m: float = 0.25) -> list[RoadPath]:
    """Merge endpoint-connected NVDB segments into deterministic road paths.

    The graph is built per road type. Degree-2 nodes collapse into one path;
    junctions and dead ends remain boundaries. Source sequence IDs remain
    provenance, but do not block merging across an otherwise continuous road.
    """
    source = _dedupe_segments(segments)
    if not source:
        return []

    node_map: dict[tuple[str, tuple[int, int]], list[tuple[int, bool]]] = {}
    endpoints: dict[int, tuple[tuple[int, int], tuple[int, int]]] = {}
    for index, segment in enumerate(source):
        road_class = segment.road_type.casefold()
        start_key = _snap_key(segment.points[0], snap_m)
        end_key = _snap_key(segment.points[-1], snap_m)
        endpoints[index] = (start_key, end_key)
        node_map.setdefault((road_class, start_key), []).append((index, True))
        node_map.setdefault((road_class, end_key), []).append((index, False))

    visited: set[int] = set()
    paths: list[RoadPath] = []

    def node_degree(index: int, key: tuple[int, int]) -> int:
        return len(node_map[(source[index].road_type.casefold(), key)])

    def orient(index: int, from_key: tuple[int, int]) -> list[RoadPoint]:
        start_key, end_key = endpoints[index]
        points = list(source[index].points)
        if start_key == from_key:
            return points
        if end_key == from_key:
            points.reverse()
            return points
        raise RuntimeError("segment is not incident to requested node")

    def emit_chain(start_index: int, start_key: tuple[int, int]) -> None:
        if start_index in visited:
            return
        chain_points: list[RoadPoint] = []
        chain_segments: list[int] = []
        current_index = start_index
        current_key = start_key

        while True:
            if current_index in visited:
                break
            points = orient(current_index, current_key)
            visited.add(current_index)
            chain_segments.append(current_index)
            if not chain_points:
                chain_points.extend(points)
            else:
                chain_points.extend(points[1:])

            next_key = _snap_key(points[-1], snap_m)
            if node_degree(current_index, next_key) != 2:
                break
            candidates = [
                idx
                for idx, _ in node_map[(source[current_index].road_type.casefold(), next_key)]
                if idx not in visited
            ]
            if len(candidates) != 1:
                break
            current_index = candidates[0]
            current_key = next_key

        if len(chain_points) < 2:
            return
        ids = tuple(source[i].source_id for i in chain_segments)
        seqs = tuple(sorted({source[i].sequence_id for i in chain_segments if source[i].sequence_id is not None}))
        road_type = source[chain_segments[0]].road_type
        paths.append(
            RoadPath(
                path_id=f"{road_type.casefold()}:{ids[0]}:{ids[-1]}",
                road_type=road_type,
                points=tuple(chain_points),
                source_segment_ids=ids,
                source_sequence_ids=seqs,
                length_m=polyline_length(chain_points),
            )
        )

    for index in range(len(source)):
        if index in visited:
            continue
        start_key, end_key = endpoints[index]
        start_degree = node_degree(index, start_key)
        end_degree = node_degree(index, end_key)
        if start_degree != 2 or end_degree != 2:
            emit_chain(index, start_key if start_degree != 2 else end_key)

    for index in range(len(source)):
        if index not in visited:
            emit_chain(index, endpoints[index][0])

    return sorted(paths, key=lambda item: item.path_id)
