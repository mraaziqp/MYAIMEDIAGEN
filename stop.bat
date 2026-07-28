@echo off
title Stop Local AI Gateway
color 0C

echo ========================================================
echo   STOPPING LOCAL AI MEDIA GATEWAY
echo ========================================================
echo.

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%P >nul 2>&1
)
taskkill /IM cloudflared.exe /F >nul 2>&1

echo Done! All gateway processes stopped.
timeout /t 2 >nul
