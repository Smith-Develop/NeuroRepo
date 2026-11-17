<#
    Instalador único de DocuPaz: analiza el equipo, recomienda dónde instalar y deja elegir entre
      [1] Windows, sin Docker  -> windows\instalar-windows.ps1
      [2] Docker               -> docker\instalar.ps1  (si Docker no está instalado y la carpeta
                                  pre-instalacion trae sus instaladores, antes pre-instalacion\preinstalar.ps1)
    Estructura del paquete (lo monta quien lo empaqueta; ver CLAUDE.md):
      Instalar-DocuPaz.bat, instalador.ps1, ui.ps1, LEEME.txt
      windows\          instalador sin Docker (app + componentes: Node, MongoDB, OCR)
      docker\           el proyecto para Docker (paquete offline: node_modules, OCR, docker-compose...)
      pre-instalacion\  WSL2 + Docker Desktop sin internet (sus instaladores, aparte)
      modelo\           (opcional) el modelo de IA .gguf o sus partes, para cualquiera de los dos
      ollama\           (opcional) ollama-windows-amd64.zip u OllamaSetup.exe, para la opción sin Docker
#>
param([string]$UsuarioOriginal)
$ErrorActionPreference = "Stop"

# --- Administrador (relanza elevado; recuerda el usuario normal) ---
$esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) {
    $usuario = "$env:USERDOMAIN\$env:USERNAME"
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -UsuarioOriginal `"$usuario`""
    exit
}
if (-not $UsuarioOriginal) { $UsuarioOriginal = "$env:USERDOMAIN\$env:USERNAME" }
Set-Location $PSScriptRoot

$ui = @((Join-Path $PSScriptRoot "ui.ps1"), (Join-Path $PSScriptRoot "..\ui.ps1")) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $ui) { Write-Host "Falta ui.ps1 junto al instalador." -ForegroundColor Red; Read-Host "Pulsa Enter para cerrar"; exit 1 }
. $ui
Ui-Banner "detección automática del entorno e instalación"

function Sin-Parar([scriptblock]$bloque) {
    $previo = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { & $bloque } finally { $ErrorActionPreference = $previo }
}
function Ruta($relativa) { Join-Path $PSScriptRoot $relativa }

# --- FASE 1: qué equipo es y qué hay instalado ---
Ui-Fase 1 2 "Análisis del equipo" "sistema, virtualización, Docker e instalaciones previas"

Ui-Paso "SISTEMA" "Windows, procesador y memoria"
$so = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$arq = if ($cpu.Architecture -eq 12) { "ARM64" } else { "x64" }
$ramGB = [Math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
$nucleos = ($cs.NumberOfLogicalProcessors)
Ui-Ok "$($so.Caption) ($($so.Version))" "Windows"
Ui-Ok "$($cpu.Name.Trim()) · $arq · $nucleos núcleos lógicos" "Procesador"
if ($ramGB -lt 7.5) { Ui-Aviso "$ramGB GB: justo para la IA del modo avanzado (recomendado 8 GB o más)" "Memoria" }
else { Ui-Ok "$ramGB GB" "Memoria" }

Ui-Paso "DOCKER" "¿instalado y en marcha?"
$dockerExe = @((Get-Command docker.exe -ErrorAction SilentlyContinue).Source, (Join-Path $env:ProgramFiles "Docker\Docker\resources\bin\docker.exe")) |
    Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
$dockerVivo = $false
if ($dockerExe) {
    Sin-Parar { & $dockerExe info 2>$null | Out-Null }
    $dockerVivo = ($LASTEXITCODE -eq 0)
    if ($dockerVivo) { Ui-Ok "instalado y en marcha" "Docker" } else { Ui-Aviso "instalado, pero no responde (¿Docker Desktop cerrado?)" "Docker" }
} else { Ui-Info "no instalado" "Docker" }

Ui-Paso "VIRTUALIZACIÓN" "Docker la necesita; la opción sin Docker, no"
$esVM = "$($cs.Manufacturer) $($cs.Model)" -match "Virtual|VMware|KVM|QEMU|Xen|HVM|VirtualBox|Parallels|Amazon EC2|Google Compute"
if ($esVM) { Ui-Info "máquina virtual ($($cs.Manufacturer.Trim()) $($cs.Model.Trim()))" "Equipo" } else { Ui-Info "equipo físico" "Equipo" }
# Con Hyper-V/WSL ya en marcha, Windows informa la del firmware como desactivada: si Docker funciona, la hay
$virtualizacion = $dockerVivo -or $cpu.VirtualizationFirmwareEnabled -or ($cs.HypervisorPresent -and -not $esVM)
if ($virtualizacion) { Ui-Ok "disponible" "Virtualización" }
elseif ($esVM) { Ui-Aviso "no disponible: la VM no tiene virtualización anidada, Docker no podrá arrancar" "Virtualización" }
else { Ui-Aviso "desactivada en la BIOS/UEFI: Docker no podrá arrancar hasta activarla" "Virtualización" }

Ui-Paso "INSTALACIONES" "versiones previas de DocuPaz (o NeuroRepo, su nombre anterior)"
$nativa = @("C:\DocuPaz", "C:\NeuroRepo") | Where-Object { Test-Path (Join-Path $_ "app\server\src\index.js") } | Select-Object -First 1
if (-not $nativa -and (Get-Service DocuPazMongo, NeuroRepoMongo -ErrorAction SilentlyContinue)) { $nativa = "(servicio de base de datos registrado)" }
if ($nativa) { Ui-Ok "sin Docker, en $nativa" "Encontrada" }
$enDocker = $false
if ($dockerVivo) {
    $contenedores = Sin-Parar { & $dockerExe ps -a -q --filter "label=com.docker.compose.project=neurorepo" 2>$null }
    $enDocker = [bool]$contenedores
    if ($enDocker) { Ui-Ok "en Docker (proyecto neurorepo)" "Encontrada" }
}
if (-not $nativa -and -not $enDocker) { Ui-Info "ninguna: instalación nueva" "Encontrada" }

# --- Recomendación ---
$tieneWindows = Test-Path (Ruta "windows\instalar-windows.ps1")
$tieneDocker = Test-Path (Ruta "docker\instalar.ps1")
if ($nativa -and -not $enDocker) { $recomendada = "1"; $motivo = "ya hay una instalación sin Docker: se actualiza conservando los datos" }
elseif ($enDocker -and -not $nativa) { $recomendada = "2"; $motivo = "ya hay una instalación en Docker: se actualiza conservando los datos" }
elseif (-not $virtualizacion) { $recomendada = "1"; $motivo = "sin virtualización Docker no puede funcionar en este equipo" }
elseif ($dockerVivo) { $recomendada = "2"; $motivo = "Docker ya está instalado y funcionando" }
else { $recomendada = "1"; $motivo = "no necesita instalar Docker ni reiniciar, y consume menos memoria" }
if (-not $tieneDocker) { $recomendada = "1" }
if (-not $tieneWindows) { $recomendada = "2" }

# --- FASE 2: elegir e instalar ---
Ui-Fase 2 2 "Instalación" "elige el entorno"
Ui-Escribir ""
function Opcion($numero, $titulo, $detalle, $disponible) {
    $marca = if ($numero -eq $recomendada) { "  ★ recomendada" } else { "" }
    Ui-Escribir "    [$numero] " $(if ($disponible) { "Cyan" } else { "DarkGray" }) -Seguido
    Ui-Escribir ("{0,-26}" -f $titulo) $(if ($disponible) { "White" } else { "DarkGray" }) -Seguido
    Ui-Escribir $marca Yellow
    Ui-Escribir ("        " + $detalle) DarkGray
}
Opcion "1" "Windows, sin Docker" "Node.js + MongoDB como servicio + IA y OCR. Funciona en cualquier VM. Sin reinicios." $tieneWindows
Opcion "2" "Docker" "Contenedores aislados. Necesita virtualización y Docker Desktop (o lo instala)." ($tieneDocker -and $virtualizacion)
Ui-Escribir ""
Ui-Info $motivo "Recomendación"

do {
    $eleccion = Read-Host "Elige 1 o 2 [$recomendada]"
    if ([string]::IsNullOrWhiteSpace($eleccion)) { $eleccion = $recomendada }
    $eleccion = $eleccion.Trim()
} while ($eleccion -ne "1" -and $eleccion -ne "2")

if ($eleccion -eq "1") {
    if (-not $tieneWindows) { Ui-Fallo "Este paquete no incluye la carpeta windows\"; Ui-Final "instalación detenida" -Fallo; Read-Host "Pulsa Enter para cerrar"; exit 1 }
    if ($enDocker) { Ui-Aviso "Hay una instalación en Docker usando el puerto 4000: párala en Docker Desktop antes de seguir." }
    Ui-Ok "Windows, sin Docker" "Elegido"
    & (Ruta "windows\instalar-windows.ps1") -UsuarioOriginal $UsuarioOriginal
    exit $LASTEXITCODE
}

if (-not $tieneDocker) { Ui-Fallo "Este paquete no incluye la carpeta docker\"; Ui-Final "instalación detenida" -Fallo; Read-Host "Pulsa Enter para cerrar"; exit 1 }
if (-not $virtualizacion) {
    Ui-Aviso "Sin virtualización, Docker Desktop no arrancará en este equipo."
    if ((Read-Host "¿Seguir con Docker igualmente? (s/N)") -notmatch '^[sS]') { Ui-Final "instalación detenida" -Fallo; Read-Host "Pulsa Enter para cerrar"; exit 1 }
}
if ($nativa) { Ui-Aviso "Hay una instalación sin Docker usando el puerto 4000: la de Docker no podrá arrancar a la vez." }
Ui-Ok "Docker" "Elegido"

# Sin Docker instalado: primero la pre-instalación sin internet, si trae sus instaladores
$instaladoresDocker = Get-ChildItem (Ruta "pre-instalacion\instaladores\docker\docker-desktop-*") -ErrorAction SilentlyContinue
if (-not $dockerExe -and $instaladoresDocker -and (Test-Path (Ruta "pre-instalacion\preinstalar.ps1"))) {
    Ui-Info "Docker no está instalado: primero se instalan WSL2 y Docker Desktop (sin internet)."
    Ui-Texto "Después de reiniciar, vuelve a ejecutar Instalar-DocuPaz.bat y elige otra vez Docker."
    & (Ruta "pre-instalacion\preinstalar.ps1") -UsuarioOriginal $UsuarioOriginal
    exit $LASTEXITCODE
}
& (Ruta "docker\instalar.ps1")
exit $LASTEXITCODE
