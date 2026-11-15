@echo off
chcp 65001 >nul
cd /d "%~dp0"
set /p DNI=DNI del administrador:
docker compose -f docker-compose.yml -f docker-compose.local.yml exec app node src/resetAdmin.js "%DNI%"
pause
