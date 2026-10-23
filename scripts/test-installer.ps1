[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Makensis)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$testRoot = Join-Path $projectRoot ('.cache\installer-test-' + [guid]::NewGuid().ToString('N'))
$installDirectory = Join-Path $testRoot 'Installed'
$desktop = Join-Path $testRoot 'Desktop'
$startMenu = Join-Path $testRoot 'StartMenu'
$registryKey = 'Software\AgentHUDInstallerTest-' + [guid]::NewGuid().ToString('N')
New-Item -ItemType Directory -Path $testRoot, $desktop, $startMenu -Force | Out-Null
$source = Get-Content -LiteralPath (Join-Path $projectRoot 'installer\agenthud.nsi') -Raw
$source = $source.Replace('$DESKTOP', $desktop).Replace('$SMPROGRAMS', $startMenu).Replace('Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentHUD', $registryKey)
$testScript = Join-Path $testRoot 'test.nsi'
[IO.File]::WriteAllText($testScript, $source, [Text.UTF8Encoding]::new($false))
$setup = Join-Path $testRoot 'AgentHUD-Test-Installer.exe'
$portable = Join-Path $projectRoot 'release\AgentHUD.exe'
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'src-tauri\Cargo.toml') -Raw
$version = [regex]::Match($manifest, '(?m)^version = "(\d+\.\d+\.\d+)"').Groups[1].Value
& $Makensis '/V2' '/INPUTCHARSET' 'UTF8' "/DVERSION=$version" "/DAPP_EXE=$portable" "/DAPP_ICON=$(Join-Path $projectRoot 'src-tauri\assets\icon.ico')" "/DSETUP_EXE=$setup" $testScript
if ($LASTEXITCODE -ne 0) { throw 'Yalıtılmış kurulum derlenemedi.' }
$process = Start-Process -FilePath $setup -ArgumentList '/S', "/D=$installDirectory" -WindowStyle Hidden -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "Kurulum başarısız: $($process.ExitCode)" }
$installedExe = Join-Path $installDirectory 'AgentHUD.exe'
if ((Get-FileHash -LiteralPath $installedExe).Hash -ne (Get-FileHash -LiteralPath $portable).Hash) { throw 'Kurulan EXE eşleşmiyor.' }
$shell = New-Object -ComObject WScript.Shell
foreach ($shortcut in @((Join-Path $desktop 'AgentHUD.lnk'), (Join-Path $startMenu 'AgentHUD.lnk'))) {
    if (-not (Test-Path -LiteralPath $shortcut)) { throw "Kısayol eksik: $shortcut" }
    $link = $shell.CreateShortcut($shortcut)
    if ($link.TargetPath -ne $installedExe -or $link.WorkingDirectory -ne $installDirectory) { throw 'Kısayol hedefi veya çalışma klasörü yanlış.' }
}
$registration = Get-ItemProperty -LiteralPath "HKCU:\$registryKey"
if ($registration.DisplayVersion -ne $version -or $registration.InstallLocation -ne $installDirectory) { throw 'Kaldırma kaydı yanlış.' }
$expectedUninstaller = '"' + (Join-Path $installDirectory 'Uninstall.exe') + '"'
if ($registration.UninstallString -ne $expectedUninstaller) { throw 'Kaldırma komutu doğru tırnaklanmamış.' }
$running = Start-Process -FilePath $installedExe -WorkingDirectory $installDirectory -WindowStyle Hidden -PassThru
try {
    if (-not $running.WaitForInputIdle(5000)) { throw 'Uygulama penceresi hazır olmadı.' }
    $blockedInstall = Start-Process -FilePath $setup -ArgumentList '/S', "/D=$installDirectory" -WindowStyle Hidden -PassThru -Wait
    if ($blockedInstall.ExitCode -eq 0) { throw 'Açık uygulamanın üzerine kurulum engellenmedi.' }
    $blockedUninstall = Start-Process -FilePath (Join-Path $installDirectory 'Uninstall.exe') -ArgumentList '/S', "_?=$installDirectory" -WindowStyle Hidden -PassThru -Wait
    if ($blockedUninstall.ExitCode -eq 0 -or -not (Test-Path -LiteralPath $installedExe)) { throw 'Açık uygulamayı kaldırma engellenmedi.' }
    $running.Refresh()
    [pscustomobject]@{workingSetMB=[math]::Round($running.WorkingSet64/1000000,1);privateMB=[math]::Round($running.PrivateMemorySize64/1000000,1)} | ConvertTo-Json -Compress
} finally {
    if (-not $running.HasExited) { Stop-Process -Id $running.Id }
}
$uninstall = Start-Process -FilePath (Join-Path $installDirectory 'Uninstall.exe') -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
if ($uninstall.ExitCode -ne 0) { throw 'Kaldırma başarısız.' }
$deadline = [DateTime]::UtcNow.AddSeconds(10)
while (((Test-Path -LiteralPath $installedExe) -or (Test-Path -LiteralPath "HKCU:\$registryKey")) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
foreach ($ownedPath in @($installedExe, (Join-Path $desktop 'AgentHUD.lnk'), (Join-Path $startMenu 'AgentHUD.lnk'))) {
    if (Test-Path -LiteralPath $ownedPath) { throw "Kaldırma sonrası dosya kaldı: $ownedPath" }
}
if (Test-Path -LiteralPath "HKCU:\$registryKey") { throw 'Kaldırma kaydı temizlenmedi.' }
Write-Output 'PASS: payload hash, desktop and Start menu shortcuts, quoted uninstaller, registry metadata, running-app protection, uninstall cleanup.'
