<#
    Estilo visual común de los instaladores de DocuPaz (consola de Windows PowerShell 5.1).

    Lo cargan con ". ui.ps1" el lanzador (instalador/instalador.ps1) y los instaladores (instalar.ps1,
    windows-nativo/instalar-windows.ps1, pre-instalacion/preinstalar.ps1, cargar-modelo.ps1). Cada uno
    tiene una versión mínima de reserva por si este archivo no está (instalar.ps1 suelto).

    - Ui-Banner: el logo y la línea de versión (una sola vez aunque se encadenen instaladores).
    - Ui-Fase / Ui-Paso: cabeceras numeradas con el tiempo transcurrido.
    - Ui-Linea / Ui-Ok / Ui-Info / Ui-Aviso / Ui-Fallo: líneas con etiqueta de color.
    - Ui-Final: la barra de progreso del final.
    - Además SUSTITUYE Write-Host y Read-Host (una función tapa al cmdlet del mismo nombre): así los
      mensajes que ya existían salen con este estilo sin tocar cada uno. Por color: Green = OK,
      Cyan = INFO, Yellow = AVISO, Red = ERROR; sin color, como texto sangrado. -NoNewline y las líneas
      vacías pasan tal cual. Read-Host antepone el tiempo y un "?" de color.
#>

if (-not $global:UiInicio) { $global:UiInicio = Get-Date }
if ($null -eq $global:UiPasoN) { $global:UiPasoN = 0 }

function Ui-Escribir($texto, $color = "Gray", [switch]$Seguido) {
    if ($Seguido) { Microsoft.PowerShell.Utility\Write-Host $texto -ForegroundColor $color -NoNewline }
    else { Microsoft.PowerShell.Utility\Write-Host $texto -ForegroundColor $color }
}

function Ui-Tiempo {
    $t = (Get-Date) - $global:UiInicio
    "{0:00}:{1:00}.{2:00}" -f [int][Math]::Floor($t.TotalMinutes), $t.Seconds, [int]($t.Milliseconds / 10)
}

function Ui-Version {
    foreach ($p in "client\package.json", "docker\client\package.json", "windows\app\client\package.json", "app\client\package.json", "..\client\package.json") {
        $f = Join-Path $PSScriptRoot $p
        if (Test-Path $f) { try { return (Get-Content $f -Raw | ConvertFrom-Json).version } catch { } }
    }
    return ""
}

function Ui-Banner($subtitulo) {
    if ($global:UiBannerVisto) { return }
    $global:UiBannerVisto = $true
    try { $Host.UI.RawUI.WindowTitle = "DocuPaz · instalador" } catch { }
    $logo = @(
        "  ██████╗  ██████╗  ██████╗██╗   ██╗██████╗  █████╗ ███████╗"
        "  ██╔══██╗██╔═══██╗██╔════╝██║   ██║██╔══██╗██╔══██╗╚══███╔╝"
        "  ██║  ██║██║   ██║██║     ██║   ██║██████╔╝███████║  ███╔╝ "
        "  ██║  ██║██║   ██║██║     ██║   ██║██╔═══╝ ██╔══██║ ███╔╝  "
        "  ██████╔╝╚██████╔╝╚██████╗╚██████╔╝██║     ██║  ██║███████╗"
        "  ╚═════╝  ╚═════╝  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝  ╚═╝╚══════╝"
    )
    $colores = "Cyan", "Cyan", "DarkCyan", "DarkCyan", "Blue", "DarkBlue"
    Ui-Escribir ""
    for ($i = 0; $i -lt $logo.Count; $i++) { Ui-Escribir $logo[$i] $colores[$i] }
    Ui-Escribir ""
    $version = Ui-Version
    Ui-Escribir "   biblioteca de documentos con IA" DarkGray -Seguido
    if ($version) { Ui-Escribir "  ·  v$version" DarkGray -Seguido }
    Ui-Escribir "  /  " DarkGray -Seguido
    Ui-Escribir $subtitulo White
    Ui-Escribir ("  " + ("─" * 74)) DarkGray
}

# Cabecera de fase: "FASE 1/2  Detección del entorno  /  sistema, virtualización y Docker"
function Ui-Fase($numero, $total, $titulo, $detalle) {
    Ui-Escribir ""
    Ui-Escribir ("FASE {0:00}/{1:00}  " -f $numero, $total) Blue -Seguido
    Ui-Escribir $titulo White -Seguido
    if ($detalle) { Ui-Escribir "  /  $detalle" DarkGray } else { Ui-Escribir "" }
}

# Paso numerado: "  00:01.23  03  INSTALAR     texto"
function Ui-Paso($texto, $detalle) {
    $global:UiPasoN++
    Ui-Escribir ""
    Ui-Escribir ("  " + (Ui-Tiempo) + "  ") DarkGray -Seguido
    Ui-Escribir ("{0:00}  " -f $global:UiPasoN) Cyan -Seguido
    Ui-Escribir $texto White -Seguido
    if ($detalle) { Ui-Escribir "   $detalle" DarkGray } else { Ui-Escribir "" }
}

# Línea de estado: "  00:01.23  OK      Node.js         v22.23.5, se omite" (texto en la columna 36)
function Ui-Linea($etiqueta, $color, $clave, $texto) {
    Ui-Escribir ("  " + (Ui-Tiempo) + "  ") DarkGray -Seguido
    Ui-Escribir ("{0,-6}  " -f $etiqueta) $color -Seguido
    if ($clave) { Ui-Escribir ("{0,-16}" -f $clave) Gray -Seguido }
    Ui-Escribir $texto $(if ($color -eq "Red") { "Red" } else { "White" })
}
function Ui-Ok($texto, $clave) { Ui-Linea "OK" Green $clave $texto }
function Ui-Info($texto, $clave) { Ui-Linea "INFO" Cyan $clave $texto }
function Ui-Aviso($texto, $clave) { Ui-Linea "AVISO" Yellow $clave $texto }
function Ui-Fallo($texto, $clave) { Ui-Linea "ERROR" Red $clave $texto }

# Texto aclaratorio, sangrado bajo la última línea
function Ui-Texto($texto) { Ui-Escribir ((" " * 36) + $texto) Gray }

# Barra del final: "  ━━━━━━━━━━━━━━━━━━━━  100%  instalación terminada   25.5s"
function Ui-Final($texto, [switch]$Fallo) {
    $segundos = ((Get-Date) - $global:UiInicio).TotalSeconds
    $color = if ($Fallo) { "Red" } else { "Green" }
    Ui-Escribir ""
    Ui-Escribir ("  " + ("═" * 74)) DarkCyan
    Ui-Escribir ("  " + (Ui-Tiempo) + "  ") DarkGray -Seguido
    Ui-Escribir ("━" * 24) $color -Seguido
    Ui-Escribir $(if ($Fallo) { "  ---  " } else { "  100%  " }) White -Seguido
    Ui-Escribir ("{0,-36}" -f $texto) $color -Seguido
    Ui-Escribir ("{0,6:0.0}s" -f $segundos) DarkGray
    Ui-Escribir ""
}

# --- Sustitutos de Write-Host y Read-Host (ver la cabecera) ---
function Write-Host {
    param(
        [Parameter(Position = 0, ValueFromRemainingArguments = $true)] $Object,
        [ConsoleColor] $ForegroundColor,
        [ConsoleColor] $BackgroundColor,
        [switch] $NoNewline,
        $Separator = " "
    )
    $texto = if ($null -eq $Object) { "" } else { ($Object | ForEach-Object { "$_" }) -join $Separator }
    if ($NoNewline -or $PSBoundParameters.ContainsKey("BackgroundColor") -or [string]::IsNullOrWhiteSpace($texto)) {
        Microsoft.PowerShell.Utility\Write-Host @PSBoundParameters
        return
    }
    if (-not $PSBoundParameters.ContainsKey("ForegroundColor")) { Ui-Texto $texto.Trim(); return }
    switch ($ForegroundColor) {
        "Green" { Ui-Ok $texto.Trim() }
        "Yellow" { Ui-Aviso $texto.Trim() }
        "Red" { Ui-Fallo $texto.Trim() }
        "Cyan" { Ui-Info $texto.Trim() }
        default { Ui-Escribir ((" " * 36) + $texto.Trim()) $ForegroundColor }
    }
}

function Read-Host {
    param([Parameter(Position = 0)] $Prompt, [switch] $AsSecureString)
    Ui-Escribir ("  " + (Ui-Tiempo) + "  ") DarkGray -Seguido
    Ui-Escribir "?       " Magenta -Seguido
    if ($AsSecureString) { Microsoft.PowerShell.Utility\Read-Host $Prompt -AsSecureString }
    else { Microsoft.PowerShell.Utility\Read-Host $Prompt }
}
