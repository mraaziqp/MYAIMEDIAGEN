@echo off
title Local AI Media Gateway - One Click Launcher
color 0A
cd /d "%~dp0"

echo ========================================================
echo   LOCAL AI MEDIA GATEWAY - RTX 3060 Ti and COMFYUI
echo ========================================================
echo.

set FIRST_RUN=0

if not exist ".env" (
  echo [setup] No .env file found - creating one from .env.example.
  echo [setup] Edit .env and set your own GATEWAY_AUTH_TOKEN / ENCRYPTION_SECRET before
  echo [setup] tunneling this publicly - the sample values are not secret.
  copy /y ".env.example" ".env" >nul
  echo.
)

if not exist "node_modules" (
  echo [setup] First run detected - installing dependencies, this can take a minute...
  call npm install
  set FIRST_RUN=1
  echo.
)

echo [1/3] Freeing port 3000 if a previous gateway is still running...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%P >nul 2>&1
)
REM Force-killing the old gateway above doesn't stop its child cloudflared process on
REM Windows, so it would otherwise leak one more stray tunnel process every restart.
taskkill /F /IM cloudflared.exe >nul 2>&1

echo [2/3] Launching Local AI Gateway, Dashboard, and public tunnel...
start "AI Gateway Server" /min cmd /c "npx tsx server.ts"

echo [3/3] Waiting for the gateway to come up...
if "%FIRST_RUN%"=="1" (
  timeout /t 8 /nobreak >nul
) else (
  timeout /t 4 /nobreak >nul
)

echo Opening Dashboard in your browser...
start http://localhost:3000

curl -s -o nul --max-time 2 http://127.0.0.1:8188/system_stats
if errorlevel 1 (
  echo.
  echo   NOTE: ComfyUI does not appear to be running at http://127.0.0.1:8188
  echo   Start ComfyUI on this PC, then click "Ping Stats" in the dashboard.
)

echo.
echo ========================================================
echo   SYSTEM READY
echo ========================================================
echo   - Local Dashboard: http://localhost:3000
echo   - Public link:     check the dashboard header - it takes a few seconds
echo                       to connect after the page loads, and changes each
echo                       time you restart (no fixed domain needed).
echo.
echo   * To stop everything, double-click stop.bat
echo ========================================================
echo.
pause
