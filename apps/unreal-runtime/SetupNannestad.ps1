param(
    [Parameter(Mandatory = $true)]
    [string]$UnrealEngineRoot,

    [string]$GroundImageryPath = "",
    [string]$GroundImagerySourceName = "Local Nannestad imagery",
    [string]$GroundImageryRightsBasis = "User-supplied lawful local/private use",
    [ValidateSet("private-only", "allowed-by-license")]
    [string]$GroundImageryRedistribution = "private-only",
    [double]$GroundImagerySourceValueMax = 0,

    [switch]$SkipDataDownload,
    [switch]$SkipVisualAssetDownload,
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
    if (-not $SkipVisualAssetDownload) {
        python "apps\unreal-runtime\Tools\acquire_visual_assets.py"
        if ($LASTEXITCODE -ne 0) { throw "Nannestad CC0 vegetation asset acquisition failed" }
    }

    if ($GroundImageryPath) {
        if (-not (Test-Path $GroundImageryPath)) {
            throw "Ground imagery source was not found: $GroundImageryPath"
        }
        $ImageryArgs = @(
            "apps\unreal-runtime\Tools\prepare_ground_imagery.py",
            "--source", $GroundImageryPath,
            "--source-name", $GroundImagerySourceName,
            "--rights-basis", $GroundImageryRightsBasis,
            "--redistribution", $GroundImageryRedistribution
        )
        if ($GroundImagerySourceValueMax -gt 0) {
            $ImageryArgs += @("--source-value-max", $GroundImagerySourceValueMax.ToString([System.Globalization.CultureInfo]::InvariantCulture))
        }
        & python $ImageryArgs
        if ($LASTEXITCODE -ne 0) { throw "Nannestad ground imagery bake failed" }
    }

    if (-not $SkipDataDownload) {
        python "apps\unreal-runtime\Tools\nwe_unreal_pipeline.py" all
        if ($LASTEXITCODE -ne 0) { throw "Nannestad data/vegetation verification and build failed" }
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
if (-not $GroundImageryPath) {
    Write-Warning "No private ground imagery was supplied. Generic terrain PBR remains active. Re-run with -GroundImageryPath <georeferenced RGB GeoTIFF> for Nannestad ground color."
}
