using UnrealBuildTool;
using System.Collections.Generic;

public class NannestadTarget : TargetRules
{
    public NannestadTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.Latest;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("Nannestad");
    }
}
