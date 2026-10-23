[CmdletBinding()]
param(
    [string]$Makensis,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Join-Path $projectRoot 'src-tauri\Cargo.toml'
$versionMatch = [regex]::Match((Get-Content -LiteralPath $manifest -Raw), '(?m)^version = "(\d+\.\d+\.\d+)"')
if (-not $versionMatch.Success) { throw 'Cargo.toml sürümü okunamadı.' }
$version = $versionMatch.Groups[1].Value

if (-not $Makensis) {
    $compiler = Get-Command makensis.exe -ErrorAction SilentlyContinue
    if ($compiler) { $Makensis = $compiler.Source }
    else {
        $candidates = @(
            "${env:ProgramFiles(x86)}\NSIS\makensis.exe",
            "$env:ProgramFiles\NSIS\makensis.exe",
            "$env:LOCALAPPDATA\tauri\NSIS\makensis.exe"
        )
        $Makensis = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    }
}
if (-not $Makensis -or -not (Test-Path -LiteralPath $Makensis)) {
    throw 'NSIS 3 bulunamadı. NSIS kur veya -Makensis ile makensis.exe yolunu belirt.'
}
if (-not $SkipBuild) {
    & cargo build --release --locked --manifest-path $manifest
    if ($LASTEXITCODE -ne 0) { throw 'Windows uygulaması derlenemedi.' }
}
$application = Join-Path $projectRoot 'src-tauri\target\release\agenthud.exe'
if (-not (Test-Path -LiteralPath $application)) { throw 'Önce release derlemesini oluştur.' }
$destination = Join-Path $projectRoot 'release'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$portable = Join-Path $destination 'AgentHUD.exe'
$setup = Join-Path $destination 'AgentHUD-Setup.exe'
Copy-Item -LiteralPath $application -Destination $portable -Force
& $Makensis '/V3' '/INPUTCHARSET' 'UTF8' "/DVERSION=$version" "/DAPP_EXE=$portable" "/DAPP_ICON=$(Join-Path $projectRoot 'src-tauri\assets\icon.ico')" "/DSETUP_EXE=$setup" (Join-Path $projectRoot 'installer\agenthud.nsi')
if ($LASTEXITCODE -ne 0) { throw 'Kurulum EXE dosyası oluşturulamadı.' }
$checksums = foreach ($file in @($setup, $portable)) {
    '{0}  {1}' -f (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant(), (Split-Path -Leaf $file)
}
[IO.File]::WriteAllText((Join-Path $destination 'SHA256SUMS.txt'), ($checksums -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
Get-Item -LiteralPath $setup, $portable | Select-Object Name, Length
