from __future__ import annotations

from dataclasses import asdict, dataclass


class Dtm1ProviderEdgeDomainError(RuntimeError):
    pass


@dataclass(frozen=True)
class ProviderEdgeDomainEvidence:
    provider_nominal_tile_m: int
    source_raster_width_px: int
    source_raster_height_px: int
    pixel_size_m: float
    export_maptile_size_m: int
    export_maptile_area_m2: int
    export_original_partition_control_present: bool
    service_max_image_width_px: int
    service_max_image_height_px: int
    raster_excess_x_m: float
    raster_excess_y_m: float
    centered_core_inset_px: int
    provider_15000_domain_signals_consistent: bool
    explicit_excess_border_semantics_present: bool
    explicit_core_domain_authoritative: bool
    explicit_semantics_source_family_bound: bool
    explicit_buffer_per_side_m: float | None
    authorizes_core_clip: bool
    production_seam_authority: bool
    authority_status: str


def assess_provider_edge_domain(
    *,
    provider_nominal_tile_m: int,
    source_raster_width_px: int,
    source_raster_height_px: int,
    pixel_size_m: float,
    export_maptile_size_m: int,
    export_maptile_area_m2: int,
    export_original_partition_control_present: bool,
    service_max_image_width_px: int,
    service_max_image_height_px: int,
    explicit_excess_border_semantics_present: bool = False,
    explicit_core_domain_authoritative: bool = False,
    explicit_semantics_source_family_bound: bool = False,
    explicit_buffer_per_side_m: float | None = None,
) -> dict:
    """Classify provider edge-domain evidence without inferring border ownership.

    The current provider surfaces independently encode a nominal 15 km DTM1
    distribution, a public export map-tile area for 15000 m, and a 15000 x 15000
    DTM ImageServer output limit. The SHA-addressed Atom source rasters are
    measured as 15010 x 15010 at 1 m.

    Those facts establish a strong centered-core geometry candidate but do not
    state what the ten excess source metres mean. Production core clipping is
    authorized only if future provider evidence explicitly binds the DTM1 source
    family to an authoritative 15 km core and an exact five-metre per-side
    buffer/overscan rule.
    """
    bools = (
        export_original_partition_control_present,
        explicit_excess_border_semantics_present,
        explicit_core_domain_authoritative,
        explicit_semantics_source_family_bound,
    )
    if any(type(value) is not bool for value in bools):
        raise Dtm1ProviderEdgeDomainError("provider evidence flags must be booleans")

    ints = (
        provider_nominal_tile_m,
        source_raster_width_px,
        source_raster_height_px,
        export_maptile_size_m,
        export_maptile_area_m2,
        service_max_image_width_px,
        service_max_image_height_px,
    )
    if any(type(value) is not int or value <= 0 for value in ints):
        raise Dtm1ProviderEdgeDomainError("edge-domain integer fields must be positive integers")
    if not isinstance(pixel_size_m, (int, float)) or isinstance(pixel_size_m, bool) or pixel_size_m <= 0:
        raise Dtm1ProviderEdgeDomainError("pixel_size_m must be positive")

    if provider_nominal_tile_m != 15_000:
        raise Dtm1ProviderEdgeDomainError("current DTM1 provider contract requires a 15000 m nominal tile")
    if export_maptile_size_m != provider_nominal_tile_m:
        raise Dtm1ProviderEdgeDomainError("provider nominal tile and export map-tile size disagree")
    expected_area = provider_nominal_tile_m * provider_nominal_tile_m
    if export_maptile_area_m2 != expected_area:
        raise Dtm1ProviderEdgeDomainError("export map-tile area does not equal the nominal 15 km domain")

    span_x_m = source_raster_width_px * float(pixel_size_m)
    span_y_m = source_raster_height_px * float(pixel_size_m)
    excess_x_m = span_x_m - provider_nominal_tile_m
    excess_y_m = span_y_m - provider_nominal_tile_m
    if excess_x_m < 0 or excess_y_m < 0:
        raise Dtm1ProviderEdgeDomainError("source raster is smaller than the provider nominal tile")

    inset_x_px = excess_x_m / (2.0 * float(pixel_size_m))
    inset_y_px = excess_y_m / (2.0 * float(pixel_size_m))
    if not inset_x_px.is_integer() or not inset_y_px.is_integer() or inset_x_px != inset_y_px:
        raise Dtm1ProviderEdgeDomainError("source excess does not yield one symmetric integer-pixel core inset")
    centered_inset_px = int(inset_x_px)

    provider_signals_consistent = (
        export_original_partition_control_present
        and service_max_image_width_px == provider_nominal_tile_m
        and service_max_image_height_px == provider_nominal_tile_m
        and centered_inset_px == 5
    )

    if explicit_buffer_per_side_m is not None:
        if not isinstance(explicit_buffer_per_side_m, (int, float)) or isinstance(explicit_buffer_per_side_m, bool):
            raise Dtm1ProviderEdgeDomainError("explicit_buffer_per_side_m must be numeric or None")
        if not explicit_excess_border_semantics_present:
            raise Dtm1ProviderEdgeDomainError("explicit buffer value requires explicit border semantics")
    if explicit_core_domain_authoritative and not explicit_excess_border_semantics_present:
        raise Dtm1ProviderEdgeDomainError("authoritative core claim requires explicit border semantics")
    if explicit_semantics_source_family_bound and not explicit_excess_border_semantics_present:
        raise Dtm1ProviderEdgeDomainError("source-family binding requires explicit border semantics")

    expected_buffer_m = centered_inset_px * float(pixel_size_m)
    if explicit_excess_border_semantics_present:
        if explicit_buffer_per_side_m is None:
            raise Dtm1ProviderEdgeDomainError("explicit border semantics require a buffer size")
        if float(explicit_buffer_per_side_m) != expected_buffer_m:
            raise Dtm1ProviderEdgeDomainError("provider buffer size conflicts with measured source geometry")

    authorizes_core_clip = (
        provider_signals_consistent
        and explicit_excess_border_semantics_present
        and explicit_core_domain_authoritative
        and explicit_semantics_source_family_bound
        and explicit_buffer_per_side_m is not None
        and float(explicit_buffer_per_side_m) == expected_buffer_m
    )

    evidence = ProviderEdgeDomainEvidence(
        provider_nominal_tile_m=provider_nominal_tile_m,
        source_raster_width_px=source_raster_width_px,
        source_raster_height_px=source_raster_height_px,
        pixel_size_m=float(pixel_size_m),
        export_maptile_size_m=export_maptile_size_m,
        export_maptile_area_m2=export_maptile_area_m2,
        export_original_partition_control_present=export_original_partition_control_present,
        service_max_image_width_px=service_max_image_width_px,
        service_max_image_height_px=service_max_image_height_px,
        raster_excess_x_m=excess_x_m,
        raster_excess_y_m=excess_y_m,
        centered_core_inset_px=centered_inset_px,
        provider_15000_domain_signals_consistent=provider_signals_consistent,
        explicit_excess_border_semantics_present=explicit_excess_border_semantics_present,
        explicit_core_domain_authoritative=explicit_core_domain_authoritative,
        explicit_semantics_source_family_bound=explicit_semantics_source_family_bound,
        explicit_buffer_per_side_m=(
            None if explicit_buffer_per_side_m is None else float(explicit_buffer_per_side_m)
        ),
        authorizes_core_clip=authorizes_core_clip,
        production_seam_authority=authorizes_core_clip,
        authority_status="PROVEN" if authorizes_core_clip else "UNPROVEN",
    )
    return {
        "schema": "nwe.dtm1-provider-edge-domain/0.1",
        "evidence": asdict(evidence),
        "claim_calibration": {
            "fact": (
                "provider surfaces consistently encode a 15000 m domain while the measured source raster spans 15010 m"
                if provider_signals_consistent
                else "provider 15000 m domain signals are incomplete or inconsistent"
            ),
            "derived_geometry": (
                f"a centered {provider_nominal_tile_m} m core requires {centered_inset_px} source pixels per side"
            ),
            "not_proven": (
                "that the excess source pixels are non-authoritative buffer/overscan or may be discarded"
                if not authorizes_core_clip
                else "none within this edge-domain contract"
            ),
            "production_seam_authority": authorizes_core_clip,
            "authority_status": "PROVEN" if authorizes_core_clip else "UNPROVEN",
        },
    }
