@echo off
setlocal
chcp 65001 >nul
"%~dp0node.exe" "%~dp0cli.mjs" capabilities --human
echo.
pause
