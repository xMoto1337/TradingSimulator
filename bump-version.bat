@echo off
title Trading Simulator - Bump Version
cd /d "%~dp0"

echo ========================================
echo   Trading Simulator - Bump Version
echo ========================================
echo.

:: Get current version from tauri.conf.json
for /f "tokens=2 delims=:, " %%a in ('findstr /C:"\"version\"" src-tauri\tauri.conf.json') do set CURRENT=%%~a
set CURRENT=%CURRENT:"=%

echo Current version: %CURRENT%
echo.
set /p NEW_VERSION="Enter new version (e.g., 0.2.0): "

if "%NEW_VERSION%"=="" (
    echo Cancelled.
    pause
    exit /b 0
)

echo.
echo Updating version to %NEW_VERSION%...

:: Update tauri.conf.json
powershell -Command "(Get-Content 'src-tauri\tauri.conf.json') -replace '\"version\": \"%CURRENT%\"', '\"version\": \"%NEW_VERSION%\"' | Set-Content 'src-tauri\tauri.conf.json'"

:: Update Cargo.toml
powershell -Command "(Get-Content 'src-tauri\Cargo.toml') -replace 'version = \"%CURRENT%\"', 'version = \"%NEW_VERSION%\"' | Set-Content 'src-tauri\Cargo.toml'"

:: Update package.json
powershell -Command "(Get-Content 'package.json') -replace '\"version\": \"%CURRENT%\"', '\"version\": \"%NEW_VERSION%\"' | Set-Content 'package.json'"

echo.
echo Version bumped to %NEW_VERSION%!
echo.
echo Updated files:
echo   - src-tauri/tauri.conf.json
echo   - src-tauri/Cargo.toml
echo   - package.json
echo.
echo Next step:
echo   Run release.bat to build and push the new version
echo.
pause
