#pragma once

#include "CoreMinimal.h"

struct NANNESTAD_API FNweDecodedMeshPacket
{
    FString MaterialId;
    FString SourceSha256;
    TArray<FVector> PositionsCm;
    TArray<FVector> Normals;
    TArray<FVector2D> UV0;
    TArray<int32> Indices;
};

/** Strict reader for deterministic NWEMSH01 files emitted by the NWE pipeline. */
class NANNESTAD_API FNweMeshPacketReader
{
public:
    static bool Load(const FString& Filename, FNweDecodedMeshPacket& OutPacket, FString& OutError);
};
