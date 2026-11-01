#pragma once

#include "CoreMinimal.h"
#include "NweGeoReference.generated.h"

/**
 * Explicit flat-world mapping for the accepted 1 km Nannestad tile.
 *
 * Authoritative coordinates remain EPSG:25832 metres + NN2000 metres.
 * Unreal receives local centimetres with X=east, Y=south, Z=up. The north
 * sign inversion is deliberate: it converts the geospatial right-handed ENU
 * frame to Unreal's left-handed frame without hiding an axis swap in assets.
 */
USTRUCT(BlueprintType)
struct NANNESTAD_API FNweGeoReference
{
    GENERATED_BODY()

    static constexpr double UnrealUnitsPerMetre = 100.0;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "NWE|Georeference")
    double OriginEastingM = 611500.0;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "NWE|Georeference")
    double OriginNorthingM = 6677500.0;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "NWE|Georeference")
    double OriginUpM = 0.0;

    bool IsValid() const;
    FVector3d ProjectedToUnrealCm(double EastingM, double NorthingM, double UpM) const;
    FVector3d UnrealCmToProjected(const FVector3d& UnrealCm) const;
};
