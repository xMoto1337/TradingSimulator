@echo off
title Trading Simulator - Build and Release
cd /d "%~dp0"

echo ========================================
echo   Trading Simulator - Build and Release
echo ========================================
echo.

:: Get version from tauri.conf.json
for /f "tokens=2 delims=:, " %%a in ('findstr /C:"\"version\"" src-tauri\tauri.conf.json') do set VERSION=%%~a
set VERSION=%VERSION:"=%

echo Current version: v%VERSION%
echo.

:: Check for signing key
if not exist "src-tauri\keys\private.key" (
    echo ERROR: Signing key not found!
    echo Run generate-keys.bat first.
    pause
    exit /b 1
)

:: Set signing key environment variable
set /p TAURI_SIGNING_PRIVATE_KEY=<"src-tauri\keys\private.key"

echo Building release...
echo This may take a few minutes...
echo.

call npm run tauri build

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Build failed!
    pause
    exit /b 1
)

:: Check if build succeeded
set NSIS_FILE=src-tauri\target\release\bundle\nsis\Trading Simulator_%VERSION%_x64-setup.exe
set NSIS_SIG=%NSIS_FILE%.sig

if not exist "%NSIS_FILE%" (
    echo ERROR: Build output not found!
    echo Looking for: %NSIS_FILE%
    pause
    exit /b 1
)

if not exist "%NSIS_SIG%" (
    echo ERROR: Signature file not found!
    pause
    exit /b 1
)

echo.
echo Build complete!
echo.

:: Read signature
set /p SIGNATURE=<"%NSIS_SIG%"

:: Copy installer to repo root
echo Copying installer to repo...
copy /Y "%NSIS_FILE%" "Trading Simulator_%VERSION%_x64-setup.exe"

:: Read changelog from CHANGELOG.md
set CHANGELOG=Release v%VERSION%
if exist CHANGELOG.md (
    echo Reading CHANGELOG.md for release notes...
    for /f "usebackq delims=" %%c in (`powershell -NoProfile -Command "[System.IO.File]::ReadAllText('CHANGELOG.md') -replace '\\\\', '\\\\\\\\' -replace '\"', '\\\"' -replace \"\`r\`n\", '\\n' -replace \"\`n\", '\\n'"`) do set CHANGELOG=%%c
) else (
    echo No CHANGELOG.md found, using default notes.
    echo Create a CHANGELOG.md file before releasing to include release notes.
)

:: Create latest.json
echo Creating latest.json...
(
echo {
echo   "version": "%VERSION%",
echo   "notes": "%CHANGELOG%",
echo   "pub_date": "%DATE:~10,4%-%DATE:~4,2%-%DATE:~7,2%T00:00:00Z",
echo   "platforms": {
echo     "windows-x86_64": {
echo       "signature": "%SIGNATURE%",
echo       "url": "https://github.com/xMoto1337/TradingSimulator/raw/main/Trading%%20Simulator_%VERSION%_x64-setup.exe"
echo     }
echo   }
echo }
) > latest.json

echo.
echo Created latest.json:
type latest.json
echo.

:: Confirm push
set /p CONFIRM="Push to GitHub? (y/n): "
if /i not "%CONFIRM%"=="y" (
    echo.
    echo Files created but not pushed.
    echo Manually commit: latest.json and Trading Simulator_%VERSION%_x64-setup.exe
    pause
    exit /b 0
)

:: Git add, commit, push
echo.
echo Pushing to GitHub...
git add latest.json "Trading Simulator_%VERSION%_x64-setup.exe"
git commit -m "Release v%VERSION%"
git push origin main

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Push failed! Try manually:
    echo   git add latest.json Trading Simulator_%VERSION%_x64-setup.exe
    echo   git commit -m "Release v%VERSION%"
    echo   git push origin main
    pause
    exit /b 1
)

echo.
echo ========================================
echo Release v%VERSION% complete!
echo.
echo Users will now see the update available.
echo ========================================
echo.
pause
