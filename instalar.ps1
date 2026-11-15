<#
  Instalador de NeuroRepo para Windows.

  Qué hace:
    0. Si este script se ejecuta solo (por ejemplo, descargando únicamente Instalar.bat +
       instalar.ps1, sin el resto del proyecto), descarga el proyecto completo desde GitHub
       (con "git clone" si hay git, o un .zip si no) antes de continuar.
    1. Comprueba si Docker Desktop está instalado y arrancado; si no, lo descarga e instala en
       silencio, programa que este mismo script se vuelva a lanzar solo al reiniciar e iniciar
       sesión de nuevo, y reinicia el equipo.
    2. Al volver a ejecutarse (ya con Docker listo) pide la configuración: nombre y DNI del
       administrador, su contraseña, la carpeta con los documentos, y el resto de variables.
    3. Abre el puerto 4000 en el Firewall de Windows para que se pueda compartir en la red local.
    4. Levanta el stack completo con "docker compose" y muestra la URL para compartir.

  Pensado para pasárselo a alguien sin conocimientos técnicos: solo tiene que ejecutarlo (o hacer
  doble clic en Instalar.bat) y responder lo que se le pregunta. Ni siquiera hace falta que tenga
  ya la carpeta del proyecto: con Instalar.bat + instalar.ps1 descargados en cualquier sitio basta.
#>

$RepoUrl = "https://github.com/Smith-Develop/NeuroRepo.git"
$RepoZipUrl = "https://github.com/Smith-Develop/NeuroRepo/archive/refs/heads/main.zip"
$ResumeTaskName = "NeuroRepoInstalador"

function Write-Paso($texto) {
    Write-Host ""
    Write-Host "==> $texto" -ForegroundColor Cyan
}

function Test-Administrador {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Este instalador necesita permisos de administrador (instalar Docker, abrir el Firewall).
if (-not (Test-Administrador)) {
    Write-Host "Este instalador necesita permisos de administrador. Se va a volver a abrir pidiendo permiso..."
    Start-Process powershell -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"") -Verb RunAs
    exit
}

function Test-CarpetaProyecto($ruta) {
    return Test-Path (Join-Path $ruta "docker-compose.yml")
}

function Descargar-Proyecto {
    # Si el script ya vive dentro del proyecto (lo clonaste entero, o es la copia que ya
    # descargamos antes), no hay nada que descargar.
    if (Test-CarpetaProyecto $PSScriptRoot) {
        return $PSScriptRoot
    }

    Write-Paso "Este instalador se ha ejecutado suelto: hace falta descargar NeuroRepo primero."
    $porDefecto = Join-Path $env:USERPROFILE "NeuroRepo"
    $destino = Read-Host "¿En qué carpeta lo instalamos? [$porDefecto]"
    if ([string]::IsNullOrWhiteSpace($destino)) { $destino = $porDefecto }

    if (Test-CarpetaProyecto $destino) {
        Write-Host "Ya hay una copia de NeuroRepo en '$destino'; se reutiliza." -ForegroundColor Green
        return $destino
    }
    if (Test-Path $destino) {
        Write-Host ""
        Write-Host "La carpeta '$destino' ya existe y no parece una instalación de NeuroRepo." -ForegroundColor Red
        Write-Host "Elige otra carpeta (o vacía/borra esa) y vuelve a ejecutar el instalador." -ForegroundColor Red
        Read-Host "Pulsa Enter para salir"
        exit 1
    }

    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git) {
        Write-Paso "Descargando NeuroRepo desde GitHub con git..."
        git clone --depth 1 $RepoUrl $destino
        if ($LASTEXITCODE -ne 0 -or -not (Test-CarpetaProyecto $destino)) {
            Write-Host "No se pudo clonar el repositorio." -ForegroundColor Red
            Read-Host "Pulsa Enter para salir"
            exit 1
        }
    } else {
        Write-Paso "Descargando NeuroRepo desde GitHub (.zip; no hace falta tener git instalado)..."
        $zip = Join-Path $env:TEMP "NeuroRepo-descarga.zip"
        $extraido = Join-Path $env:TEMP "NeuroRepo-extraido"
        try {
            Invoke-WebRequest -Uri $RepoZipUrl -OutFile $zip -UseBasicParsing
            if (Test-Path $extraido) { Remove-Item $extraido -Recurse -Force }
            Expand-Archive -Path $zip -DestinationPath $extraido -Force
            $carpetaExtraida = Get-ChildItem -Path $extraido -Directory | Select-Object -First 1
            if (-not $carpetaExtraida) { throw "El .zip descargado no contiene la carpeta esperada." }
            New-Item -ItemType Directory -Path (Split-Path $destino -Parent) -Force -ErrorAction SilentlyContinue | Out-Null
            Move-Item -Path $carpetaExtraida.FullName -Destination $destino
        } catch {
            Write-Host ""
            Write-Host "No se pudo descargar/descomprimir NeuroRepo: $($_.Exception.Message)" -ForegroundColor Red
            Read-Host "Pulsa Enter para salir"
            exit 1
        } finally {
            Remove-Item $zip -Force -ErrorAction SilentlyContinue
            Remove-Item $extraido -Recurse -Force -ErrorAction SilentlyContinue
        }
        if (-not (Test-CarpetaProyecto $destino)) {
            Write-Host "La descarga terminó pero no parece el proyecto completo." -ForegroundColor Red
            Read-Host "Pulsa Enter para salir"
            exit 1
        }
    }

    Write-Host "NeuroRepo descargado en '$destino'." -ForegroundColor Green
    return $destino
}

function Test-DockerListo {
    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $docker) { return $false }
    docker info *> $null
    return ($LASTEXITCODE -eq 0)
}

function Registrar-Reanudacion {
    Write-Paso "Dejando programado que este instalador se vuelva a lanzar solo al iniciar sesión..."
    schtasks /Create /TN $ResumeTaskName /TR "powershell -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" /SC ONLOGON /RL HIGHEST /F | Out-Null
}

function Quitar-Reanudacion {
    schtasks /Query /TN $ResumeTaskName *> $null
    if ($LASTEXITCODE -eq 0) {
        schtasks /Delete /TN $ResumeTaskName /F | Out-Null
    }
}

function Instalar-Docker {
    Write-Paso "Docker Desktop no está instalado. Descargándolo (puede tardar varios minutos)..."
    $instalador = Join-Path $env:TEMP "DockerDesktopInstaller.exe"
    Invoke-WebRequest -Uri "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe" -OutFile $instalador -UseBasicParsing

    Registrar-Reanudacion

    Write-Paso "Instalando Docker Desktop (en silencio, puede tardar unos minutos)..."
    Start-Process -FilePath $instalador -ArgumentList @("install", "--quiet", "--accept-license") -Wait

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Yellow
    Write-Host " Windows necesita REINICIARSE para terminar de instalar Docker." -ForegroundColor Yellow
    Write-Host " Al volver a iniciar sesión, este mismo instalador se abrirá solo" -ForegroundColor Yellow
    Write-Host " y continuará donde lo dejamos. No hace falta hacer nada más." -ForegroundColor Yellow
    Write-Host "============================================================" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Pulsa Enter para reiniciar ahora"
    Restart-Computer -Force
    exit
}

function Esperar-DockerArrancando {
    # Docker Desktop puede estar instalado pero el servicio (daemon) todavía no está arriba.
    $rutaDocker = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
    if (Test-Path $rutaDocker) {
        Write-Paso "Arrancando Docker Desktop..."
        Start-Process $rutaDocker
    }
    Write-Paso "Esperando a que Docker termine de arrancar (puede tardar 1-2 minutos)..."
    $intentos = 0
    while (-not (Test-DockerListo) -and $intentos -lt 60) {
        Start-Sleep -Seconds 5
        $intentos++
    }
    return Test-DockerListo
}

# --- 0. Proyecto (descargarlo de GitHub si hace falta) ---
$RepoRoot = Descargar-Proyecto
$EnvFile = Join-Path $RepoRoot ".env"

$miCopiaDelScript = Join-Path $RepoRoot "instalar.ps1"
$rutaActual = (Resolve-Path $PSCommandPath -ErrorAction SilentlyContinue).Path
$rutaEnRepo = (Resolve-Path $miCopiaDelScript -ErrorAction SilentlyContinue).Path
if ($rutaEnRepo -and $rutaActual -ne $rutaEnRepo) {
    # Nos acabamos de descargar: seguimos desde la copia ya instalada, para que a partir de
    # ahora todo (incluida la reanudación tras reiniciar) apunte siempre a esa carpeta.
    Write-Paso "Continuando la instalación desde '$RepoRoot'..."
    Start-Process powershell -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$miCopiaDelScript`"") -Wait
    exit
}

# --- 1. Docker ---
if (-not (Test-DockerListo)) {
    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $docker) {
        Instalar-Docker   # reinicia el equipo y termina el script; se reanuda solo al volver a entrar
    }
    if (-not (Esperar-DockerArrancando)) {
        Write-Host ""
        Write-Host "Docker no ha terminado de arrancar todavía." -ForegroundColor Red
        Write-Host "Abre Docker Desktop a mano, espera a que diga 'Running' y vuelve a ejecutar este instalador." -ForegroundColor Red
        Read-Host "Pulsa Enter para salir"
        exit 1
    }
}

Quitar-Reanudacion
Write-Host "Docker está listo." -ForegroundColor Green

# --- 2. Configuración ---
$reconfigurar = $true
if (Test-Path $EnvFile) {
    $resp = Read-Host "Ya existe una configuración previa (.env). ¿Volver a configurarla? (s/N)"
    $reconfigurar = $resp -match '^[sS]'
}

if ($reconfigurar) {
    Write-Paso "Vamos a configurar NeuroRepo"

    $adminNombre = Read-Host "Nombre del administrador [Administrador]"
    if ([string]::IsNullOrWhiteSpace($adminNombre)) { $adminNombre = "Administrador" }

    do {
        $adminDni = Read-Host "DNI del administrador (se usa para iniciar sesión)"
    } while ([string]::IsNullOrWhiteSpace($adminDni))

    do {
        $claveSegura = Read-Host "Contraseña del administrador" -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($claveSegura)
        $adminClave = [Runtime.InteropServices.Marshal]::PtrToStringUni($bstr)
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    } while ([string]::IsNullOrWhiteSpace($adminClave))

    do {
        $carpetaDocs = Read-Host "Ruta completa de la carpeta con los documentos (ej: C:\Documentos\Empresa)"
        if (-not [string]::IsNullOrWhiteSpace($carpetaDocs) -and -not (Test-Path $carpetaDocs)) {
            $crear = Read-Host "Esa carpeta no existe. ¿Crearla? (S/n)"
            if ($crear -notmatch '^[nN]') {
                New-Item -ItemType Directory -Path $carpetaDocs -Force | Out-Null
            } else {
                $carpetaDocs = ""
            }
        }
    } while ([string]::IsNullOrWhiteSpace($carpetaDocs))

    $modelo = Read-Host "Modelo de IA a usar [qwen2.5:1.5b]"
    if ([string]::IsNullOrWhiteSpace($modelo)) { $modelo = "qwen2.5:1.5b" }

    $intervalo = Read-Host "Cada cuántos minutos se reindexa la biblioteca [15]"
    if ([string]::IsNullOrWhiteSpace($intervalo)) { $intervalo = "15" }

    @(
        "DOCS_HOST_PATH=$carpetaDocs"
        "OLLAMA_MODEL=$modelo"
        "SCAN_INTERVAL_MINUTES=$intervalo"
        "BOOTSTRAP_ADMIN_NAME=$adminNombre"
        "BOOTSTRAP_ADMIN_DNI=$adminDni"
        "BOOTSTRAP_ADMIN_PASSWORD=$adminClave"
    ) | Set-Content -Path $EnvFile -Encoding UTF8

    Write-Host "Configuración guardada en $EnvFile" -ForegroundColor Green
}

# --- 3. Firewall ---
Write-Paso "Abriendo el puerto 4000 en el Firewall de Windows..."
if (-not (Get-NetFirewallRule -DisplayName "NeuroRepo" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "NeuroRepo" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow | Out-Null
}

# --- 4. Levantar el stack ---
Write-Paso "Construyendo y arrancando NeuroRepo (la primera vez puede tardar varios minutos: descarga el modelo de IA, ~2 GB)..."
Push-Location $RepoRoot
try {
    docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
    $composeOk = ($LASTEXITCODE -eq 0)
} finally {
    Pop-Location
}

if (-not $composeOk) {
    Write-Host ""
    Write-Host "Algo falló al levantar los contenedores. Revisa el mensaje de arriba." -ForegroundColor Red
    Read-Host "Pulsa Enter para salir"
    exit 1
}

# --- 5. Esperar a que responda ---
Write-Paso "Esperando a que la aplicación responda..."
$listo = $false
for ($i = 0; $i -lt 90; $i++) {
    try {
        Invoke-WebRequest -Uri "http://localhost:4000" -UseBasicParsing -TimeoutSec 3 | Out-Null
        $listo = $true
        break
    } catch {
        Start-Sleep -Seconds 5
    }
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "169.254.*" -and $_.IPAddress -ne "127.0.0.1" -and $_.InterfaceAlias -notmatch "Loopback|WSL|vEthernet" } |
    Select-Object -First 1).IPAddress
if (-not $ip) { $ip = "localhost" }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
if ($listo) {
    Write-Host " NeuroRepo está funcionando." -ForegroundColor Green
} else {
    Write-Host " NeuroRepo todavía se está terminando de arrancar" -ForegroundColor Yellow
    Write-Host " (puede seguir descargando el modelo de IA en segundo plano)." -ForegroundColor Yellow
}
Write-Host " Comparte esta dirección con tus compañeros, en la misma red:" -ForegroundColor Green
Write-Host ""
Write-Host "   http://$ip`:4000" -ForegroundColor White
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Read-Host "Pulsa Enter para cerrar"
