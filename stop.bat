@echo off
title Stop Local AI Gateway
color 0C

echo ========================================================
echo   STOPPING LOCAL AI MEDIA GATEWAY
echo ========================================================
echo.

taskkill /FI "WINDOWTITLE eq AI Gateway Server*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Cloudflare Tunnel*" /F >nul 2>&1
taskkill /IM cloudflared.exe /F >nul 2>&1

echo Done! All gateway processes stopped.
timeout /t 2 >nul
