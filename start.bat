@echo off
cd /d "%~dp0"

:: Start Python server silently in background
start /min "Andy Server" python server.py

:: Wait for server to be ready
timeout /t 3 /nobreak >nul

:: Open Andy as a standalone PWA-style window in Chrome
:: Try common Chrome install locations
set CHROME=""
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set CHROME="%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set CHROME="%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set CHROME="%LocalAppData%\Google\Chrome\Application\chrome.exe"

if not %CHROME%=="" (
    start "" %CHROME% --app=http://localhost:3000
) else (
    :: Chrome not found — open in default browser
    start http://localhost:3000
)
