# Mise à jour de Jarvis après avoir récupéré la nouvelle version du code (git pull ou nouveau zip).
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$app = Resolve-Path (Join-Path $here "..")
$repo = Resolve-Path (Join-Path $app "..\..")
Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$app*" } | Stop-Process
Push-Location $repo; pnpm install; Pop-Location
Push-Location $app; node build.mjs; Pop-Location
Start-Process -FilePath (Join-Path $app "node_modules\electron\dist\electron.exe") -ArgumentList "`"$app`""
Write-Host "Jarvis est à jour et relancé." -ForegroundColor Green
