#include "NweWorldBootstrap.h"

#include "Components/DirectionalLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/VolumetricCloudComponent.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "Dom/JsonObject.h"
#include "Engine/StaticMesh.h"
#include "HAL/FileManager.h"
#include "Materials/Material.h"
#include "Materials/MaterialInterface.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Modules/ModuleManager.h"
#include "NweMeshPacket.h"
#include "ProceduralMeshComponent.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

DEFINE_LOG_CATEGORY_STATIC(LogNweWorld, Log, All);

ANweWorldBootstrap::ANweWorldBootstrap()
{
    PrimaryActorTick.bCanEverTick = false;

    SceneRoot = CreateDefaultSubobject<USceneComponent>(TEXT("SceneRoot"));
    SetRootComponent(SceneRoot);

    SunLight = CreateDefaultSubobject<UDirectionalLightComponent>(TEXT("SunLight"));
    SunLight->SetupAttachment(SceneRoot);
    SunLight->SetMobility(EComponentMobility::Movable);
    // UE directional-light intensity is lux. This is a clear Nordic daylight
    // starting point; exposure and weather authoring remain presentation data.
    SunLight->SetIntensity(75000.0f);
    SunLight->SetLightColor(FLinearColor(1.0f, 0.956f, 0.86f));
    SunLight->SetRelativeRotation(FRotator(-34.0, -28.0, 0.0));
    SunLight->bAtmosphereSunLight = true;
    SunLight->AtmosphereSunLightIndex = 0;
    SunLight->bCastShadows = true;

    SkyAtmosphere = CreateDefaultSubobject<USkyAtmosphereComponent>(TEXT("SkyAtmosphere"));
    SkyAtmosphere->SetupAttachment(SceneRoot);

    SkyLight = CreateDefaultSubobject<USkyLightComponent>(TEXT("SkyLight"));
    SkyLight->SetupAttachment(SceneRoot);
    SkyLight->SetMobility(EComponentMobility::Movable);
    SkyLight->bRealTimeCapture = true;
    SkyLight->SetIntensity(1.0f);

    HeightFog = CreateDefaultSubobject<UExponentialHeightFogComponent>(TEXT("HeightFog"));
    HeightFog->SetupAttachment(SceneRoot);
    HeightFog->SetFogDensity(0.0015f);
    HeightFog->SetVolumetricFog(true);

    VolumetricCloud = CreateDefaultSubobject<UVolumetricCloudComponent>(TEXT("VolumetricCloud"));
    VolumetricCloud->SetupAttachment(SceneRoot);

    MaterialOverrides.Add(
        TEXT("terrain"),
        TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Nannestad/GeneratedVisuals/Materials/M_Terrain.M_Terrain"))));
    MaterialOverrides.Add(
        TEXT("road_asphalt"),
        TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Nannestad/GeneratedVisuals/Materials/M_Road_Asphalt.M_Road_Asphalt"))));
    MaterialOverrides.Add(
        TEXT("building_walls_source"),
        TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Nannestad/GeneratedVisuals/Materials/M_Wall_Source.M_Wall_Source"))));
    MaterialOverrides.Add(
        TEXT("building_roofs_source"),
        TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Nannestad/GeneratedVisuals/Materials/M_Roof_Source.M_Roof_Source"))));
    MaterialOverrides.Add(
        TEXT("building_walls_fallback"),
        TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Nannestad/GeneratedVisuals/Materials/M_Wall_Fallback.M_Wall_Fallback"))));
    MaterialOverrides.Add(
        TEXT("building_roofs_fallback"),
        TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Nannestad/GeneratedVisuals/Materials/M_Roof_Fallback.M_Roof_Fallback"))));

    MaterialOverrides.Add(
        TEXT("building_wall_white"),
        TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Nannestad/GeneratedVisuals/Materials/M_Wall_White.M_Wall_White"))));
    MaterialOverrides.Add(
        TEXT("building_wall_yellow"),
        TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Nannestad/GeneratedVisuals/Materials/M_Wall_Yellow.M_Wall_Yellow"))));
    MaterialOverrides.Add(
        TEXT("building_wall_red"),
        TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Nannestad/GeneratedVisuals/Materials/M_Wall_Red.M_Wall_Red"))));
    MaterialOverrides.Add(
        TEXT("building_wall_grey"),
        TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Nannestad/GeneratedVisuals/Materials/M_Wall_Grey.M_Wall_Grey"))));
    MaterialOverrides.Add(
        TEXT("building_wall_wood"),
        TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Nannestad/GeneratedVisuals/Materials/M_Wall_Wood.M_Wall_Wood"))));
    MaterialOverrides.Add(
        TEXT("building_roof_red"),
        TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Nannestad/GeneratedVisuals/Materials/M_Roof_Red.M_Roof_Red"))));
    MaterialOverrides.Add(
        TEXT("building_roof_dark"),
        TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Nannestad/GeneratedVisuals/Materials/M_Roof_Dark.M_Roof_Dark"))));
    MaterialOverrides.Add(
        TEXT("building_roof_grey"),
        TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Nannestad/GeneratedVisuals/Materials/M_Roof_Grey.M_Roof_Grey"))));

    VegetationMeshOverrides.Add(
        TEXT("spruce"),
        TSoftObjectPtr<UStaticMesh>(FSoftObjectPath(TEXT("/Game/Nannestad/GeneratedVisuals/Vegetation/SM_SpruceProxy.SM_SpruceProxy"))));
    VegetationMeshOverrides.Add(
        TEXT("pine"),
        TSoftObjectPtr<UStaticMesh>(FSoftObjectPath(TEXT("/Game/Nannestad/GeneratedVisuals/Vegetation/SM_PineProxy.SM_PineProxy"))));
    VegetationMeshOverrides.Add(
        TEXT("deciduous"),
        TSoftObjectPtr<UStaticMesh>(FSoftObjectPath(TEXT("/Game/Nannestad/GeneratedVisuals/Vegetation/SM_DeciduousProxy.SM_DeciduousProxy"))));
}

void ANweWorldBootstrap::BeginPlay()
{
    Super::BeginPlay();
    FString Error;
    bWorldLoaded = LoadWorldPackage(Error);
    if (!bWorldLoaded)
    {
        UE_LOG(LogNweWorld, Error, TEXT("Nannestad world rejected: %s"), *Error);
    }
}

bool ANweWorldBootstrap::LoadWorldPackage(FString& OutError)
{
    const FString GeneratedRoot = FPaths::ConvertRelativePathToFull(
        FPaths::Combine(FPaths::ProjectContentDir(), TEXT("Nannestad/Generated")));
    const FString PackagePath = FPaths::ConvertRelativePathToFull(
        FPaths::Combine(FPaths::ProjectContentDir(), WorldPackageRelativePath));

    FString PackageText;
    if (!FFileHelper::LoadFileToString(PackageText, *PackagePath))
    {
        OutError = FString::Printf(
            TEXT("missing %s; run Tools/nwe_unreal_pipeline.py all before starting the game"),
            *PackagePath);
        return false;
    }

    TSharedPtr<FJsonObject> Package;
    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PackageText);
    if (!FJsonSerializer::Deserialize(Reader, Package) || !Package.IsValid())
    {
        OutError = TEXT("world-package.json is invalid JSON");
        return false;
    }
    FString PackageSchema;
    FString PackageStatus;
    if (!Package->TryGetStringField(TEXT("schema"), PackageSchema)
        || PackageSchema != TEXT("nwe.unreal-world-package/0.1")
        || !Package->TryGetStringField(TEXT("status"), PackageStatus)
        || PackageStatus != TEXT("VERIFIED_DERIVED_RENDER_PACKAGE"))
    {
        OutError = TEXT("world package schema/status is not accepted");
        return false;
    }
    const TSharedPtr<FJsonObject>* Source = nullptr;
    FString RuntimeProvenance;
    double RawSourceRuntimeCalls = -1.0;
    if (!Package->TryGetObjectField(TEXT("source"), Source)
        || !Source
        || !(*Source)->IsValid()
        || !(*Source)->TryGetStringField(TEXT("runtime_provenance"), RuntimeProvenance)
        || RuntimeProvenance != TEXT("READY_FOR_RUNTIME")
        || !(*Source)->TryGetNumberField(TEXT("raw_source_runtime_calls"), RawSourceRuntimeCalls)
        || RawSourceRuntimeCalls != 0.0)
    {
        OutError = TEXT("world package lacks verified offline source provenance");
        return false;
    }

    const TArray<TSharedPtr<FJsonValue>>* MeshDescriptors = nullptr;
    if (!Package->TryGetArrayField(TEXT("mesh_packets"), MeshDescriptors)
        || !MeshDescriptors
        || MeshDescriptors->IsEmpty())
    {
        OutError = TEXT("world package contains no mesh packets");
        return false;
    }

    int32 SectionIndex = 0;
    for (const TSharedPtr<FJsonValue>& DescriptorValue : *MeshDescriptors)
    {
        const TSharedPtr<FJsonObject> Descriptor = DescriptorValue.IsValid()
            ? DescriptorValue->AsObject()
            : nullptr;
        if (!Descriptor.IsValid())
        {
            OutError = TEXT("world package has an invalid mesh descriptor");
            return false;
        }
        FString RelativePath;
        FString MaterialId;
        FString PacketSha256;
        FString SourceSha256;
        bool bCreateCollision = false;
        double ExpectedByteSize = -1.0;
        if (!Descriptor->TryGetStringField(TEXT("path"), RelativePath)
            || !Descriptor->TryGetStringField(TEXT("material_id"), MaterialId)
            || !Descriptor->TryGetStringField(TEXT("sha256"), PacketSha256)
            || PacketSha256.Len() != 64
            || !Descriptor->TryGetStringField(TEXT("source_sha256"), SourceSha256)
            || SourceSha256.Len() != 64
            || !Descriptor->TryGetBoolField(TEXT("collision"), bCreateCollision)
            || !Descriptor->TryGetNumberField(TEXT("byte_size"), ExpectedByteSize)
            || !FMath::IsFinite(ExpectedByteSize)
            || ExpectedByteSize <= 0.0
            || ExpectedByteSize > static_cast<double>(MAX_int64)
            || FMath::FloorToDouble(ExpectedByteSize) != ExpectedByteSize)
        {
            OutError = TEXT("world package mesh descriptor is incomplete or invalid");
            return false;
        }
        if (RelativePath.IsEmpty()
            || !FPaths::IsRelative(RelativePath)
            || RelativePath.Contains(TEXT("..")))
        {
            OutError = TEXT("world package mesh path is unsafe");
            return false;
        }
        const FString Filename = FPaths::ConvertRelativePathToFull(
            FPaths::Combine(GeneratedRoot, RelativePath));
        if (!Filename.StartsWith(GeneratedRoot))
        {
            OutError = TEXT("world package mesh path escapes the generated root");
            return false;
        }
        if (IFileManager::Get().FileSize(*Filename) != static_cast<int64>(ExpectedByteSize))
        {
            OutError = FString::Printf(TEXT("derived mesh byte-size mismatch in %s"), *RelativePath);
            return false;
        }

        FNweDecodedMeshPacket Packet;
        FString PacketError;
        if (!FNweMeshPacketReader::Load(Filename, Packet, PacketError))
        {
            OutError = FString::Printf(TEXT("%s: %s"), *RelativePath, *PacketError);
            return false;
        }
        if (Packet.MaterialId != MaterialId || Packet.SourceSha256 != SourceSha256)
        {
            OutError = FString::Printf(TEXT("material/source identity mismatch in %s"), *RelativePath);
            return false;
        }

        UProceduralMeshComponent* Mesh = NewObject<UProceduralMeshComponent>(
            this,
            *FString::Printf(TEXT("NweMesh_%03d"), SectionIndex));
        Mesh->SetupAttachment(SceneRoot);
        Mesh->RegisterComponent();
        Mesh->SetMobility(EComponentMobility::Static);
        Mesh->bUseAsyncCooking = true;
        Mesh->bUseComplexAsSimpleCollision = bCreateCollision;
        Mesh->CreateMeshSection(
            0,
            Packet.PositionsCm,
            Packet.Indices,
            Packet.Normals,
            Packet.UV0,
            TArray<FColor>(),
            TArray<FProcMeshTangent>(),
            bCreateCollision);
        Mesh->SetMaterial(0, ResolveMaterial(Packet.MaterialId));
        RuntimeMeshes.Add(Mesh);
        ++SectionIndex;
    }

    if (!LoadVegetationLayer(Package, OutError))
    {
        return false;
    }

    UE_LOG(
        LogNweWorld,
        Display,
        TEXT("Loaded %d verified derived mesh packets and %d source-backed vegetation HISM groups for real Nannestad; normal runtime made zero raw geodata calls."),
        RuntimeMeshes.Num(),
        RuntimeVegetation.Num());
    return true;
}

bool ANweWorldBootstrap::LoadVegetationLayer(const TSharedPtr<FJsonObject>& Package, FString& OutError)
{
    const TSharedPtr<FJsonObject>* Vegetation = nullptr;
    if (!Package->TryGetObjectField(TEXT("vegetation"), Vegetation))
    {
        return true;
    }
    if (!Vegetation || !(*Vegetation).IsValid())
    {
        OutError = TEXT("vegetation layer is invalid");
        return false;
    }

    FString Schema;
    FString Status;
    if (!(*Vegetation)->TryGetStringField(TEXT("schema"), Schema)
        || Schema != TEXT("nwe.unreal-vegetation-layer/0.1")
        || !(*Vegetation)->TryGetStringField(TEXT("status"), Status)
        || Status != TEXT("VERIFIED_DERIVED_PRESENTATION_LAYER"))
    {
        OutError = TEXT("vegetation layer schema/status is not accepted");
        return false;
    }

    const TArray<TSharedPtr<FJsonValue>>* Instances = nullptr;
    if (!(*Vegetation)->TryGetArrayField(TEXT("instances"), Instances)
        || !Instances
        || Instances->IsEmpty())
    {
        OutError = TEXT("vegetation layer contains no instances");
        return false;
    }

    TMap<FString, TArray<UHierarchicalInstancedStaticMeshComponent*>> ComponentsByClass;
    TMap<FString, double> NativeHeightByClass;
    TMap<FString, double> NativeBottomByClass;
    int32 AcceptedInstances = 0;
    int32 MissingAssetInstances = 0;

    for (const TSharedPtr<FJsonValue>& Value : *Instances)
    {
        const TSharedPtr<FJsonObject> Instance = Value.IsValid() ? Value->AsObject() : nullptr;
        if (!Instance.IsValid())
        {
            OutError = TEXT("vegetation layer contains an invalid instance");
            return false;
        }

        FString AssetClass;
        double YawDegrees = 0.0;
        double TargetHeightM = 0.0;
        const TArray<TSharedPtr<FJsonValue>>* Location = nullptr;
        if (!Instance->TryGetStringField(TEXT("asset_class"), AssetClass)
            || !Instance->TryGetNumberField(TEXT("yaw_deg"), YawDegrees)
            || !Instance->TryGetNumberField(TEXT("target_height_m"), TargetHeightM)
            || !Instance->TryGetArrayField(TEXT("location_cm"), Location)
            || !Location
            || Location->Num() != 3
            || !FMath::IsFinite(YawDegrees)
            || !FMath::IsFinite(TargetHeightM)
            || TargetHeightM <= 0.5
            || TargetHeightM > 60.0)
        {
            OutError = TEXT("vegetation instance contract is invalid");
            return false;
        }

        FVector LocationCm;
        for (int32 Axis = 0; Axis < 3; ++Axis)
        {
            double Coordinate = 0.0;
            if (!(*Location)[Axis].IsValid()
                || !(*Location)[Axis]->TryGetNumber(Coordinate)
                || !FMath::IsFinite(Coordinate))
            {
                OutError = TEXT("vegetation instance contains an invalid location");
                return false;
            }
            LocationCm[Axis] = Coordinate;
        }

        TArray<UHierarchicalInstancedStaticMeshComponent*>* ExistingComponents =
            ComponentsByClass.Find(AssetClass);
        if (!ExistingComponents)
        {
            const TArray<UStaticMesh*> MeshParts = ResolveVegetationMeshes(AssetClass);
            if (MeshParts.IsEmpty())
            {
                ++MissingAssetInstances;
                continue;
            }

            FBox CombinedBounds(EForceInit::ForceInit);
            for (UStaticMesh* StaticMesh : MeshParts)
            {
                const FBoxSphereBounds Bounds = StaticMesh->GetBounds();
                CombinedBounds += FBox::BuildAABB(Bounds.Origin, Bounds.BoxExtent);
            }
            const double NativeHeightCm = CombinedBounds.GetSize().Z;
            if (!(NativeHeightCm > 1.0) || !FMath::IsFinite(NativeHeightCm))
            {
                OutError = FString::Printf(TEXT("vegetation mesh class '%s' has invalid combined bounds"), *AssetClass);
                return false;
            }

            TArray<UHierarchicalInstancedStaticMeshComponent*> NewComponents;
            NewComponents.Reserve(MeshParts.Num());
            for (int32 PartIndex = 0; PartIndex < MeshParts.Num(); ++PartIndex)
            {
                UHierarchicalInstancedStaticMeshComponent* Component =
                    NewObject<UHierarchicalInstancedStaticMeshComponent>(
                        this,
                        *FString::Printf(TEXT("NweVegetation_%s_%02d"), *AssetClass, PartIndex));
                Component->SetupAttachment(SceneRoot);
                Component->SetMobility(EComponentMobility::Static);
                Component->SetStaticMesh(MeshParts[PartIndex]);
                Component->SetCollisionEnabled(ECollisionEnabled::NoCollision);
                Component->SetCastShadow(true);
                Component->SetCullDistances(30000, 220000);
                Component->RegisterComponent();
                NewComponents.Add(Component);
                RuntimeVegetation.Add(Component);
            }
            ComponentsByClass.Add(AssetClass, NewComponents);
            NativeHeightByClass.Add(AssetClass, NativeHeightCm);
            NativeBottomByClass.Add(AssetClass, CombinedBounds.Min.Z);
            ExistingComponents = ComponentsByClass.Find(AssetClass);
        }

        const double* NativeHeightCm = NativeHeightByClass.Find(AssetClass);
        const double* NativeBottomCm = NativeBottomByClass.Find(AssetClass);
        if (!ExistingComponents || !NativeHeightCm || !NativeBottomCm)
        {
            OutError = FString::Printf(TEXT("vegetation class '%s' failed to initialize"), *AssetClass);
            return false;
        }

        const double Scale = TargetHeightM * 100.0 / *NativeHeightCm;
        LocationCm.Z -= *NativeBottomCm * Scale;
        const FTransform Transform(
            FRotator(0.0, YawDegrees, 0.0),
            LocationCm,
            FVector(Scale));
        for (UHierarchicalInstancedStaticMeshComponent* Component : *ExistingComponents)
        {
            Component->AddInstance(Transform, false);
        }
        ++AcceptedInstances;
    }

    for (const TPair<FString, TArray<UHierarchicalInstancedStaticMeshComponent*>>& Pair : ComponentsByClass)
    {
        for (UHierarchicalInstancedStaticMeshComponent* Component : Pair.Value)
        {
            Component->BuildTreeIfOutdated(true, false);
        }
    }

    UE_LOG(
        LogNweWorld,
        Display,
        TEXT("Vegetation presentation: %d SR16V representative instances realized through %d HISM mesh parts; %d skipped because authored tree proxy assets are not installed."),
        AcceptedInstances,
        RuntimeVegetation.Num(),
        MissingAssetInstances);
    return true;
}

TArray<UStaticMesh*> ANweWorldBootstrap::ResolveVegetationMeshes(const FString& AssetClass) const
{
    TArray<UStaticMesh*> Result;
    if (const TSoftObjectPtr<UStaticMesh>* Override = VegetationMeshOverrides.Find(FName(*AssetClass)))
    {
        if (UStaticMesh* Loaded = Override->LoadSynchronous())
        {
            Result.Add(Loaded);
            return Result;
        }
    }

    const FString Folder = FString::Printf(
        TEXT("/Game/Nannestad/GeneratedVisuals/Vegetation/%s/Selected"),
        *AssetClass);
    FAssetRegistryModule& AssetRegistryModule =
        FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry"));
    TArray<FAssetData> Assets;
    AssetRegistryModule.Get().GetAssetsByPath(FName(*Folder), Assets, true, false);
    Assets.Sort([](const FAssetData& A, const FAssetData& B)
    {
        return A.AssetName.LexicalLess(B.AssetName);
    });
    for (const FAssetData& Asset : Assets)
    {
        if (UStaticMesh* StaticMesh = Cast<UStaticMesh>(Asset.GetAsset()))
        {
            Result.Add(StaticMesh);
        }
    }
    if (Result.IsEmpty())
    {
        UE_LOG(
            LogNweWorld,
            Warning,
            TEXT("No authored vegetation proxy for SR16V presentation class '%s'. Expected StaticMesh assets below %s; source forest semantics remain packaged."),
            *AssetClass,
            *Folder);
    }
    return Result;
}

UMaterialInterface* ANweWorldBootstrap::ResolveMaterial(const FString& MaterialId) const
{
    if (MaterialId == TEXT("terrain"))
    {
        TSoftObjectPtr<UMaterialInterface> ImageryMaterial(
            FSoftObjectPath(TEXT("/Game/Nannestad/GeneratedVisuals/Materials/M_Terrain_Imagery.M_Terrain_Imagery")));
        if (UMaterialInterface* LoadedImagery = ImageryMaterial.LoadSynchronous())
        {
            return LoadedImagery;
        }
    }

    const TSoftObjectPtr<UMaterialInterface>* Material = MaterialOverrides.Find(FName(*MaterialId));
    if (Material)
    {
        if (UMaterialInterface* Loaded = Material->LoadSynchronous())
        {
            return Loaded;
        }
    }
    UE_LOG(
        LogNweWorld,
        Warning,
        TEXT("No authored material for '%s'; using the engine default. Geographic geometry remains valid, visual quality does not."),
        *MaterialId);
    return UMaterial::GetDefaultMaterial(MD_Surface);
}
