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

echo [1/4] Freeing port 3000 if a previous gateway is still running...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%P >nul 2>&1
)

echo [2/4] Launching Local AI Gateway and Dashboard...
start "AI Gateway Server" /min cmd /c "npx tsx server.ts"

echo [3/4] Connecting Cloudflare Public Tunnel (nexus)...
start "Cloudflare Tunnel" /min cmd /c "cloudflared tunnel run --url http://127.0.0.1:3000 nexus"

echo [4/4] Waiting for the gateway to come up...
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
echo   - Local Dashboard:        http://localhost:3000
echo   - Public Tunnel Endpoint: https://api.dialabraai.co.za/api/ai-studio/function-call
echo.
echo   * To stop everything, double-click stop.bat
echo ========================================================
echo.
pause
