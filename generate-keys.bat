@echo off
title Trading Simulator - Generate Update Keys
cd /d "%~dp0"

echo ========================================
echo   Trading Simulator - Generate Signing Keys
echo ========================================
echo.
echo This will generate a keypair for signing updates.
echo The PRIVATE key goes in your environment/CI secrets.
echo The PUBLIC key goes in tauri.conf.json.
echo.
echo Press any key to generate keys...
pause >nul

npx tauri signer generate -w src-tauri/keys/private.key

echo.
echo ========================================
echo Keys generated!
echo.
echo 1. Copy the PUBLIC KEY and paste it in:
echo    src-tauri/tauri.conf.json -> plugins.updater.pubkey
echo.
echo 2. Keep the private key safe at:
echo    src-tauri/keys/private.key
echo.
echo 3. Add this to your GitHub repo secrets:
echo    TAURI_SIGNING_PRIVATE_KEY = (contents of private.key)
echo    TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (your password)
echo ========================================
echo.
pause
