@echo off
title Local AI Media Gateway - One Click Launcher
color 0A

echo ========================================================
echo   LOCAL AI MEDIA GATEWAY - RTX 3060 Ti & COMFYUI
echo ========================================================
echo.
echo [1/3] Launching Local AI Gateway & Dashboard...
start "AI Gateway Server" /min cmd /c "npx tsx server.ts"

echo [2/3] Connecting Cloudflare Public Tunnel...
start "Cloudflare Tunnel" /min cmd /c "cloudflared tunnel run --url http://127.0.0.1:3000 nexus"

echo [3/3] Opening Dashboard in your browser...
timeout /t 3 /nobreak >nul
start http://localhost:3000

echo.
echo ========================================================
echo   SYSTEM READY AND ACTIVE!
echo ========================================================
echo   - Local Dashboard:      http://localhost:3000
echo   - Public Tunnel Endpoint: https://api.dialabraai.co.za/api/ai-studio/function-call
echo.
echo   * Make sure ComfyUI (run_nvidia_gpu.bat) is running on your PC.
echo   * To stop everything, double-click stop.bat
echo ========================================================
echo.
pause
