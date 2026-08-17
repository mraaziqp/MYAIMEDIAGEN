@echo off
title Local AI Media Gateway - Worker
color 0B
cd /d "%~dp0"

echo ========================================================
echo   LOCAL AI MEDIA GATEWAY - WORKER
echo   Polls the cloud dashboard for jobs and drives ComfyUI
echo ========================================================
echo.

if not exist ".env" (
  echo [setup] No .env file found - copy .env.example to .env and fill in:
  echo [setup]   CLOUD_API_URL, WORKER_TOKEN, COMFYUI_URL, BLOB_READ_WRITE_TOKEN
  echo [setup] See the "Cloud deployment" section in README.md.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [setup] First run detected - installing dependencies, this can take a minute...
  call npm install
  echo.
)

curl -s -o nul --max-time 2 http://127.0.0.1:8188/system_stats
if errorlevel 1 (
  echo.
  echo   NOTE: ComfyUI does not appear to be running at http://127.0.0.1:8188
  echo   Start ComfyUI first - the worker will still run and report VRAM/RAM
  echo   telemetry, but generation jobs will fail their pre-flight check until
  echo   ComfyUI is up.
  echo.
)

echo Starting worker under its supervisor - it will restart itself if it ever
echo crashes, so telemetry stays online. Leave this window open.
echo To stop, close this window or press Ctrl+C.
echo.
node worker/supervisor.mjs

pause
