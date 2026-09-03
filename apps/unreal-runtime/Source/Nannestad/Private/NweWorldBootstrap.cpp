#include "NweWorldBootstrap.h"

#include "Components/DirectionalLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/SceneComponent.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/VolumetricCloudComponent.h"
#include "Dom/JsonObject.h"
#include "HAL/FileManager.h"
#include "Materials/Material.h"
#include "Materials/MaterialInterface.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
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
    SunLight->SetIntensity(8.0f);
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
    SkyLight->SetIntensity(0.8f);

    HeightFog = CreateDefaultSubobject<UExponentialHeightFogComponent>(TEXT("HeightFog"));
    HeightFog->SetupAttachment(SceneRoot);
    HeightFog->SetFogDensity(0.0015f);
    HeightFog->SetVolumetricFog(true);

    VolumetricCloud = CreateDefaultSubobject<UVolumetricCloudComponent>(TEXT("VolumetricCloud"));
    VolumetricCloud->SetupAttachment(SceneRoot);

    MaterialOverrides.Add(
        TEXT("terrain"),
        TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Nannestad/Materials/M_Terrain.M_Terrain"))));
    MaterialOverrides.Add(
        TEXT("road_asphalt"),
        TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Nannestad/Materials/M_Road_Asphalt.M_Road_Asphalt"))));
    MaterialOverrides.Add(
        TEXT("building_walls_source"),
        TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Nannestad/Materials/M_Wall_Source.M_Wall_Source"))));
    MaterialOverrides.Add(
        TEXT("building_roofs_source"),
        TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Nannestad/Materials/M_Roof_Source.M_Roof_Source"))));
    MaterialOverrides.Add(
        TEXT("building_walls_fallback"),
        TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Nannestad/Materials/M_Wall_Fallback.M_Wall_Fallback"))));
    MaterialOverrides.Add(
        TEXT("building_roofs_fallback"),
        TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Nannestad/Materials/M_Roof_Fallback.M_Roof_Fallback"))));
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

    UE_LOG(
        LogNweWorld,
        Display,
        TEXT("Loaded %d verified derived mesh packets for real Nannestad; normal runtime made zero raw geodata calls."),
        RuntimeMeshes.Num());
    return true;
}

UMaterialInterface* ANweWorldBootstrap::ResolveMaterial(const FString& MaterialId) const
{
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
