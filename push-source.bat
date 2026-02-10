@echo off
title Push Source Code to GitHub
cd /d "%~dp0"

echo ========================================
echo   Push Full Source to GitHub
echo ========================================
echo.
echo This adds ALL source code to your existing repo.
echo Your .exe files and latest.json stay untouched.
echo Auto-updater will NOT break.
echo.

set /p CONFIRM="Continue? (y/n): "
if /i not "%CONFIRM%"=="y" (
    echo Cancelled.
    pause
    exit /b 0
)

echo.
echo Adding all source files...

:: Stage everything (gitignore handles exclusions)
git add -A

echo.
echo Files staged. Showing what will be committed:
echo.
git status --short

echo.
set /p CONFIRM2="Push these files? (y/n): "
if /i not "%CONFIRM2%"=="y" (
    echo.
    echo Aborted. Run 'git reset' to unstage.
    pause
    exit /b 0
)

echo.
echo Committing...
git commit -m "Add full source code for web/PWA build"

echo.
echo Pushing to GitHub...
git push origin main

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Push failed! Try manually:
    echo   git push origin main
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Source pushed successfully!
echo.
echo   Next steps:
echo   1. Go to vercel.com
echo   2. Sign in with GitHub
echo   3. Import your TradingSimulator repo
echo   4. It auto-detects vercel.json and deploys
echo   5. Open the URL on your iPhone Safari
echo   6. Share ^> Add to Home Screen
echo ========================================
echo.
pause
