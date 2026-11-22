@echo off
setlocal
cd /d "%~dp0.."

echo [ios] exporting bundle %DATE% %TIME%
call npx expo export --platform ios --output-dir dist-ios
if errorlevel 1 goto :fail

set "PY=..\tooling\gui\venv312\Scripts\python.exe"
if not exist "%PY%" set "PY=python"

echo [ios] repacking IPA with %PY% %DATE% %TIME%
"%PY%" scripts\build_ios_local.py
if errorlevel 1 goto :fail

echo [ios] done %DATE% %TIME%
exit /b 0

:fail
echo [ios] FAILED %DATE% %TIME%
exit /b 1
