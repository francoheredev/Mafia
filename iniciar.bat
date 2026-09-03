@echo off
setlocal enabledelayedexpansion
cd /d %~dp0

echo ============================================
echo   La Mafia - Iniciando el proyecto
echo ============================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [!] No se encontro Node.js instalado.
  echo     Te abro la pagina de descarga - instalalo y despues
  echo     volve a ejecutar iniciar.bat de nuevo.
  start https://nodejs.org/
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias por primera vez, un momento...
  call npm install
  if !errorlevel! neq 0 (
    echo.
    echo [!] Algo fallo instalando dependencias. Copiame este mensaje
    echo     junto con lo que veas arriba en rojo.
    pause
    exit /b 1
  )
)

echo.
echo Iniciando el servidor en una ventana nueva...
start "La Mafia - Servidor - NO CERRAR" cmd /k "npm start"

echo Esperando a que arranque...
timeout /t 3 /nobreak >nul

start "" "http://localhost:3000/screen.html"

echo.
echo ============================================
echo Listo! Se abrio la pantalla compartida en tu navegador.
echo Para conectar tu celular: misma WiFi que esta compu,
echo y escaneas el QR que aparece en pantalla.
echo.
echo Para cerrar todo: cerra la ventana La Mafia - Servidor.
echo ============================================
pause
