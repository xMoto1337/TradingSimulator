@echo off
title Trading Simulator
cd /d "%~dp0"

echo ========================================
echo   Trading Simulator
echo ========================================
echo.
echo Starting application...
echo (First run will compile Rust - this takes a few minutes)
echo.

npm run tauri dev

pause
