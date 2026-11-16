<#
    Carga el modelo de IA en NeuroRepo SIN internet (para redes donde Ollama no puede descargarlo).

    1. En un equipo con internet, descarga el archivo del modelo (unos 1,1 GB):
       https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf
    2. Cópialo a esta carpeta (la del proyecto, junto a este script).
    3. Con NeuroRepo arrancado, haz doble clic en Cargar-modelo.bat.

    El modelo se registra en Ollama con el nombre de OLLAMA_MODEL del .env (por defecto qwen2.5:1.5b),
    que es el que usa la app; queda guardado en el volumen de Ollama y no hay que repetirlo.
#>
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$gguf = Get-ChildItem -Path $PSScriptRoot -Filter *.gguf | Select-Object -First 1
if (-not $gguf) {
    $ruta = (Read-Host "No hay ningún .gguf en esta carpeta. Escribe la ruta completa del archivo del modelo").Trim('"')
    if (-not (Test-Path $ruta)) { Write-Host "No encuentro ese archivo." -ForegroundColor Red; exit 1 }
    $gguf = Get-Item $ruta
}

$modelo = "qwen2.5:1.5b"
if (Test-Path ".env") {
    $linea = Select-String -Path ".env" -Pattern '^OLLAMA_MODEL=(.+)$' | Select-Object -First 1
    if ($linea) { $modelo = $linea.Matches[0].Groups[1].Value.Trim().Trim("'").Trim('"') }
}

$contenedor = docker ps -q --filter "label=com.docker.compose.service=ollama" | Select-Object -First 1
if (-not $contenedor) {
    Write-Host "El contenedor de Ollama no está en marcha. Arranca NeuroRepo (Instalar.bat) y vuelve a probar." -ForegroundColor Red
    exit 1
}

Write-Host "Copiando $($gguf.Name) a Ollama (puede tardar un minuto)..." -ForegroundColor Cyan
docker cp $gguf.FullName "${contenedor}:/tmp/modelo.gguf"
if ($LASTEXITCODE -ne 0) { Write-Host "No se pudo copiar el archivo." -ForegroundColor Red; exit 1 }

Write-Host "Registrando el modelo como $modelo..." -ForegroundColor Cyan
docker exec $contenedor sh -c 'echo FROM /tmp/modelo.gguf > /tmp/Modelfile && ollama create $1 -f /tmp/Modelfile; r=$?; rm -f /tmp/modelo.gguf /tmp/Modelfile; exit $r' sh $modelo
if ($LASTEXITCODE -ne 0) { Write-Host "Ollama no pudo registrar el modelo." -ForegroundColor Red; exit 1 }

Write-Host "Listo: el modelo $modelo ya está disponible. La búsqueda avanzada del chat ya puede usar la IA." -ForegroundColor Green
