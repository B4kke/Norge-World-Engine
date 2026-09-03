#if WITH_DEV_AUTOMATION_TESTS

#include "Misc/AutomationTest.h"
#include "NweGeoReference.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FNweGeoReferenceRoundTripTest,
    "NWE.Unreal.GeoReference.RoundTrip",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FNweGeoReferenceRoundTripTest::RunTest(const FString& Parameters)
{
    const FNweGeoReference Reference;
    const FVector3d Local = Reference.ProjectedToUnrealCm(611625.25, 6677420.75, 194.5);
    TestEqual(TEXT("east maps to +X cm"), Local.X, 12525.0);
    TestEqual(TEXT("north maps to -Y cm"), Local.Y, 7925.0);
    TestEqual(TEXT("NN2000 up maps to +Z cm"), Local.Z, 19450.0);

    const FVector3d Projected = Reference.UnrealCmToProjected(Local);
    TestTrue(TEXT("easting round trip"), FMath::IsNearlyEqual(Projected.X, 611625.25, 1e-9));
    TestTrue(TEXT("northing round trip"), FMath::IsNearlyEqual(Projected.Y, 6677420.75, 1e-9));
    TestTrue(TEXT("height round trip"), FMath::IsNearlyEqual(Projected.Z, 194.5, 1e-9));
    return true;
}

#endif
