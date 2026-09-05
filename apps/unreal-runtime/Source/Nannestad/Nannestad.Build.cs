using UnrealBuildTool;

public class Nannestad : ModuleRules
{
    public Nannestad(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(
            new string[]
            {
                "Core",
                "CoreUObject",
                "Engine",
                "InputCore",
                "Json",
                "JsonUtilities",
                "ProceduralMeshComponent"
            }
        );
    }
}
