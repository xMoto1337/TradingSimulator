@echo off
title Trading Simulator - Frontend Dev
cd /d "%~dp0"

echo ========================================
echo   Trading Simulator - Frontend Only (Browser)
echo ========================================
echo.
echo Starting Vite dev server...
echo Open http://localhost:1420 in your browser
echo.

npm run dev
