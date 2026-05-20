@echo off
echo Stopping SenseiAI server...
taskkill /F /IM ollama.exe /T >nul 2>&1
if %errorlevel% equ 0 (
    echo Done.
) else (
    echo SenseiAI was not running.
)
timeout /t 2 >nul
