@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set "installResult=%ERRORLEVEL%"
if not "%installResult%"=="0" echo Installation failed. Check that Python 3.10 or later is installed and python.exe is available.
pause
exit /b %installResult%
