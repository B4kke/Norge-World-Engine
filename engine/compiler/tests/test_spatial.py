from nwe_compiler.spatial import (
    declared_extent_covers_target,
    parse_georss_box,
    parse_georss_polygon,
    target_wgs84_polygon,
)


def test_box_and_polygon_cover_target():
    target = target_wgs84_polygon()
    box = parse_georss_box("60.10 10.80 60.35 11.25")
    polygon = parse_georss_polygon("60.10 10.80 60.10 11.25 60.35 11.25 60.35 10.80 60.10 10.80")
    assert declared_extent_covers_target(box, target)
    assert declared_extent_covers_target(polygon, target)


def test_adversarial_triangle_bbox_is_not_authority():
    target = target_wgs84_polygon()
    triangle = parse_georss_polygon("60.10 10.80 60.35 10.80 60.35 11.25 60.10 10.80")
    assert triangle.geometry.envelope.covers(target)
    assert not triangle.geometry.covers(target)
    assert not declared_extent_covers_target(triangle, target)
