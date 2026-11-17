@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Desinstalar la version anterior (NeuroRepo / DocuPaz)
rem ============================================================================================
rem  Desinstala la version anterior de DocuPaz (antes llamada NeuroRepo) instalada SIN Docker:
rem  tareas programadas, servicio de MongoDB, regla del firewall y carpeta de instalacion.
rem  Opcional: contenedores de la version con Docker. Tus documentos NUNCA se tocan (estan en su
rem  propia carpeta o unidad de red, fuera de la instalacion).
rem ============================================================================================

rem --- Administrador: si no lo es, se vuelve a abrir pidiendo permiso ---
net session >nul 2>&1
if errorlevel 1 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo.
echo   ==================================================================
echo     DESINSTALAR LA VERSION ANTERIOR  (NeuroRepo / DocuPaz)
echo   ==================================================================
echo.

rem --- Carpeta de instalacion ---
set "DEST="
if exist "C:\NeuroRepo\app" set "DEST=C:\NeuroRepo"
if not defined DEST if exist "C:\DocuPaz\app" set "DEST=C:\DocuPaz"
if not defined DEST set "DEST=C:\NeuroRepo"
set /p "RESP=  Carpeta de instalacion [%DEST%]: "
if defined RESP set "DEST=%RESP%"
set "RESP="

rem --- Que hay instalado ---
echo.
echo   Encontrado:
set "ALGO=0"
for %%T in ("NeuroRepo - App" "NeuroRepo - IA" "NeuroRepoInstalador" "DocuPaz - App" "DocuPaz - IA") do (
    schtasks /Query /TN %%T >nul 2>&1 && (echo     - tarea programada  %%~T& set "ALGO=1")
)
for %%S in (NeuroRepoMongo DocuPazMongo) do (
    sc query %%S >nul 2>&1 && (echo     - servicio          %%S& set "ALGO=1")
)
for %%R in ("NeuroRepo" "DocuPaz") do (
    netsh advfirewall firewall show rule name=%%R >nul 2>&1 && (echo     - regla firewall    %%~R& set "ALGO=1")
)
if exist "%DEST%" (echo     - carpeta           %DEST%& set "ALGO=1")
set "DOCKER=0"
where docker >nul 2>&1 && (
    for /f %%C in ('docker ps -aq --filter "label=com.docker.compose.project=neurorepo" 2^>nul') do set "DOCKER=1"
)
if "%DOCKER%"=="1" (echo     - contenedores Docker del proyecto neurorepo& set "ALGO=1")

if "%ALGO%"=="0" (
    echo     nada: no hay ninguna version anterior instalada.
    echo.
    pause
    exit /b 0
)

echo.
set /p "RESP=  Desinstalar todo lo anterior? (s/N): "
if /i not "%RESP%"=="s" (
    echo   Cancelado. No se ha tocado nada.
    pause
    exit /b 0
)

set "BORRARDATOS=n"
if exist "%DEST%\datos" (
    echo.
    echo   La carpeta "%DEST%\datos" tiene la base de datos ^(usuarios, grupos, favoritos, indice^)
    echo   y el modelo de IA. Si la conservas, puedes borrarla mas adelante a mano.
    set /p "BORRARDATOS=  Borrar tambien los datos? (s/N): "
)

set "BORRARDOCKER=n"
if "%DOCKER%"=="1" set /p "BORRARDOCKER=  Quitar tambien los contenedores de Docker? (s/N; sus datos se conservan): "

echo.
echo   [1/5] Parando y quitando las tareas programadas...
for %%T in ("NeuroRepo - App" "NeuroRepo - IA" "NeuroRepoInstalador" "DocuPaz - App" "DocuPaz - IA") do (
    schtasks /Query /TN %%T >nul 2>&1 && (
        schtasks /End /TN %%T >nul 2>&1
        schtasks /Delete /TN %%T /F >nul 2>&1 && echo         quitada: %%~T
    )
)

echo   [2/5] Cerrando la app y la IA...
powershell -NoProfile -Command "Get-Process node, ollama, 'ollama app' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith('%DEST%', [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force"

echo   [3/5] Parando y quitando el servicio de MongoDB...
for %%S in (NeuroRepoMongo DocuPazMongo) do (
    sc query %%S >nul 2>&1 && (
        net stop %%S >nul 2>&1
        sc delete %%S >nul 2>&1 && echo         quitado: %%S
    )
)

echo   [4/5] Quitando la regla del firewall...
for %%R in ("NeuroRepo" "DocuPaz") do (
    netsh advfirewall firewall delete rule name=%%R >nul 2>&1 && echo         quitada: %%~R
)

if /i "%BORRARDOCKER%"=="s" (
    echo         Quitando los contenedores de Docker...
    for /f %%C in ('docker ps -aq --filter "label=com.docker.compose.project=neurorepo" 2^>nul') do docker rm -f %%C >nul 2>&1
)

echo   [5/5] Borrando la carpeta de instalacion...
rem Unos segundos para que Windows suelte los archivos de los procesos recien cerrados
timeout /t 3 /nobreak >nul
if exist "%DEST%" (
    if /i "%BORRARDATOS%"=="s" (
        rmdir /s /q "%DEST%"
    ) else (
        for /d %%D in ("%DEST%\*") do if /i not "%%~nxD"=="datos" rmdir /s /q "%%D"
        for %%F in ("%DEST%\*") do del /f /q "%%F"
        echo         conservada: %DEST%\datos
    )
)
if exist "%DEST%" if /i "%BORRARDATOS%"=="s" (
    echo   AVISO: no se pudo borrar del todo "%DEST%" ^(algun archivo en uso^). Reinicia y borrala a mano.
)

echo.
echo   ==================================================================
echo     Listo: version anterior desinstalada. Tus documentos no se han tocado.
echo   ==================================================================
echo.
pause
