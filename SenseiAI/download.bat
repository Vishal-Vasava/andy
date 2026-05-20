@echo off
setlocal enabledelayedexpansion
title SenseiAI Setup
color 0A

echo.
echo  =============================================
echo    SenseiAI Setup — Llama 3.1 8B Q6_K
echo    Optimised for ASUS ROG / RTX 5060 8GB
echo  =============================================
echo.

:: ── Step 0: Check Ollama ─────────────────────────────────────────────────────
where ollama >nul 2>&1
if %errorlevel% neq 0 (
    echo  [!] Ollama is not installed.
    echo.
    echo  Ollama manages the local model and provides the OpenAI-compatible
    echo  API that Andy connects to. Please install it first:
    echo.
    echo      https://ollama.com/download/windows
    echo.
    echo  After installing, close this window and run download.bat again.
    echo.
    start "" "https://ollama.com/download/windows"
    pause
    exit /b 1
)
echo  [OK] Ollama detected.
echo.

:: ── Step 1: Pull base model ───────────────────────────────────────────────────
echo  [1/2] Downloading Llama 3.1 8B Q6_K  (~6.1 GB)
echo        This may take 10-30 min depending on your connection speed.
echo        Do not close this window.
echo.

ollama pull llama3.1:8b-instruct-q6_K
if %errorlevel% neq 0 (
    echo.
    echo  [!] Q6_K tag not found in Ollama library.
    echo      Trying default llama3.1:8b  (Q4_K_M, ~4.7 GB — also excellent)...
    echo.
    ollama pull llama3.1:8b
    if %errorlevel% neq 0 (
        echo.
        echo  [!] Download failed. Check your internet connection and try again.
        pause
        exit /b 1
    )
    :: Update Modelfile to use the default tag
    powershell -Command "(Get-Content '%~dp0Modelfile') -replace 'llama3.1:8b-instruct-q6_K','llama3.1:8b' | Set-Content '%~dp0Modelfile'"
    echo  [OK] Downloaded llama3.1:8b (Q4_K_M).
) else (
    echo  [OK] Downloaded llama3.1:8b-instruct-q6_K (Q6_K).
)
echo.

:: ── Step 2: Create SenseiAI model ────────────────────────────────────────────
echo  [2/2] Building SenseiAI model from Modelfile...
ollama create senseiAI -f "%~dp0Modelfile"
if %errorlevel% neq 0 (
    echo.
    echo  [!] Failed to create SenseiAI model.
    pause
    exit /b 1
)
echo.

:: ── Done ─────────────────────────────────────────────────────────────────────
echo  =============================================
echo    Setup Complete!
echo  =============================================
echo.
echo  Next steps:
echo.
echo    1. Run start.bat  (keeps this folder as the launch point)
echo    2. Open Andy in your browser
echo    3. Go to Settings and click "Use SenseiAI (Local)"
echo       OR enter manually:
echo         Endpoint URL : http://localhost:11434/v1
echo         Model Name   : senseiAI
echo.
pause
