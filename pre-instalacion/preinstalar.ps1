<#
    Pre-instalación de DocuPaz SIN internet: deja el equipo listo con WSL2 y Docker Desktop para
    después lanzar el instalador de la app (Instalar.bat).

    Se ejecuta con Preinstalar.bat desde la carpeta Pre-instalacion, que debe contener:
      instaladores\docker\docker-desktop-<arq>.exe        (o sus partes .parte1, .parte2...)
      instaladores\wsl\wsl.<versión>.<arq>.msi
      SHA256SUMS.txt                                       (para comprobar que nada llegó dañado)
    donde <arq> es x64 (Intel/AMD) o arm64 (Snapdragon y otros ARM).
#>
param([string]$UsuarioOriginal)
$ErrorActionPreference = "Stop"

# En PowerShell 5.1, con "Stop", redirigir la salida de error de un programa (2>) lanza una excepción
# aunque el programa vaya bien: los ejecutables externos se llaman con "Continue".
function Sin-Parar([scriptblock]$bloque) {
    $previo = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { & $bloque } finally { $ErrorActionPreference = $previo }
}
function Write-Paso($texto) { Write-Host ""; Write-Host "==> $texto" -ForegroundColor Cyan }
function Salir($codigo) { Write-Host ""; Read-Host "Pulsa Enter para cerrar"; exit $codigo }

# --- Administrador (relanza elevado; recuerda el usuario normal para darle permiso de usar Docker) ---
$esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) {
    $usuario = "$env:USERDOMAIN\$env:USERNAME"
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -UsuarioOriginal `"$usuario`""
    exit
}
if (-not $UsuarioOriginal) { $UsuarioOriginal = "$env:USERDOMAIN\$env:USERNAME" }
Set-Location $PSScriptRoot
Write-Host "Pre-instalación de DocuPaz: WSL2 + Docker Desktop (sin internet)" -ForegroundColor Green

# --- 1. Arquitectura ---
$cpuInfo = Get-CimInstance Win32_Processor | Select-Object -First 1
$detectada = if ($cpuInfo.Architecture -eq 12) { "arm64" } else { "x64" }  # 12 = ARM64, 9 = x64
do {
    $arq = Read-Host "¿El equipo es x64 (Intel/AMD) o arm64 (ARM, p. ej. Snapdragon)? Escribe x64 o arm64 [detectado: $detectada]"
    if ([string]::IsNullOrWhiteSpace($arq)) { $arq = $detectada }
    $arq = $arq.Trim().ToLower()
} while ($arq -ne "x64" -and $arq -ne "arm64")
if ($arq -ne $detectada) {
    Write-Host "AVISO: has elegido $arq pero el equipo parece $detectada. Si no coincide, los instaladores fallarán." -ForegroundColor Yellow
    if ((Read-Host "¿Seguir con $arq? (s/N)") -notmatch '^[sS]') { Salir 1 }
}

# --- 2. Instaladores: unir las partes (si vinieron troceados) y comprobar que están íntegros ---
$sumas = @{}
if (Test-Path "SHA256SUMS.txt") {
    foreach ($linea in Get-Content "SHA256SUMS.txt") {
        if ($linea -match '^([0-9a-fA-F]{64})\s+\*?(.+)$') { $sumas[$Matches[2].Trim().Replace('/', '\')] = $Matches[1].ToLower() }
    }
}

function Unir-Partes($destino) {
    if (Test-Path $destino) { return }
    $partes = @(Get-ChildItem -Path "$destino.parte*" -ErrorAction SilentlyContinue |
        Sort-Object { [int]($_.Name -replace '^.*\.parte', '') })
    if ($partes.Count -eq 0) { return }
    Write-Host "Uniendo $($partes.Count) partes de $(Split-Path $destino -Leaf)..."
    $salida = [IO.File]::Create((Join-Path $PSScriptRoot $destino))
    try {
        foreach ($p in $partes) {
            $entrada = [IO.File]::OpenRead($p.FullName)
            try { $entrada.CopyTo($salida) } finally { $entrada.Close() }
        }
    } finally { $salida.Close() }
}

function Comprobar($ruta) {
    $esperada = $sumas[$ruta]
    if (-not $esperada) { Write-Host "(sin suma de control para $ruta; no se comprueba)"; return }
    Write-Host "Comprobando $(Split-Path $ruta -Leaf)..."
    $real = (Get-FileHash -Algorithm SHA256 -Path $ruta).Hash.ToLower()
    if ($real -ne $esperada) {
        Write-Host "ERROR: $ruta está dañado o incompleto (la suma SHA-256 no coincide). Vuelve a copiarlo." -ForegroundColor Red
        Remove-Item $ruta -ErrorAction SilentlyContinue  # si venía de partes, se volverá a unir
        Salir 1
    }
}

Write-Paso "Preparando los instaladores para $arq"
$docker = "instaladores\docker\docker-desktop-$arq.exe"
Unir-Partes $docker
if (-not (Test-Path $docker)) {
    Write-Host "ERROR: falta $docker (o sus partes .parte1, .parte2...). Revisa LEEME.txt." -ForegroundColor Red
    Salir 1
}
Comprobar $docker

# WSL moderno (el que necesita Docker) responde a "wsl --version"; el antiguo de Windows, no
$wslVersion = Sin-Parar { & wsl.exe --version 2>$null }
$wslInstalado = ($LASTEXITCODE -eq 0) -and $wslVersion
$wsl = Get-ChildItem -Path "instaladores\wsl\wsl.*.$arq.msi" -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1
if ($wslInstalado) {
    Write-Host "WSL ya está instalado, se omite." -ForegroundColor Green
    $wsl = $null
} elseif ($wsl) {
    $wslRel = "instaladores\wsl\$($wsl.Name)"
    Comprobar $wslRel
} else {
    Write-Host "AVISO: WSL no está instalado y no hay instalador para $arq en instaladores\wsl (wsl.<versión>.$arq.msi)." -ForegroundColor Yellow
    Write-Host "Docker Desktop necesita una versión reciente de WSL; sin ella intentará actualizarla por internet."
    if ((Read-Host "¿Seguir sin instalar WSL? (s/N)") -notmatch '^[sS]') { Salir 1 }
}

# --- 3. Virtualización ---
$hipervisor = (Get-CimInstance Win32_ComputerSystem).HypervisorPresent
if (-not $cpuInfo.VirtualizationFirmwareEnabled -and -not $hipervisor) {
    Write-Host "AVISO: la virtualización parece DESACTIVADA en la BIOS/UEFI. Docker no funcionará hasta activarla" -ForegroundColor Yellow
    Write-Host "(opción «Intel VT-x», «AMD-V» o «SVM» en la BIOS; en equipos de empresa, pídeselo a IT)."
    if ((Read-Host "¿Seguir igualmente? (s/N)") -notmatch '^[sS]') { Salir 1 }
}

$reiniciar = $false

# --- 4. Características de Windows para WSL2 ---
Write-Paso "Activando el Subsistema de Windows para Linux y la Plataforma de máquina virtual"
foreach ($caracteristica in "Microsoft-Windows-Subsystem-Linux", "VirtualMachinePlatform") {
    $estado = (Get-WindowsOptionalFeature -Online -FeatureName $caracteristica).State
    if ($estado -eq "Enabled") { Write-Host "$caracteristica ya estaba activada."; continue }
    $r = Enable-WindowsOptionalFeature -Online -FeatureName $caracteristica -All -NoRestart
    Write-Host "$caracteristica activada."
    if ($r.RestartNeeded) { $reiniciar = $true }
}

# --- 5. WSL ---
if ($wsl) {
    Write-Paso "Instalando WSL ($($wsl.Name))"
    $p = Start-Process msiexec.exe -ArgumentList "/i `"$($wsl.FullName)`" /quiet /norestart" -Wait -PassThru
    switch ($p.ExitCode) {
        0 { Write-Host "WSL instalado." }
        3010 { Write-Host "WSL instalado (necesita reiniciar)."; $reiniciar = $true }
        1638 { Write-Host "Ya había una versión de WSL igual o más nueva." }
        default { Write-Host "ERROR: el instalador de WSL terminó con el código $($p.ExitCode)." -ForegroundColor Red; Salir 1 }
    }
    Sin-Parar { & wsl.exe --set-default-version 2 2>$null | Out-Null }  # puede fallar hasta reiniciar; Docker usa WSL2 igualmente
}

# --- 6. Docker Desktop ---
$dockerExe = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
$instalarDocker = $true
if (Test-Path $dockerExe) {
    $instalarDocker = (Read-Host "Docker Desktop ya está instalado. ¿Reinstalarlo/actualizarlo? (s/N)") -match '^[sS]'
}
if ($instalarDocker) {
    Write-Paso "Instalando Docker Desktop (tarda unos minutos, sin ventanas)"
    $p = Start-Process (Join-Path $PSScriptRoot $docker) -ArgumentList "install", "--quiet", "--accept-license", "--backend=wsl-2" -Wait -PassThru
    if ($p.ExitCode -eq 3010) { $reiniciar = $true }
    elseif ($p.ExitCode -ne 0) { Write-Host "ERROR: el instalador de Docker terminó con el código $($p.ExitCode)." -ForegroundColor Red; Salir 1 }
    Write-Host "Docker Desktop instalado."
}

# Docker solo deja usarlo a los miembros del grupo docker-users (si se instaló con otra cuenta de
# administrador, el usuario normal no estaría dentro)
Write-Paso "Dando permiso a $UsuarioOriginal para usar Docker"
$salidaNet = Sin-Parar { & net.exe localgroup docker-users "$UsuarioOriginal" /add 2>&1 }
if ($LASTEXITCODE -eq 0) { Write-Host "Añadido al grupo docker-users."; $reiniciar = $true }
elseif ("$salidaNet" -match "1378") { Write-Host "Ya pertenecía al grupo docker-users." }
else { Write-Host "AVISO: no se pudo añadir al grupo docker-users: $salidaNet" -ForegroundColor Yellow }

# --- 7. Final ---
Write-Host ""
Write-Host "Pre-instalación terminada." -ForegroundColor Green
Write-Host "Siguiente paso: tras reiniciar, abre Docker Desktop (la primera vez puede pedir aceptar o"
Write-Host "saltar el inicio de sesión: elige saltar) y cuando ponga «Engine running», ejecuta el"
Write-Host "Instalar.bat de DocuPaz."
if ($reiniciar) {
    Write-Host ""
    Write-Host "Hace falta REINICIAR el equipo para terminar de activar WSL2 y Docker." -ForegroundColor Yellow
    if ((Read-Host "¿Reiniciar ahora? (S/n)") -notmatch '^[nN]') { Restart-Computer -Force; exit 0 }
}
Salir 0
