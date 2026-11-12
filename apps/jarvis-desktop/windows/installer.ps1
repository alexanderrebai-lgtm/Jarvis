# Installation de Jarvis sur Windows.
# Clic droit sur ce fichier > « Exécuter avec PowerShell ». Compter 5 à 15 minutes.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$app = Resolve-Path (Join-Path $here "..")
$repo = Resolve-Path (Join-Path $app "..\..")

function Etape($texte) { Write-Host "`n==> $texte" -ForegroundColor Cyan }
function Commande($nom) { return [bool](Get-Command $nom -ErrorAction SilentlyContinue) }
function Rafraichir-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

Etape "Node.js (moteur de Jarvis)"
if (-not (Commande node)) {
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  Rafraichir-Path
}
node --version

Etape "pnpm (gestionnaire de paquets)"
if (-not (Commande pnpm)) {
  npm install -g pnpm@10.28.0
  Rafraichir-Path
}

Etape "Python (calculs, simulations et modélisation 3D)"
if (-not (Commande python)) {
  winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements
  Rafraichir-Path
}

Etape "Installation des composants de Jarvis"
Push-Location $repo
pnpm install
Pop-Location
Push-Location $app
node build.mjs
Pop-Location

Etape "Navigateur pour les réservations"
Push-Location $app
pnpm exec playwright install chromium
Pop-Location

Etape "Connexion à ton compte Claude"
if (-not (Commande claude)) {
  npm install -g @anthropic-ai/claude-code
  Rafraichir-Path
}
Write-Host "Une fenêtre Claude va s'ouvrir : connecte-toi avec ton compte (abonnement Pro ou Max), puis tape /exit." -ForegroundColor Yellow
Start-Process -FilePath "cmd.exe" -ArgumentList "/c claude" -Wait

Etape "Raccourcis (bureau et menu Démarrer)"
$electron = Join-Path $app "node_modules\electron\dist\electron.exe"
$icon = Join-Path $app "assets\icon.ico"
$shell = New-Object -ComObject WScript.Shell
foreach ($dossier in @([Environment]::GetFolderPath("Desktop"), (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"))) {
  $lien = $shell.CreateShortcut((Join-Path $dossier "Jarvis.lnk"))
  $lien.TargetPath = $electron
  $lien.Arguments = "`"$app`""
  $lien.WorkingDirectory = "$app"
  $lien.IconLocation = $icon
  $lien.Description = "J.A.R.V.I.S."
  $lien.Save()
}

Etape "Terminé"
Write-Host "Jarvis va démarrer. Au premier lancement :" -ForegroundColor Green
Write-Host " - autorise le micro et les caméras si Windows le demande ;"
Write-Host " - le modèle de reconnaissance vocale se télécharge (environ 250 Mo) ;"
Write-Host " - pour qu'il démarre avec Windows : clic droit sur son icône près de l'horloge > Lancer au démarrage."
Write-Host " - tes réglages (Tapo, Google…) : clic droit sur l'icône > Réglages."
Start-Process -FilePath $electron -ArgumentList "`"$app`""
