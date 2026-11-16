$ErrorActionPreference = "Stop"

$Version = if ($env:SYNLEXA_VERSION) { $env:SYNLEXA_VERSION } else { "0.4.4" }
$InstallDir = if ($env:SYNLEXA_INSTALL_DIR) { $env:SYNLEXA_INSTALL_DIR } else { Join-Path $HOME ".synlexa-studio\runtime" }
$PrimaryReleasesBase = if ($env:SYNLEXA_RELEASES_BASE) { $env:SYNLEXA_RELEASES_BASE } else { "https://github.com/Synlexa/synlexa-studio/releases/download/v$Version" }
$MirrorReleasesBase = "https://studio.synlexa.com/releases"
$Arch = if ($env:PROCESSOR_ARCHITECTURE -match "ARM64" -or [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq "Arm64") { "arm64" } else { "x64" }
$ArchiveName = "Synlexa-Studio-v$Version-windows-$Arch.zip"
$PrimaryUrl = "$PrimaryReleasesBase/$ArchiveName"
$MirrorUrl = "$MirrorReleasesBase/$ArchiveName"

Write-Host "Installing Synlexa Studio v$Version (windows-$Arch)..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$TmpZip = Join-Path ([System.IO.Path]::GetTempPath()) $ArchiveName

try {
  try {
    Invoke-WebRequest -Uri $PrimaryUrl -OutFile $TmpZip -UseBasicParsing
  } catch {
    Invoke-WebRequest -Uri $MirrorUrl -OutFile $TmpZip -UseBasicParsing
  }
  Unblock-File -Path $TmpZip -ErrorAction SilentlyContinue
  Expand-Archive -Path $TmpZip -DestinationPath $InstallDir -Force
  Remove-Item $TmpZip -Force -ErrorAction SilentlyContinue

  $BinDir = Join-Path $InstallDir "bin"
  Get-ChildItem -Path $BinDir -Filter "*.exe" -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue

  $CurrentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($CurrentUserPath -notlike "*$BinDir*") {
    $NewPath = if ([string]::IsNullOrWhiteSpace($CurrentUserPath)) { $BinDir } else { "$CurrentUserPath;$BinDir" }
    [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
    $env:Path = "$env:Path;$BinDir"
  }

  $ExePath = Join-Path $BinDir "synlexa-studio.exe"
  $IconPath = Join-Path $InstallDir "icon.ico"
  $WebDist = Join-Path $InstallDir "web-dist"
  try {
    $WshShell = New-Object -ComObject WScript.Shell
    $ShortcutTargets = @()
    $DesktopDir = [Environment]::GetFolderPath("Desktop")
    $ProgramsDir = [Environment]::GetFolderPath("Programs")
    if ($DesktopDir -and (Test-Path $DesktopDir)) { $ShortcutTargets += (Join-Path $DesktopDir "Synlexa Studio.lnk") }
    if ($ProgramsDir) {
      New-Item -ItemType Directory -Force -Path $ProgramsDir | Out-Null
      $ShortcutTargets += (Join-Path $ProgramsDir "Synlexa Studio.lnk")
    }
    foreach ($LnkPath in $ShortcutTargets) {
      $Sc = $WshShell.CreateShortcut($LnkPath)
      $Sc.TargetPath = $ExePath
      $Sc.Arguments = "--dist `"$WebDist`""
      $Sc.WorkingDirectory = $HOME
      $Sc.Description = "Synlexa Studio — Deterministic Structural Biology & Cheminformatics Workbench (RUO)"
      $Sc.WindowStyle = 7
      if (Test-Path $IconPath) { $Sc.IconLocation = "$IconPath,0" }
      $Sc.Save()
      Write-Host "Created shortcut: $LnkPath"
    }
  } catch {
    Write-Warning "Could not create Windows shortcuts automatically: $_"
  }

  Write-Host "Installed Synlexa Studio into $InstallDir"
  Write-Host "Open 'Synlexa Studio' from your Desktop / Start Menu, or run 'synlexa-studio' in terminal."
} catch {
  if (Get-Command npm -ErrorAction SilentlyContinue) {
    Write-Host "Release archives unreachable; falling back to npm package..."
    try {
      npm install -g "$PrimaryReleasesBase/synlexa-studio-$Version.tgz"
    } catch {
      try {
        npm install -g "$MirrorReleasesBase/synlexa-studio-$Version.tgz"
      } catch {
        npm install -g "@synlexa/studio"
      }
    }
  } else {
    throw "Could not download $PrimaryUrl or $MirrorUrl and npm was not found. Visit https://www.synlexa.com/download"
  }
}
