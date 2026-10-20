@echo off
title Job Evidence Workbench
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-workbench.ps1" %*
set "workbenchExit=%ERRORLEVEL%"
if not "%workbenchExit%"=="0" pause
endlocal & exit /b %workbenchExit%
