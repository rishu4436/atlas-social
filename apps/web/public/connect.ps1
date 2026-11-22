# ATLAS Social one-command connect (Windows PowerShell).
# Usage:
#   iex "& { $(irm https://atlascalls.xyz/connect.ps1) } ATC-XXXX"
#   iex "& { $(irm https://atlascalls.xyz/connect.ps1) } pay ATC-XXXX"
#
# Installs Node.js via winget when it is missing (or tells you how). Then runs
# atlas-social-connect, which installs the official Binance Agentic Wallet CLI if
# needed and logs you in. A standard official login with no reported risks is signed automatically; pass --confirm to review first.

$ErrorActionPreference = "Stop"
$Site = if ($env:ATLAS_SITE) { $env:ATLAS_SITE.TrimEnd("/") } else { "https://atlascalls.xyz" }
$PkgName = "atlas-social-connect"
$Cmd = "login"
$Code = $null
$Api = $null

function Test-AtlasCode([string]$Value) {
  return [bool]($Value.ToUpper() -match '^ATC-[0-9A-HJKMNP-TV-Z]{26}$')
}

$argv = @($args)
for ($i = 0; $i -lt $argv.Count; $i++) {
  $a = [string]$argv[$i]
  if ($a -eq "login" -or $a -eq "pay") { $Cmd = $a }
  elseif ($a -eq "--api") {
    if ($i + 1 -ge $argv.Count) { throw "atlas-connect: --api needs a URL" }
    $Api = [string]$argv[$i + 1]
    $i++
  }
  elseif ($a -eq "--help" -or $a -eq "-h") {
    Write-Host "usage: iex `"& { `$(irm $Site/connect.ps1) } [login|pay] ATC-XXXX`""
    return
  }
  elseif (Test-AtlasCode $a) { $Code = $a.ToUpper() }
  else { throw "atlas-connect: unexpected argument: $a" }
}

if (-not $Code) { throw "atlas-connect: missing ATLAS connection code (ATC-…). Copy it from $Site." }

function Get-NodeMajor {
  try {
    $v = & node -p "process.versions.node" 2>$null
    if (-not $v) { return 0 }
    return [int]($v.ToString().Split(".")[0])
  } catch { return 0 }
}

function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
              [System.Environment]::GetEnvironmentVariable("Path", "User")
}

if ((Get-NodeMajor) -lt 18) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    Write-Host "Installing Node.js LTS with winget (OpenJS.NodeJS.LTS)…"
    & winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    Refresh-Path
  }
}

if ((Get-NodeMajor) -lt 18) {
  throw @"
atlas-connect: Node.js 18+ is required. Install it from https://nodejs.org then re-run:
  iex "& { `$(irm $Site/connect.ps1) } $Code"
Or with winget: winget install -e --id OpenJS.NodeJS.LTS
"@
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "atlas-connect: npm was not found on PATH after installing Node.js. Install Node.js 18+ from https://nodejs.org and re-run."
}

$pkg = $PkgName + "@latest"
try {
  & npm view $PkgName version 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { $pkg = "$Site/$PkgName.tgz" }
} catch { $pkg = "$Site/$PkgName.tgz" }

$npxArgs = @("--yes", $pkg, $Cmd, $Code)
if ($Api) { $npxArgs += @("--api", $Api) }
Write-Host "Running: npx $($npxArgs -join ' ')"
Write-Host "This will install the official Binance Agentic Wallet CLI (baw) if it is missing, then preview the ATLAS login. A standard official login with no reported risks is signed automatically; pass --confirm to review first. Payments always require y."
& npx @npxArgs
exit $LASTEXITCODE
