<#
    Instalador de NeuroRepo para Windows SIN Docker (máquinas virtuales sin virtualización anidada,
    o cuando no se quiere Docker). Todo sin internet, con lo que trae esta carpeta:
      app\                 la aplicación ya compilada, con sus dependencias (node_modules)
      componentes\node\    Node.js 22 portable (zip)
      componentes\mongodb\ mongod.exe + vc_redist.x64.exe (runtime de Visual C++ que necesita)
      componentes\ollama\  (opcional) ollama-windows-amd64.zip u OllamaSetup.exe: la IA del modo avanzado
      componentes\modelo\  (opcional) el modelo .gguf o sus partes .parteN

    Instala en C:\NeuroRepo (o donde se elija):
      - MongoDB como servicio de Windows "NeuroRepoMongo" (solo escucha en 127.0.0.1).
      - La IA (Ollama) y la app como tareas programadas que arrancan con el equipo, sin iniciar sesión,
        y se reinician solas si se caen. La app corre con un usuario de red cuando la biblioteca está
        en una carpeta compartida (\\servidor\recurso), para poder leerla.
    Volver a ejecutarlo actualiza la app y conserva los datos y la configuración.
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
function Leer-Clave($pregunta) {
    do {
        $segura = Read-Host $pregunta -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
        $clave = [Runtime.InteropServices.Marshal]::PtrToStringUni($bstr)
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    } while ([string]::IsNullOrWhiteSpace($clave))
    return $clave
}

# --- Administrador (relanza elevado; recuerda el usuario normal) ---
$esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) {
    $usuario = "$env:USERDOMAIN\$env:USERNAME"
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -UsuarioOriginal `"$usuario`""
    exit
}
if (-not $UsuarioOriginal) { $UsuarioOriginal = "$env:USERDOMAIN\$env:USERNAME" }
Set-Location $PSScriptRoot
Write-Host "Instalador de NeuroRepo para Windows (sin Docker)" -ForegroundColor Green

if ((Get-CimInstance Win32_Processor | Select-Object -First 1).Architecture -ne 9) {
    Write-Host "AVISO: este paquete es para equipos x64 (Intel/AMD). En ARM64 funcionaría por emulación, más lento." -ForegroundColor Yellow
    if ((Read-Host "¿Seguir? (s/N)") -notmatch '^[sS]') { Salir 1 }
}

# --- Carpeta de red: ruta UNC a partir de una unidad con letra (G:) ---
# Elevado no se ven las unidades de red de la sesión normal, pero su ruta sigue en el registro.
function Resolver-RutaRed($ruta) {
    if ($ruta -like '\\*') { return $ruta }
    if ($ruta -notmatch '^([A-Za-z]):(.*)$') { return $null }
    $letra = $Matches[1].ToUpper()
    $resto = $Matches[2]
    $unidad = Get-PSDrive -Name $letra -PSProvider FileSystem -ErrorAction SilentlyContinue
    if ($unidad -and $unidad.DisplayRoot -like '\\*') { return $unidad.DisplayRoot.TrimEnd('\') + $resto }
    $clave = Get-ItemProperty -Path "HKCU:\Network\$letra" -ErrorAction SilentlyContinue
    if ($clave -and $clave.RemotePath) { return $clave.RemotePath.TrimEnd('\') + $resto }
    try {
        # si el administrador es otra cuenta, la unidad está en el registro del usuario normal
        $sid = (New-Object Security.Principal.NTAccount($UsuarioOriginal)).Translate([Security.Principal.SecurityIdentifier]).Value
        $clave = Get-ItemProperty -Path "Registry::HKEY_USERS\$sid\Network\$letra" -ErrorAction SilentlyContinue
        if ($clave -and $clave.RemotePath) { return $clave.RemotePath.TrimEnd('\') + $resto }
    } catch { }
    return $null
}

# Valor para el .env que lee Node (--env-file): entre comillas simples se toma literal
function Valor-Env($valor) {
    if ($valor -notmatch "'") { return "'$valor'" }
    if ($valor -notmatch '"') { return "`"$valor`"" }
    throw "El valor no puede llevar a la vez comillas simples y dobles: $valor"
}

# --- 1. Dónde instalar ---
$Destino = Read-Host "Carpeta de instalación [C:\NeuroRepo]"
if ([string]::IsNullOrWhiteSpace($Destino)) { $Destino = "C:\NeuroRepo" }
$Destino = $Destino.Trim().Trim('"').TrimEnd('\')
$Datos = Join-Path $Destino "datos"
$Logs = Join-Path $Destino "logs"
$EnvFile = Join-Path $Destino "app\server\.env"
$TareaApp = "NeuroRepo - App"
$TareaIA = "NeuroRepo - IA"
$Servicio = "NeuroRepoMongo"
$Modelo = "qwen2.5:1.5b"

# --- 2. Configuración ---
$tareaAppExiste = [bool](Get-ScheduledTask -TaskName $TareaApp -ErrorAction SilentlyContinue)
$reconfigurar = $true
if ((Test-Path $EnvFile) -and $tareaAppExiste) {
    $reconfigurar = (Read-Host "NeuroRepo ya está instalado aquí. ¿Volver a configurarlo? (s/N; con N solo se actualiza la app)") -match '^[sS]'
}

if ($reconfigurar) {
    Write-Paso "Configuración"
    $adminNombre = Read-Host "Nombre del administrador [Administrador]"
    if ([string]::IsNullOrWhiteSpace($adminNombre)) { $adminNombre = "Administrador" }
    do { $adminDni = Read-Host "DNI del administrador (se usa para iniciar sesión)" } while ([string]::IsNullOrWhiteSpace($adminDni))
    $adminClave = Leer-Clave "Contraseña del administrador de NeuroRepo"

    $usuarioTarea = $null
    do {
        $carpeta = Read-Host "Carpeta con los documentos (ej: D:\Documentos, G:\Compartido o \\servidor\carpeta)"
        if ([string]::IsNullOrWhiteSpace($carpeta)) { continue }
        $carpeta = $carpeta.Trim().Trim('"').TrimEnd('\')
        $unc = Resolver-RutaRed $carpeta
        if ($unc) {
            # Carpeta de red: la app arranca sin sesión iniciada y no ve las letras de unidad (G:), así
            # que usa la ruta \\servidor\... con un usuario que tenga acceso a ella.
            Write-Host "Carpeta de red: $unc" -ForegroundColor Cyan
            Write-Host "La app usará un usuario con acceso a esa carpeta (normalmente el tuyo)."
            $usuarioTarea = Read-Host "Usuario de Windows/dominio [$UsuarioOriginal]"
            if ([string]::IsNullOrWhiteSpace($usuarioTarea)) { $usuarioTarea = $UsuarioOriginal }
            $claveTarea = Leer-Clave "Contraseña de Windows de $usuarioTarea"
            $carpeta = $unc
        } elseif ($carpeta -match '^[A-Za-z]:' -and -not (Test-Path (Split-Path -Qualifier $carpeta))) {
            Write-Host "No encuentro la unidad $(Split-Path -Qualifier $carpeta). Si es de red, escribe la ruta \\servidor\recurso\carpeta (la ves con: net use)." -ForegroundColor Yellow
            $carpeta = ""
        } elseif (-not (Test-Path $carpeta)) {
            if ((Read-Host "Esa carpeta no existe. ¿Crearla? (S/n)") -notmatch '^[nN]') { New-Item -ItemType Directory -Path $carpeta -Force | Out-Null }
            else { $carpeta = "" }
        }
    } while ([string]::IsNullOrWhiteSpace($carpeta))

    $intervalo = Read-Host "Cada cuántos minutos se reindexa la biblioteca [15]"
    if ([string]::IsNullOrWhiteSpace($intervalo)) { $intervalo = "15" }
}

# --- Utilidades: tareas programadas y espera de un servicio web ---
# Tareas que arrancan con el equipo, sin límite de tiempo y con una sola instancia
function Registrar-Tarea($nombre, $script, $usuario, $clave) {
    $accion = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$script`""
    $inicio = New-ScheduledTaskTrigger -AtStartup
    $ajustes = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
    Unregister-ScheduledTask -TaskName $nombre -Confirm:$false -ErrorAction SilentlyContinue
    if ($usuario) {
        Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger $inicio -Settings $ajustes -User $usuario -Password $clave -RunLevel Highest | Out-Null
    } else {
        $sistema = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
        Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger $inicio -Settings $ajustes -Principal $sistema | Out-Null
    }
}

function Esperar-Url($url, $segundos) {
    for ($i = 0; $i -lt $segundos; $i += 2) {
        try { Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 2 | Out-Null; return $true } catch { Start-Sleep -Seconds 2 }
    }
    return $false
}

function Mostrar($nombre, $instalado, $detalle) {
    $marca = if ($instalado) { "[OK]" } else { "[--]" }
    $color = if ($instalado) { "Green" } else { "Yellow" }
    Write-Host ("  {0} {1,-22} {2}" -f $marca, $nombre, $detalle) -ForegroundColor $color
}

# --- 3. Comprobación previa: qué hay ya instalado (lo que esté se omite) ---
Write-Paso "Comprobando lo que ya está instalado"

# Node.js: se omite si ya está la misma versión que trae el paquete
$NodeExe = Join-Path $Destino "node\node.exe"
$nodeZip = Get-ChildItem "componentes\node\node-v22*-win-x64.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
$nodeVersionPaquete = if ($nodeZip) { $nodeZip.Name -replace '^node-(v[\d.]+)-win-x64\.zip$', '$1' } else { $null }
$nodeVersionActual = if (Test-Path $NodeExe) { "$(Sin-Parar { & $NodeExe --version 2>$null })".Trim() } else { "" }
$instalarNode = (-not $nodeVersionActual) -or ($nodeVersionPaquete -and $nodeVersionActual -ne $nodeVersionPaquete)
if ($instalarNode -and -not $nodeZip) { Write-Host "ERROR: falta componentes\node\node-v22...-win-x64.zip" -ForegroundColor Red; Salir 1 }
Mostrar "Node.js" (-not $instalarNode) $(if ($instalarNode) { "se instalará $nodeVersionPaquete" } else { "$nodeVersionActual, se omite" })

# Runtime de Visual C++ (lo necesita mongod.exe)
$vcInstalado = $false
foreach ($clave in "HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64") {
    if ((Get-ItemProperty $clave -ErrorAction SilentlyContinue).Installed -eq 1) { $vcInstalado = $true }
}
Mostrar "Visual C++ runtime" $vcInstalado $(if ($vcInstalado) { "se omite" } else { "se instalará" })

# MongoDB: se omite la copia si el servicio ya existe con el mismo mongod.exe
$MongoExe = Join-Path $Destino "mongodb\mongod.exe"
$mongoPaquete = Join-Path $PSScriptRoot "componentes\mongodb\mongod.exe"
$servicioMongo = Get-Service $Servicio -ErrorAction SilentlyContinue
$copiarMongo = -not (Test-Path $MongoExe)
if (-not $copiarMongo -and (Test-Path $mongoPaquete)) { $copiarMongo = (Get-FileHash $MongoExe).Hash -ne (Get-FileHash $mongoPaquete).Hash }
if ($copiarMongo -and -not (Test-Path $mongoPaquete)) { Write-Host "ERROR: falta componentes\mongodb\mongod.exe" -ForegroundColor Red; Salir 1 }
$mongoListo = $servicioMongo -and -not $copiarMongo
Mostrar "MongoDB" $mongoListo $(if ($mongoListo) { "servicio $Servicio ($($servicioMongo.Status)), se omite" } elseif ($servicioMongo) { "se actualizará mongod.exe" } else { "se instalará como servicio" })

# IA (Ollama): la de NeuroRepo, una ya instalada en el sistema o una que ya esté funcionando.
# Si hay alguna, no se instala nada y se pasa directamente al modelo.
$OllamaPropio = Join-Path $Destino "ollama\ollama.exe"
$OllamaSistema = @(
    (Get-Command ollama.exe -ErrorAction SilentlyContinue).Source
    (Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe")
    (Join-Path $env:ProgramFiles "Ollama\ollama.exe")
    $(try { Join-Path ((Get-CimInstance Win32_UserProfile | Where-Object { $_.SID -eq (New-Object Security.Principal.NTAccount($UsuarioOriginal)).Translate([Security.Principal.SecurityIdentifier]).Value }).LocalPath) "AppData\Local\Programs\Ollama\ollama.exe" } catch { $null })
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
$ollamaFuncionando = Esperar-Url "http://127.0.0.1:11434/api/version" 2
$ollamaZip = Get-ChildItem "componentes\ollama\ollama-windows-amd64*.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
$ollamaSetup = Get-ChildItem "componentes\ollama\OllamaSetup*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (Test-Path $OllamaPropio) { $modoIA = "propio"; $OllamaExe = $OllamaPropio; $textoIA = "la de NeuroRepo ($OllamaPropio), se omite" }
elseif ($ollamaFuncionando) { $modoIA = "externo"; $OllamaExe = $OllamaSistema; $textoIA = "ya hay una funcionando en el puerto 11434, se usa esa" }
elseif ($OllamaSistema) { $modoIA = "sistema"; $OllamaExe = $OllamaSistema; $textoIA = "instalada en $OllamaSistema, se usa esa" }
elseif ($ollamaZip -or $ollamaSetup) { $modoIA = "instalar"; $OllamaExe = $null; $textoIA = "se instalará desde componentes\ollama" }
else { $modoIA = "ninguna"; $OllamaExe = $null; $textoIA = "no hay; solo modo de búsqueda simple" }
Mostrar "IA (Ollama)" ($modoIA -in "propio", "externo", "sistema") $textoIA

# OCR (leer escaneos e imágenes): tesseract + pdftoppm de componentes\ocr, copiados a $Destino\ocr
$OcrDir = Join-Path $Destino "ocr"
$ocrPaquete = Join-Path $PSScriptRoot "componentes\ocr\Library\bin\tesseract.exe"
$ocrInstalado = (Test-Path (Join-Path $OcrDir "Library\bin\tesseract.exe")) -and (Test-Path (Join-Path $OcrDir "share\tessdata\spa.traineddata"))
if ($ocrInstalado) { $textoOcr = "instalado en $OcrDir$(if (Test-Path $ocrPaquete) { ', se actualizará solo si cambia' } else { ', se omite' })" }
elseif (Test-Path $ocrPaquete) { $textoOcr = "se instalará (tesseract en español + pdftoppm)" }
else { $textoOcr = "no está en componentes\ocr; los escaneos no se leerán" }
Mostrar "OCR" $ocrInstalado $textoOcr

$appInstalada = Test-Path (Join-Path $Destino "app\server\src\index.js")
Mostrar "Aplicación" $appInstalada $(if ($appInstalada) { "se actualizará (solo los archivos que cambien)" } else { "se instalará" })

# --- 4. Parar solo lo que se va a cambiar ---
Write-Paso "Preparando $Destino"
Sin-Parar { Stop-ScheduledTask -TaskName $TareaApp -ErrorAction SilentlyContinue }
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($Destino, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force
foreach ($d in $Destino, $Datos, $Logs, (Join-Path $Datos "mongo"), (Join-Path $Datos "ia-modelos")) { New-Item -ItemType Directory -Path $d -Force | Out-Null }

# --- 5. App y Node.js ---
Write-Paso "Copiando la aplicación"
$envGuardado = if (Test-Path $EnvFile) { Get-Content $EnvFile -Raw } else { $null }
Sin-Parar { & robocopy.exe (Join-Path $PSScriptRoot "app") (Join-Path $Destino "app") /MIR /XF .env /NFL /NDL /NJH /NJS /NP | Out-Null }
if ($LASTEXITCODE -ge 8) { Write-Host "ERROR: no se pudo copiar la aplicación (robocopy $LASTEXITCODE)." -ForegroundColor Red; Salir 1 }
if ($envGuardado -and -not (Test-Path $EnvFile)) { [IO.File]::WriteAllText($EnvFile, $envGuardado) }

if ($instalarNode) {
    Write-Paso "Instalando Node.js $nodeVersionPaquete"
    $tmp = Join-Path $env:TEMP "neurorepo-node"
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive $nodeZip.FullName -DestinationPath $tmp
    Remove-Item (Join-Path $Destino "node") -Recurse -Force -ErrorAction SilentlyContinue
    Move-Item (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName (Join-Path $Destino "node")
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $ocrPaquete) {
    Write-Paso "OCR (tesseract + pdftoppm)"
    # /MIR solo copia lo que haya cambiado: si ya estaba igual, no hace nada
    Sin-Parar { & robocopy.exe (Join-Path $PSScriptRoot "componentes\ocr") $OcrDir /MIR /NFL /NDL /NJH /NJS /NP | Out-Null }
    if ($LASTEXITCODE -ge 8) { Write-Host "AVISO: no se pudo copiar el OCR (robocopy $LASTEXITCODE); sigue sin OCR." -ForegroundColor Yellow }
    else { Write-Host "OCR listo en $OcrDir." }
}

# --- 6. MongoDB (servicio de Windows) ---
Write-Paso "MongoDB"
if (-not $vcInstalado) {
    Write-Host "Instalando el runtime de Visual C++..."
    $p = Start-Process "componentes\mongodb\vc_redist.x64.exe" -ArgumentList "/install", "/quiet", "/norestart" -Wait -PassThru
    if ($p.ExitCode -notin 0, 1638, 3010) { Write-Host "AVISO: el runtime de Visual C++ terminó con el código $($p.ExitCode)." -ForegroundColor Yellow }
}
New-Item -ItemType Directory -Path (Join-Path $Destino "mongodb") -Force | Out-Null
if ($copiarMongo) {
    if ($servicioMongo) { Stop-Service $Servicio -Force }
    Copy-Item $mongoPaquete $MongoExe -Force
}
$mongoCfg = Join-Path $Destino "mongodb\mongod.cfg"
$cfgNueva = @(
    "# Generado por el instalador de NeuroRepo"
    "storage:"
    "  dbPath: '$(Join-Path $Datos 'mongo')'"
    "  wiredTiger:"
    "    engineConfig:"
    "      cacheSizeGB: 0.5"
    "systemLog:"
    "  destination: file"
    "  path: '$(Join-Path $Logs 'mongod.log')'"
    "  logAppend: true"
    "net:"
    "  bindIp: 127.0.0.1"
    "  port: 27017"
) -join "`r`n"
$cfgCambiada = -not (Test-Path $mongoCfg) -or ((Get-Content $mongoCfg -Raw).Trim() -ne $cfgNueva.Trim())
if ($cfgCambiada) { Set-Content -Path $mongoCfg -Value $cfgNueva -Encoding ASCII }
if (-not $servicioMongo) {
    New-Service -Name $Servicio -DisplayName "NeuroRepo - MongoDB" -StartupType Automatic `
        -BinaryPathName "`"$MongoExe`" --config `"$mongoCfg`" --service" | Out-Null
} elseif ($cfgCambiada -and -not $copiarMongo) {
    Restart-Service $Servicio -Force
}
if ((Get-Service $Servicio).Status -ne "Running") { Start-Service $Servicio }
Write-Host "MongoDB en marcha (servicio $Servicio)."

# --- 7. IA (Ollama) ---
Write-Paso "IA (Ollama)"
if ($modoIA -eq "instalar") {
    $dirIA = Join-Path $Destino "ollama"
    if ($ollamaZip) {
        Write-Host "Descomprimiendo $($ollamaZip.Name) (puede tardar unos minutos)..."
        Remove-Item $dirIA -Recurse -Force -ErrorAction SilentlyContinue
        Expand-Archive $ollamaZip.FullName -DestinationPath $dirIA
    } else {
        Start-Process $ollamaSetup.FullName -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/DIR=`"$dirIA`"" -Wait
        # El instalador normal deja la bandeja del sistema arrancando con la sesión: aquí la IA la lleva la tarea
        Get-Process "ollama app", ollama -ErrorAction SilentlyContinue | Stop-Process -Force
        Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Ollama*.lnk", "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup\Ollama*.lnk" -ErrorAction SilentlyContinue | Remove-Item -Force
    }
    $OllamaExe = $OllamaPropio
    if (-not (Test-Path $OllamaExe)) { Write-Host "AVISO: no se encontró ollama.exe tras instalarlo; sigue sin IA." -ForegroundColor Yellow; $modoIA = "ninguna" }
}

# Con una IA propia o del sistema, NeuroRepo la arranca con el equipo (tarea). Con una que ya estaba
# funcionando por su cuenta (modo "externo"), se usa tal cual y no se crea ninguna tarea.
if ($modoIA -in "propio", "sistema", "instalar") {
    $iniciarIA = Join-Path $Destino "iniciar-ia.cmd"
    @(
        "@echo off"
        "rem Generado por el instalador de NeuroRepo: IA local (Ollama). Se reinicia sola si se cae."
        "set OLLAMA_HOST=127.0.0.1:11434"
        "set OLLAMA_MODELS=$(Join-Path $Datos 'ia-modelos')"
        "set OLLAMA_KEEP_ALIVE=24h"
        ":inicio"
        "`"$OllamaExe`" serve >> `"$(Join-Path $Logs 'ia.log')`" 2>&1"
        "timeout /t 10 /nobreak >nul"
        "goto inicio"
    ) | Set-Content -Path $iniciarIA -Encoding ASCII
    if (-not (Get-ScheduledTask -TaskName $TareaIA -ErrorAction SilentlyContinue) -or $modoIA -eq "instalar") {
        Registrar-Tarea $TareaIA $iniciarIA $null $null
    }
    if (-not $ollamaFuncionando) { Start-ScheduledTask -TaskName $TareaIA }
}

# El modelo: se omite si ya está cargado; si no, se carga desde componentes\modelo (.gguf o sus partes)
if ($modoIA -ne "ninguna") {
    if (-not (Esperar-Url "http://127.0.0.1:11434/api/version" 90)) {
        Write-Host "AVISO: la IA no responde todavía; revisa $(Join-Path $Logs 'ia.log')." -ForegroundColor Yellow
    } else {
        $tags = (Invoke-WebRequest "http://127.0.0.1:11434/api/tags" -UseBasicParsing).Content
        if ($tags -match [regex]::Escape("`"$Modelo`"")) {
            Write-Host "El modelo $Modelo ya está cargado, se omite." -ForegroundColor Green
        } elseif (-not $OllamaExe) {
            Write-Host "AVISO: hay una IA funcionando pero no encuentro ollama.exe para cargarle el modelo $Modelo." -ForegroundColor Yellow
        } else {
            # Se copia/une siempre en la carpeta de datos (ruta sin espacios para la línea FROM) y se borra
            # al terminar: Ollama guarda su propia copia.
            $origen = @(Get-ChildItem "componentes\modelo\*.gguf" -ErrorAction SilentlyContinue | Select-Object -First 1)
            if (-not $origen.Count) { $origen = @(Get-ChildItem "componentes\modelo\*.parte*" -ErrorAction SilentlyContinue | Sort-Object { [int]($_.Name -replace '^.*\.parte', '') }) }
            if ($origen.Count) {
                Write-Host "Preparando el modelo ($($origen.Count) archivo(s))..."
                $temporal = Join-Path $Datos "modelo-temporal.gguf"
                $salida = [IO.File]::Create($temporal)
                try { foreach ($pt in $origen) { $entrada = [IO.File]::OpenRead($pt.FullName); try { $entrada.CopyTo($salida) } finally { $entrada.Close() } } }
                finally { $salida.Close() }
                Write-Host "Cargando el modelo $Modelo (puede tardar un minuto)..."
                $modelfile = Join-Path $Datos "Modelfile"
                "FROM $temporal" | Set-Content -Path $modelfile -Encoding ASCII
                $env:OLLAMA_HOST = "127.0.0.1:11434"
                Sin-Parar { & $OllamaExe create $Modelo -f $modelfile 2>&1 | Out-Null }
                if ($LASTEXITCODE -eq 0) { Write-Host "Modelo cargado." } else { Write-Host "AVISO: no se pudo cargar el modelo (código $LASTEXITCODE)." -ForegroundColor Yellow }
                Remove-Item $modelfile, $temporal -ErrorAction SilentlyContinue
            } else {
                Write-Host "AVISO: no hay modelo en componentes\modelo: el modo avanzado no funcionará hasta cargarlo." -ForegroundColor Yellow
            }
        }
    }
} else {
    Write-Host "Sin Ollama: NeuroRepo funcionará solo en modo de búsqueda simple." -ForegroundColor Yellow
}

# --- 8. App ---
Write-Paso "Configurando la aplicación"
if ($reconfigurar) {
    $lineas = @(
        "# Generado por el instalador de NeuroRepo para Windows"
        "NODE_ENV=production"
        "PORT=4000"
        "MONGODB_URI=mongodb://127.0.0.1:27017/notas-ia"
        "OLLAMA_URL=http://127.0.0.1:11434"
        "OLLAMA_MODEL=$Modelo"
        "LIBRARY_ROOT=$(Valor-Env $carpeta)"
        "SCAN_INTERVAL_MINUTES=$intervalo"
        "BOOTSTRAP_ADMIN_NAME=$(Valor-Env $adminNombre)"
        "BOOTSTRAP_ADMIN_DNI=$(Valor-Env $adminDni)"
        "BOOTSTRAP_ADMIN_PASSWORD=$(Valor-Env $adminClave)"
    )
    # Sin BOM: Node leería la primera variable con el BOM pegado al nombre
    [IO.File]::WriteAllLines($EnvFile, $lineas, (New-Object Text.UTF8Encoding $false))
}

$iniciarApp = Join-Path $Destino "iniciar-app.cmd"
@(
    "@echo off"
    "rem Generado por el instalador de NeuroRepo: la aplicación. Se reinicia sola si se cae."
    "rem OCR: la app busca tesseract y pdftoppm en el PATH; sus DLL y diccionarios van en $OcrDir"
    "if exist `"$OcrDir\Library\bin\tesseract.exe`" ("
    "  set `"PATH=$OcrDir\Library\bin;$OcrDir;%PATH%`""
    "  set `"TESSDATA_PREFIX=$OcrDir\share\tessdata`""
    "  set `"FONTCONFIG_FILE=$OcrDir\Library\etc\fonts\fonts.conf`""
    ")"
    "cd /d `"$(Join-Path $Destino 'app\server')`""
    ":inicio"
    "`"$NodeExe`" --env-file-if-exists=.env src\index.js >> `"$(Join-Path $Logs 'app.log')`" 2>&1"
    "timeout /t 10 /nobreak >nul"
    "goto inicio"
) | Set-Content -Path $iniciarApp -Encoding ASCII

@(
    "@echo off"
    "rem Restablece la contraseña de un administrador de NeuroRepo (sin DNI, lista los administradores)"
    "cd /d `"$(Join-Path $Destino 'app\server')`""
    "set /p DNI=DNI del administrador (Enter para ver la lista): "
    "`"$NodeExe`" --env-file-if-exists=.env src\resetAdmin.js %DNI%"
    "pause"
) | Set-Content -Path (Join-Path $Destino "Restablecer-admin.bat") -Encoding ASCII

if ($reconfigurar -or -not $tareaAppExiste) {
    $registrada = $false
    while (-not $registrada) {
        try {
            Registrar-Tarea $TareaApp $iniciarApp $usuarioTarea $claveTarea
            $registrada = $true
        } catch {
            Write-Host "No se pudo crear la tarea con ese usuario: $($_.Exception.Message)" -ForegroundColor Yellow
            if (-not $usuarioTarea) { Salir 1 }
            $claveTarea = Leer-Clave "Vuelve a escribir la contraseña de Windows de $usuarioTarea"
        }
    }
}

# --- 9. Firewall y arranque ---
Write-Paso "Abriendo el puerto 4000 en el Firewall de Windows"
if (-not (Get-NetFirewallRule -DisplayName "NeuroRepo" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "NeuroRepo" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow | Out-Null
}

Write-Paso "Arrancando NeuroRepo"
Start-ScheduledTask -TaskName $TareaApp
if (-not (Esperar-Url "http://localhost:4000/" 120)) {
    Write-Host "ERROR: la app no responde. Revisa $(Join-Path $Logs 'app.log')." -ForegroundColor Red
    Salir 1
}

$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } | Select-Object -ExpandProperty IPAddress
Write-Host ""
Write-Host "NeuroRepo está funcionando." -ForegroundColor Green
Write-Host "  En este equipo:     http://localhost:4000"
foreach ($ip in $ips) { Write-Host "  Desde la red local: http://${ip}:4000" }
Write-Host ""
Write-Host "Arranca solo con el equipo (servicio NeuroRepoMongo y tareas «$TareaApp» y «$TareaIA»)."
Write-Host "Registros en $Logs. Para restablecer la contraseña del admin: $(Join-Path $Destino 'Restablecer-admin.bat')."
if ($usuarioTarea) { Write-Host "Si cambia la contraseña de Windows de $usuarioTarea, vuelve a ejecutar este instalador y elige reconfigurar." -ForegroundColor Yellow }
Salir 0
