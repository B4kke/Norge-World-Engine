param(
    [Parameter(Mandatory = $true)]
    [string]$UnrealEngineRoot,

    [switch]$SkipDataDownload,
    [switch]$SkipLevelCreation
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepositoryRoot = Resolve-Path (Join-Path $ProjectRoot "..\..")
$ProjectFile = Join-Path $ProjectRoot "Nannestad.uproject"
$Editor = Join-Path $UnrealEngineRoot "Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
$Build = Join-Path $UnrealEngineRoot "Engine\Build\BatchFiles\Build.bat"

if (-not (Test-Path $Editor)) {
    throw "UnrealEditor-Cmd.exe was not found below $UnrealEngineRoot"
}
if (-not (Test-Path $Build)) {
    throw "Build.bat was not found below $UnrealEngineRoot"
}

Push-Location $RepositoryRoot
try {
    if (-not $SkipDataDownload) {
        python "apps\unreal-runtime\Tools\nwe_unreal_pipeline.py" all
        if ($LASTEXITCODE -ne 0) { throw "Nannestad data verification/build failed" }
    }

    & $Build NannestadEditor Win64 Development $ProjectFile -WaitMutex -NoHotReload
    if ($LASTEXITCODE -ne 0) { throw "NannestadEditor failed to compile" }

    if (-not $SkipLevelCreation) {
        $LevelScript = Join-Path $ProjectRoot "Content\Python\create_nannestad_level.py"
        & $Editor $ProjectFile -Unattended -NoSplash -ExecutePythonScript=$LevelScript
        if ($LASTEXITCODE -ne 0) {
            throw "Level creation failed. Add Epic's Third Person feature pack and run again."
        }
    }
}
finally {
    Pop-Location
}

Write-Host "NWE_UNREAL_SETUP_PASS: Open $ProjectFile and press Play."
