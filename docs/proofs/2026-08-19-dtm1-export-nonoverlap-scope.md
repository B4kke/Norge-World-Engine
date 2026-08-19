# FORGE proof — Høydedata export non-overlap scope

Date: 2026-08-19  
Gate: `P0-MULTITILE-TERRAIN-01`  
Role: FORGE

## Question

Does Høydedata's published export API provide an authoritative non-overlap transform for the national DTM1 (`NHM=1`) route rasters used by NWE?

## Provider evidence

Høydedata's published `Webtjenester` documentation exposes `ProjectProduct NonOverlappingProjects` and states that value `1` causes projects to be merged/samkopiert rather than all projects being downloaded. Critically, the option is documented in the project-product export surface and marked as applicable/mandatory when `NHM=0` (project export). The same contract defines `NHM=1` as `Nasjonale høydemodeller`.

Source: `https://hoydedata.no/LaserInnsyn2/dok/webtjenester.pdf` (provider-owned Høydedata documentation, retrieved 2026-08-19).

Kartverket separately documents that terrain models are generated from point clouds and distributed as GeoTIFF, with WCS/WFS/WMS and REST services available. This confirms service availability but does not expand the scope of `NonOverlappingProjects` to national-grid source authority.

## Implementation

Added `nwe_compiler.dtm1_export_contract` plus adversarial tests. The classifier encodes only the documented scope boundary and permanently emits `production_seam_authority=false`. Unknown NHM modes or a changed provider scope fail closed pending source re-review.

## What this proves

Høydedata has an explicit provider-owned concept for merging overlapping **project exports**, but the currently published export contract does not document that control as the seam rule for `NHM=1` national height-model route rasters.

This is useful negative evidence: NWE must not silently reuse `NonOverlappingProjects=1` as the missing DTM1 seam transform.

## What this does not prove

It does not establish a 15 km authoritative core, disposable ~5 m halo, first/newest/mean/min/max/tolerance/filename priority, or equivalence between a project-export merge and the separately downloaded SHA-addressed DTM1 GeoTIFFs. `P0-MULTITILE-TERRAIN-01` therefore remains fail-closed.

## Data contract

No new source authority is adopted. No raw GeoTIFF/LAS/LAZ data is committed. Existing DTM1 CRS, NN2000 Z semantics, licensing/attribution and content-addressed raw-cache rules remain unchanged.

## Next

Interrogate the provider's national-height-model export/request contract and exact Nannestad catalog relations for a machine-readable core/index or generation identity. If no NHM-specific overlap transform is documented, retain fail-closed behavior rather than importing project-export semantics.
