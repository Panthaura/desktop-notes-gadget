@echo off
cd /d "%~dp0"
set "PATH=%PATH%;C:\Program Files\nodejs\"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js wurde nicht gefunden. Bitte Node.js LTS installieren.
  pause
  exit /b 1
)
if not exist "node_modules\" (
  echo Installiere Abhaengigkeiten...
  call npm install
)
echo Starte Desktop Notes...
call npm run dev
