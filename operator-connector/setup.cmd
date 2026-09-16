@echo off
setlocal
chcp 65001 >nul
"%~dp0node.exe" "%~dp0setup.mjs"
echo.
pause
