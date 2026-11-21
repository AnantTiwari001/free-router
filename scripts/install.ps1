param(
  [string]$Source = "https://github.com/AnantTiwari001/free-router/archive/refs/heads/main.tar.gz",
  [string]$Prefix = $env:FR_PREFIX,
  [switch]$NoSetup
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js is required (v22.18 or newer): https://nodejs.org/"
  exit 1
}

$nodeOk = (& node -p "const [a,b]=process.versions.node.split('.').map(Number); a > 22 || (a === 22 && b >= 18)").Trim()
if ($nodeOk -ne "true") {
  Write-Error "Node.js v22.18 or newer is required; found $(& node --version)."
  exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error "npm is required."
  exit 1
}

if (-not ($Source -match '^https?://')) {
  if (-not (Test-Path $Source)) {
    Write-Error "Install source not found: $Source"
    exit 1
  }
}

if ($Prefix) {
  & npm install -g --prefix $Prefix $Source
  $fr = Join-Path $Prefix "fr.cmd"
} else {
  & npm install -g $Source
  $globalPrefix = (& npm prefix -g).Trim()
  $fr = Join-Path $globalPrefix "fr.cmd"
}

if (-not (Test-Path $fr)) {
  $found = Get-Command fr -ErrorAction SilentlyContinue
  if ($found) { $fr = $found.Source }
}

if (-not $fr -or -not (Test-Path $fr)) {
  Write-Error "Installed, but could not find fr.cmd. Add npm's global prefix to PATH."
  exit 1
}

Write-Host "Installed: $fr"
if (-not $NoSetup) {
  & $fr setup --install-missing --auth
}

Write-Host ""
Write-Host "If 'fr' is not found in a new shell, add this to PATH:"
Write-Host "  $(Split-Path $fr -Parent)"
