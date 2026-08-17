' Launches the worker supervisor with no visible console window.
'
' Purpose: keep GPU telemetry online without a terminal sitting open. The dashboard reports
' "offline" whenever this process is not running - ComfyUI being up is not enough, because
' ComfyUI never contacts the cloud; only the worker does.
'
' To run at every login, put a shortcut to this file in:
'   %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
' (install-autostart.cmd does that for you, and needs no administrator rights.)
'
' The supervisor restarts the worker if it ever crashes, so this only has to launch once.

Dim shell, fso, here
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = here

' 0 = hidden window, False = don't block waiting for it to finish.
shell.Run "node " & Chr(34) & fso.BuildPath(here, "worker\supervisor.mjs") & Chr(34), 0, False
