@echo off
setlocal
title Local AI Media Gateway - install worker autostart

rem Adds (or removes) a Startup-folder shortcut so the worker supervisor launches at every
rem login and GPU telemetry is never offline just because nobody remembered to start it.
rem
rem Uses the per-user Startup folder deliberately: a Scheduled Task would need administrator
rem rights, and this needs none.

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LINK=%STARTUP%\Local AI Media Gateway Worker.lnk"
set "TARGET=%~dp0start-worker-hidden.vbs"

if /I "%~1"=="uninstall" (
  if exist "%LINK%" (
    del "%LINK%"
    echo [ok] Removed autostart entry.
  ) else (
    echo [ok] No autostart entry was installed.
  )
  goto :done
)

if not exist "%TARGET%" (
  echo [error] Cannot find "%TARGET%".
  goto :done
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%LINK%');" ^
  "$s.TargetPath='%TARGET%';" ^
  "$s.WorkingDirectory='%~dp0';" ^
  "$s.Description='Keeps the Local AI Media Gateway worker running';" ^
  "$s.Save()"

if exist "%LINK%" (
  echo [ok] Autostart installed - the worker will start automatically at every login.
  echo      Shortcut: "%LINK%"
  echo.
  echo      To undo:  install-autostart.cmd uninstall
) else (
  echo [error] Failed to create the shortcut.
)

:done
echo.
pause
