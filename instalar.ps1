<#
  Instalador de DocuPaz para Windows.

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

    Write-Paso "Este instalador se ha ejecutado suelto: hace falta descargar DocuPaz primero."
    $porDefecto = Join-Path $env:USERPROFILE "DocuPaz"
    $destino = Read-Host "¿En qué carpeta lo instalamos? [$porDefecto]"
    if ([string]::IsNullOrWhiteSpace($destino)) { $destino = $porDefecto }

    if (Test-CarpetaProyecto $destino) {
        Write-Host "Ya hay una copia de DocuPaz en '$destino'; se reutiliza." -ForegroundColor Green
        return $destino
    }
    if (Test-Path $destino) {
        Write-Host ""
        Write-Host "La carpeta '$destino' ya existe y no parece una instalación de DocuPaz." -ForegroundColor Red
        Write-Host "Elige otra carpeta (o vacía/borra esa) y vuelve a ejecutar el instalador." -ForegroundColor Red
        Read-Host "Pulsa Enter para salir"
        exit 1
    }

    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git) {
        Write-Paso "Descargando DocuPaz desde GitHub con git..."
        git clone --depth 1 $RepoUrl $destino
        if ($LASTEXITCODE -ne 0 -or -not (Test-CarpetaProyecto $destino)) {
            Write-Host "No se pudo clonar el repositorio." -ForegroundColor Red
            Read-Host "Pulsa Enter para salir"
            exit 1
        }
    } else {
        Write-Paso "Descargando DocuPaz desde GitHub (.zip; no hace falta tener git instalado)..."
        $zip = Join-Path $env:TEMP "DocuPaz-descarga.zip"
        $extraido = Join-Path $env:TEMP "DocuPaz-extraido"
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
            Write-Host "No se pudo descargar/descomprimir DocuPaz: $($_.Exception.Message)" -ForegroundColor Red
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

    Write-Host "DocuPaz descargado en '$destino'." -ForegroundColor Green
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

# --- Carpeta de documentos en red ---
# Docker Desktop corre en una máquina virtual que no ve las unidades de red con letra (G:...): un
# bind mount de G:\Carpeta sale vacío. Para esas rutas Docker monta el recurso SMB directamente
# (docker-compose.red.yml), así que hace falta su ruta UNC (\\servidor\recurso) y un usuario de red.
function Resolver-RutaRed($ruta) {
    if ($ruta -like '\\*') { return $ruta }
    if ($ruta -notmatch '^([A-Za-z]):(.*)$') { return $null }
    $letra = $Matches[1].ToUpper()
    $resto = $Matches[2]
    $unidad = Get-PSDrive -Name $letra -PSProvider FileSystem -ErrorAction SilentlyContinue
    if ($unidad -and $unidad.DisplayRoot -like '\\*') { return $unidad.DisplayRoot.TrimEnd('\') + $resto }
    # Al ejecutarse como administrador las unidades de red de la sesión normal no se ven, pero su
    # ruta sigue guardada en el registro del usuario.
    $clave = Get-ItemProperty -Path "HKCU:\Network\$letra" -ErrorAction SilentlyContinue
    if ($clave -and $clave.RemotePath) { return $clave.RemotePath.TrimEnd('\') + $resto }
    return $null
}

function Configurar-CarpetaRed($unc) {
    if ($unc -notmatch '^\\\\([^\\]+)\\([^\\]+)(\\.*)?$') {
        Write-Host "No entiendo la ruta de red '$unc' (debe ser \\servidor\recurso\carpeta)." -ForegroundColor Red
        return $null
    }
    $servidor = $Matches[1]
    $device = ("//" + $servidor + "/" + $Matches[2] + $Matches[3]) -replace '\\', '/'
    Write-Host "Carpeta de red detectada: $unc" -ForegroundColor Cyan
    Write-Host "Docker no ve las unidades de red de Windows, así que se conectará él mismo a esa carpeta"
    Write-Host "con un usuario de red (normalmente el tuyo, el mismo con el que entras en Windows)."

    $ip = $null
    try {
        $ip = [System.Net.Dns]::GetHostAddresses($servidor) |
            Where-Object { $_.AddressFamily -eq 'InterNetwork' } | Select-Object -First 1
    } catch { }
    if ($ip) { $ip = $ip.ToString() } else {
        $ip = Read-Host "No consigo la IP de '$servidor'. Escríbela (la ves con: ping $servidor)"
        if ([string]::IsNullOrWhiteSpace($ip)) { return $null }
    }

    $usuario = Read-Host "Usuario de red [$env:USERNAME]"
    if ([string]::IsNullOrWhiteSpace($usuario)) { $usuario = $env:USERNAME }
    $dominioPorDefecto = if ($env:USERDOMAIN -and $env:USERDOMAIN -ne $env:COMPUTERNAME) { $env:USERDOMAIN } else { "" }
    $dominio = Read-Host "Dominio de red [$dominioPorDefecto]"
    if ([string]::IsNullOrWhiteSpace($dominio)) { $dominio = $dominioPorDefecto }
    do {
        $claveSegura = Read-Host "Contraseña de red de $usuario" -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($claveSegura)
        $clave = [Runtime.InteropServices.Marshal]::PtrToStringUni($bstr)
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    } while ([string]::IsNullOrWhiteSpace($clave))

    # En las opciones de montaje la coma separa campos: dentro de un valor se escribe doble.
    $opts = "addr=$ip,username=$($usuario -replace ',', ',,'),password=$($clave -replace ',', ',,')"
    if ($dominio) { $opts += ",domain=$dominio" }
    # Lectura/escritura para la app (corre como root en el contenedor) y nombres con tildes.
    $opts += ",uid=0,gid=0,file_mode=0777,dir_mode=0777,noperm,iocharset=utf8"

    Write-Host "AVISO: la contraseña de red queda guardada en el archivo .env de esta carpeta." -ForegroundColor Yellow
    Write-Host "Si la cambias en Windows, vuelve a ejecutar este instalador y elige reconfigurar." -ForegroundColor Yellow
    return [pscustomobject]@{ Device = $device; Opts = $opts }
}

# Valor para el .env de Docker Compose sin que $, # o espacios se interpreten.
function Formatear-ValorEnv($valor) {
    if ($valor -notmatch "'") { return "'$valor'" }
    return '"' + ($valor -replace '\\', '\\' -replace '"', '\"' -replace '\$', '$$$$') + '"'
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
    Write-Paso "Vamos a configurar DocuPaz"

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

    $red = $null
    do {
        $carpetaDocs = Read-Host "Ruta completa de la carpeta con los documentos (ej: C:\Documentos\Empresa, G:\Compartido o \\servidor\carpeta)"
        if ([string]::IsNullOrWhiteSpace($carpetaDocs)) { continue }
        $carpetaDocs = $carpetaDocs.Trim().Trim('"').TrimEnd('\')
        $unc = Resolver-RutaRed $carpetaDocs
        if ($unc) {
            $red = Configurar-CarpetaRed $unc
            if (-not $red) { $carpetaDocs = "" }
            continue
        }
        if ($carpetaDocs -match '^[A-Za-z]:' -and -not (Test-Path (Split-Path -Qualifier $carpetaDocs))) {
            Write-Host "No encuentro la unidad $(Split-Path -Qualifier $carpetaDocs) desde aquí." -ForegroundColor Yellow
            Write-Host "Si es una unidad de red, escribe su ruta completa (\\servidor\recurso\carpeta)."
            Write-Host "La ves en una consola normal con:  net use"
            $carpetaDocs = ""
            continue
        }
        if (-not (Test-Path $carpetaDocs)) {
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

    $lineasRed = @()
    if ($red) {
        $lineasRed = @(
            "DOCS_SMB_DEVICE=$(Formatear-ValorEnv $red.Device)"
            "DOCS_SMB_OPTS=$(Formatear-ValorEnv $red.Opts)"
        )
    }

    @(
        # Con carpeta de red, DOCS_HOST_PATH solo es informativo (docker-compose.local.yml lo exige),
        # el montaje real lo hace docker-compose.red.yml con DOCS_SMB_*.
        "DOCS_HOST_PATH=$(Formatear-ValorEnv $carpetaDocs)"
        "OLLAMA_MODEL=$modelo"
        "SCAN_INTERVAL_MINUTES=$intervalo"
        "BOOTSTRAP_ADMIN_NAME=$adminNombre"
        "BOOTSTRAP_ADMIN_DNI=$adminDni"
        "BOOTSTRAP_ADMIN_PASSWORD=$adminClave"
    ) + $lineasRed | Set-Content -Path $EnvFile -Encoding UTF8

    Write-Host "Configuración guardada en $EnvFile" -ForegroundColor Green
}

# --- 3. Firewall ---
Write-Paso "Abriendo el puerto 4000 en el Firewall de Windows..."
# La regla se llamaba "NeuroRepo" (nombre anterior del producto): se sustituye
Remove-NetFirewallRule -DisplayName "NeuroRepo" -ErrorAction SilentlyContinue
if (-not (Get-NetFirewallRule -DisplayName "DocuPaz" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "DocuPaz" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow | Out-Null
}

# --- 4. Levantar el stack ---
Write-Paso "Construyendo y arrancando DocuPaz (la primera vez puede tardar varios minutos: descarga el modelo de IA, ~2 GB)..."
Push-Location $RepoRoot
try {
    $composeFiles = @("-f", "docker-compose.yml", "-f", "docker-compose.local.yml")
    # Paquete offline (zip con server/node_modules y client/dist ya incluidos): construye sin npm ni
    # compilar la interfaz, para equipos sin internet o con el DNS capado (ver Dockerfile.offline).
    if ((Test-Path "server\node_modules") -and (Test-Path "client\dist\index.html") -and (Test-Path "docker-compose.offline.yml")) {
        Write-Host "Paquete offline detectado: se usan las dependencias incluidas, sin descargar nada de npm."
        $composeFiles += @("-f", "docker-compose.offline.yml")
    }
    if (Select-String -Path $EnvFile -Pattern '^DOCS_SMB_DEVICE=' -Quiet) {
        Write-Host "Carpeta de red: Docker la montará directamente desde el servidor (SMB)."
        $composeFiles += @("-f", "docker-compose.red.yml")
        # Docker no actualiza las opciones de un volumen ya creado (ruta, contraseña...): se recrea.
        docker compose @composeFiles down 2>$null | Out-Null
        docker volume rm neurorepo-documentos-red 2>$null | Out-Null
    }
    docker compose @composeFiles up -d --build
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
    Write-Host " DocuPaz está funcionando." -ForegroundColor Green
} else {
    Write-Host " DocuPaz todavía se está terminando de arrancar" -ForegroundColor Yellow
    Write-Host " (puede seguir descargando el modelo de IA en segundo plano)." -ForegroundColor Yellow
}
Write-Host " Comparte esta dirección con tus compañeros, en la misma red:" -ForegroundColor Green
Write-Host ""
Write-Host "   http://$ip`:4000" -ForegroundColor White
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Read-Host "Pulsa Enter para cerrar"
