@echo off
title SenseiAI Server — Running
color 0A

echo.
echo  =============================================
echo    SenseiAI Server
echo    Endpoint : http://localhost:11434/v1
echo    Model    : senseiAI  (Llama 3.1 8B Q6_K)
echo    GPU      : RTX 5060 8GB  (CUDA auto)
echo  =============================================
echo.
echo  Keep this window open while using Andy.
echo  Press Ctrl+C to stop the server.
echo.

:: Check model exists before starting
ollama list | findstr /i "senseiAI" >nul 2>&1
if %errorlevel% neq 0 (
    echo  [!] SenseiAI model not found. Run download.bat first.
    echo.
    pause
    exit /b 1
)

ollama serve
