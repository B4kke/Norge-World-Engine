#include "NweGeoReference.h"

bool FNweGeoReference::IsValid() const
{
    return FMath::IsFinite(OriginEastingM)
        && FMath::IsFinite(OriginNorthingM)
        && FMath::IsFinite(OriginUpM);
}

FVector3d FNweGeoReference::ProjectedToUnrealCm(
    const double EastingM,
    const double NorthingM,
    const double UpM) const
{
    check(IsValid());
    check(FMath::IsFinite(EastingM) && FMath::IsFinite(NorthingM) && FMath::IsFinite(UpM));
    FVector3d Result(
        (EastingM - OriginEastingM) * UnrealUnitsPerMetre,
        -(NorthingM - OriginNorthingM) * UnrealUnitsPerMetre,
        (UpM - OriginUpM) * UnrealUnitsPerMetre);
    Result.X = Result.X == 0.0 ? 0.0 : Result.X;
    Result.Y = Result.Y == 0.0 ? 0.0 : Result.Y;
    Result.Z = Result.Z == 0.0 ? 0.0 : Result.Z;
    return Result;
}

FVector3d FNweGeoReference::UnrealCmToProjected(const FVector3d& UnrealCm) const
{
    check(IsValid());
    check(!UnrealCm.ContainsNaN());
    return FVector3d(
        OriginEastingM + UnrealCm.X / UnrealUnitsPerMetre,
        OriginNorthingM - UnrealCm.Y / UnrealUnitsPerMetre,
        OriginUpM + UnrealCm.Z / UnrealUnitsPerMetre);
}
