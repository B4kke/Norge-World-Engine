using UnrealBuildTool;

public class Nannestad : ModuleRules
{
    public Nannestad(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        AddEngineThirdPartyPrivateStaticDependencies(Target, "OpenSSL");

        PublicDependencyModuleNames.AddRange(
            new string[]
            {
                "Core",
                "CoreUObject",
                "Engine",
                "AssetRegistry",
                "InputCore",
                "Json",
                "JsonUtilities",
                "ProceduralMeshComponent"
            }
        );
    }
}
