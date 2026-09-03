#include "NweMeshPacket.h"

#include "Dom/JsonObject.h"
#include "HAL/PlatformFileManager.h"
#include "Misc/FileHelper.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace
{
constexpr int32 PrefixBytes = 12;
constexpr ANSICHAR MeshMagic[] = "NWEMSH01";
constexpr double MetresToCentimetres = 100.0;

uint32 ReadUInt32LE(const uint8* Bytes)
{
    return static_cast<uint32>(Bytes[0])
        | (static_cast<uint32>(Bytes[1]) << 8U)
        | (static_cast<uint32>(Bytes[2]) << 16U)
        | (static_cast<uint32>(Bytes[3]) << 24U);
}

float ReadFloat32LE(const uint8* Bytes)
{
    const uint32 Bits = ReadUInt32LE(Bytes);
    float Value = 0.0f;
    FMemory::Memcpy(&Value, &Bits, sizeof(float));
    return Value;
}

bool ReadPositiveCount(const TSharedPtr<FJsonObject>& Header, const TCHAR* Field, int32& OutValue)
{
    double Number = 0.0;
    if (!Header->TryGetNumberField(Field, Number)
        || !FMath::IsFinite(Number)
        || Number <= 0.0
        || Number > static_cast<double>(MAX_int32)
        || FMath::Floor(Number) != Number)
    {
        return false;
    }
    OutValue = static_cast<int32>(Number);
    return true;
}
} // namespace

bool FNweMeshPacketReader::Load(
    const FString& Filename,
    FNweDecodedMeshPacket& OutPacket,
    FString& OutError)
{
    OutPacket = FNweDecodedMeshPacket();
    OutError.Reset();

    TArray<uint8> Bytes;
    if (!FFileHelper::LoadFileToArray(Bytes, *Filename))
    {
        OutError = FString::Printf(TEXT("cannot read mesh packet: %s"), *Filename);
        return false;
    }
    if (Bytes.Num() < PrefixBytes || FMemory::Memcmp(Bytes.GetData(), MeshMagic, 8) != 0)
    {
        OutError = TEXT("mesh packet magic must be NWEMSH01");
        return false;
    }

    const uint32 HeaderByteCount = ReadUInt32LE(Bytes.GetData() + 8);
    if (HeaderByteCount <= 1U || HeaderByteCount > static_cast<uint32>(Bytes.Num() - PrefixBytes))
    {
        OutError = TEXT("mesh packet header length is invalid");
        return false;
    }

    const UTF8CHAR* HeaderData = reinterpret_cast<const UTF8CHAR*>(Bytes.GetData() + PrefixBytes);
    const FUTF8ToTCHAR HeaderConverter(HeaderData, static_cast<int32>(HeaderByteCount));
    const FString HeaderText(HeaderConverter.Length(), HeaderConverter.Get());
    TSharedPtr<FJsonObject> Header;
    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(HeaderText);
    if (!FJsonSerializer::Deserialize(Reader, Header) || !Header.IsValid())
    {
        OutError = TEXT("mesh packet header is invalid JSON");
        return false;
    }

    FString Schema;
    FString CoordinateFrame;
    FString Layout;
    if (!Header->TryGetStringField(TEXT("schema"), Schema)
        || Schema != TEXT("nwe.unreal-mesh-packet/0.1")
        || !Header->TryGetStringField(TEXT("coordinate_frame"), CoordinateFrame)
        || CoordinateFrame != TEXT("unreal-local-x-east-y-south-z-up-m")
        || !Header->TryGetStringField(TEXT("layout"), Layout)
        || Layout != TEXT("positions-f32-normals-f32-uv0-f32-indices-u32-le")
        || !Header->TryGetStringField(TEXT("material_id"), OutPacket.MaterialId)
        || OutPacket.MaterialId.IsEmpty()
        || !Header->TryGetStringField(TEXT("source_sha256"), OutPacket.SourceSha256)
        || OutPacket.SourceSha256.Len() != 64)
    {
        OutError = TEXT("mesh packet header contract is unsupported");
        return false;
    }

    int32 VertexCount = 0;
    int32 IndexCount = 0;
    if (!ReadPositiveCount(Header, TEXT("vertex_count"), VertexCount)
        || !ReadPositiveCount(Header, TEXT("index_count"), IndexCount)
        || IndexCount % 3 != 0)
    {
        OutError = TEXT("mesh packet counts are invalid");
        return false;
    }

    const uint64 PositionBytes = static_cast<uint64>(VertexCount) * 3ULL * sizeof(float);
    const uint64 NormalBytes = PositionBytes;
    const uint64 UVBytes = static_cast<uint64>(VertexCount) * 2ULL * sizeof(float);
    const uint64 IndexBytes = static_cast<uint64>(IndexCount) * sizeof(uint32);
    const uint64 PayloadBytes = PositionBytes + NormalBytes + UVBytes + IndexBytes;
    const uint64 PayloadOffset = PrefixBytes + static_cast<uint64>(HeaderByteCount);
    if (PayloadOffset + PayloadBytes != static_cast<uint64>(Bytes.Num()))
    {
        OutError = TEXT("mesh packet byte layout does not match its header");
        return false;
    }

    OutPacket.PositionsCm.Reserve(VertexCount);
    OutPacket.Normals.Reserve(VertexCount);
    OutPacket.UV0.Reserve(VertexCount);
    OutPacket.Indices.Reserve(IndexCount);

    const uint8* Cursor = Bytes.GetData() + PayloadOffset;
    for (int32 Index = 0; Index < VertexCount; ++Index)
    {
        const float X = ReadFloat32LE(Cursor);
        const float Y = ReadFloat32LE(Cursor + 4);
        const float Z = ReadFloat32LE(Cursor + 8);
        Cursor += 12;
        if (!FMath::IsFinite(X) || !FMath::IsFinite(Y) || !FMath::IsFinite(Z))
        {
            OutError = TEXT("mesh packet contains a non-finite position");
            return false;
        }
        OutPacket.PositionsCm.Emplace(
            static_cast<double>(X) * MetresToCentimetres,
            static_cast<double>(Y) * MetresToCentimetres,
            static_cast<double>(Z) * MetresToCentimetres);
    }
    for (int32 Index = 0; Index < VertexCount; ++Index)
    {
        const float X = ReadFloat32LE(Cursor);
        const float Y = ReadFloat32LE(Cursor + 4);
        const float Z = ReadFloat32LE(Cursor + 8);
        Cursor += 12;
        if (!FMath::IsFinite(X) || !FMath::IsFinite(Y) || !FMath::IsFinite(Z))
        {
            OutError = TEXT("mesh packet contains a non-finite normal");
            return false;
        }
        OutPacket.Normals.Emplace(X, Y, Z);
    }
    for (int32 Index = 0; Index < VertexCount; ++Index)
    {
        const float U = ReadFloat32LE(Cursor);
        const float V = ReadFloat32LE(Cursor + 4);
        Cursor += 8;
        if (!FMath::IsFinite(U) || !FMath::IsFinite(V))
        {
            OutError = TEXT("mesh packet contains non-finite UVs");
            return false;
        }
        OutPacket.UV0.Emplace(U, V);
    }
    for (int32 Index = 0; Index < IndexCount; ++Index)
    {
        const uint32 VertexIndex = ReadUInt32LE(Cursor);
        Cursor += 4;
        if (VertexIndex >= static_cast<uint32>(VertexCount))
        {
            OutError = TEXT("mesh packet index is outside the vertex array");
            return false;
        }
        OutPacket.Indices.Add(static_cast<int32>(VertexIndex));
    }
    return true;
}
