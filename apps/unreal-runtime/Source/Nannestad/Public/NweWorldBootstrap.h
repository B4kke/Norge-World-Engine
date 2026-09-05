#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "NweWorldBootstrap.generated.h"

class UDirectionalLightComponent;
class UExponentialHeightFogComponent;
class UMaterialInterface;
class UProceduralMeshComponent;
class USceneComponent;
class USkyAtmosphereComponent;
class USkyLightComponent;
class UVolumetricCloudComponent;

/** Loads the verified derived Nannestad package and realizes disposable UE meshes. */
UCLASS()
class NANNESTAD_API ANweWorldBootstrap : public AActor
{
    GENERATED_BODY()

public:
    ANweWorldBootstrap();

    UPROPERTY(EditAnywhere, Category = "NWE|World")
    FString WorldPackageRelativePath = TEXT("Nannestad/Generated/world-package.json");

    UPROPERTY(EditAnywhere, Category = "NWE|World")
    TMap<FName, TSoftObjectPtr<UMaterialInterface>> MaterialOverrides;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "NWE|World")
    bool bWorldLoaded = false;

protected:
    virtual void BeginPlay() override;

private:
    UPROPERTY(VisibleAnywhere)
    TObjectPtr<USceneComponent> SceneRoot;

    UPROPERTY(VisibleAnywhere)
    TObjectPtr<UDirectionalLightComponent> SunLight;

    UPROPERTY(VisibleAnywhere)
    TObjectPtr<USkyLightComponent> SkyLight;

    UPROPERTY(VisibleAnywhere)
    TObjectPtr<USkyAtmosphereComponent> SkyAtmosphere;

    UPROPERTY(VisibleAnywhere)
    TObjectPtr<UExponentialHeightFogComponent> HeightFog;

    UPROPERTY(VisibleAnywhere)
    TObjectPtr<UVolumetricCloudComponent> VolumetricCloud;

    UPROPERTY(Transient)
    TArray<TObjectPtr<UProceduralMeshComponent>> RuntimeMeshes;

    bool LoadWorldPackage(FString& OutError);
    UMaterialInterface* ResolveMaterial(const FString& MaterialId) const;
};
