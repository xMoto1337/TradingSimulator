@echo off
echo Building Trading Simulator for Web/PWA...
call npm run build:web
if %errorlevel% neq 0 (
    echo Build failed!
    pause
    exit /b 1
)
echo.
echo Build complete! Output in dist-web/
echo Deploy dist-web/ to Vercel, Netlify, or any static host.
pause
