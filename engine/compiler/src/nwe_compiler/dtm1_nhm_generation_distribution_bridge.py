from __future__ import annotations

from dataclasses import asdict, dataclass


class Dtm1NhmGenerationDistributionBridgeError(RuntimeError):
    pass


@dataclass(frozen=True)
class NhmGenerationDistributionEvidence:
    nhm_update_rule_present: bool
    fvl_products_derived_automatically: bool
    project_grid_generalized_to_dtm1: bool
    nhm_export_accepts_dtm1: bool
    nhm_export_exposes_original_partition_control: bool
    dtm1_catalog_binds_generation_to_atom_distribution: bool
    atom_distribution_nominal_tile_m: int
    generation_distribution_bridge_supported: bool
    export_byte_identity_proven: bool
    authorizes_excess_border_discard: bool
    production_seam_authority: bool
    authority_status: str


def assess_nhm_generation_distribution_bridge(
    *,
    nhm_update_rule_present: bool,
    fvl_products_derived_automatically: bool,
    project_grid_generalized_to_dtm1: bool,
    nhm_export_accepts_dtm1: bool,
    nhm_export_exposes_original_partition_control: bool,
    dtm1_catalog_binds_generation_to_atom_distribution: bool,
    atom_distribution_nominal_tile_m: int,
) -> dict:
    """Bind provider NHM generation semantics to the downloadable DTM1 family.

    The DTM1 dataset catalog itself can establish the important source-family
    bridge: project grids are generalized to the 1 m national DTM1 model and the
    same dataset advertises the GeoTIFF Atom distribution in nominal 15 km tiles.
    Høydedata's export configuration is supporting evidence because it separately
    exposes NHM DTM1 export and an original-partition control.

    This contract deliberately does not claim that a StartExport response is
    byte-identical to an Atom GeoTIFF, nor does it interpret the observed 15,010 m
    raster extent. A complete generation/distribution bridge is therefore not
    permission to discard five pixels per side.
    """
    flags = (
        nhm_update_rule_present,
        fvl_products_derived_automatically,
        project_grid_generalized_to_dtm1,
        nhm_export_accepts_dtm1,
        nhm_export_exposes_original_partition_control,
        dtm1_catalog_binds_generation_to_atom_distribution,
    )
    if any(type(value) is not bool for value in flags):
        raise Dtm1NhmGenerationDistributionBridgeError(
            "provider evidence flags must be booleans"
        )
    if (
        type(atom_distribution_nominal_tile_m) is not int
        or atom_distribution_nominal_tile_m <= 0
    ):
        raise Dtm1NhmGenerationDistributionBridgeError(
            "atom_distribution_nominal_tile_m must be a positive integer"
        )
    if atom_distribution_nominal_tile_m != 15_000:
        raise Dtm1NhmGenerationDistributionBridgeError(
            "current DTM1 provider contract requires a 15000 m nominal Atom tile"
        )

    bridge_supported = all(flags)
    evidence = NhmGenerationDistributionEvidence(
        nhm_update_rule_present=flags[0],
        fvl_products_derived_automatically=flags[1],
        project_grid_generalized_to_dtm1=flags[2],
        nhm_export_accepts_dtm1=flags[3],
        nhm_export_exposes_original_partition_control=flags[4],
        dtm1_catalog_binds_generation_to_atom_distribution=flags[5],
        atom_distribution_nominal_tile_m=atom_distribution_nominal_tile_m,
        generation_distribution_bridge_supported=bridge_supported,
        export_byte_identity_proven=False,
        authorizes_excess_border_discard=False,
        production_seam_authority=False,
        authority_status="UNPROVEN",
    )
    return {
        "schema": "nwe.dtm1-nhm-generation-distribution-bridge/0.1",
        "evidence": asdict(evidence),
        "claim_calibration": {
            "fact": (
                "provider evidence binds NHM project/grid generation to the downloadable DTM1 "
                "15 km source family"
                if bridge_supported
                else "provider generation/distribution bridge is incomplete"
            ),
            "supporting_export_evidence": (
                "NHM export accepts DTM1 and exposes original-dataset partitioning, without "
                "proving byte identity with Atom GeoTIFFs"
            ),
            "remaining_blocker": (
                "provider semantics for the observed 10 m raster excess: whether the 5 px per-side "
                "border is disposable buffer/overscan or otherwise participates in authoritative samples"
            ),
            "not_proven": (
                "StartExport-to-Atom byte identity, core clipping, overlap winner, or production seam transform"
            ),
            "production_seam_authority": False,
            "authority_status": "UNPROVEN",
        },
    }
