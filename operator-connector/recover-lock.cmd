@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Only recover a lock left by an exited process. No payments will be sent.
"%~dp0node.exe" "%~dp0cli.mjs" recover-lock --human
pause
