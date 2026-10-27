@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required. Install it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
if not exist "server\.env" copy "server\.env.example" "server\.env" >nul
if not exist "node_modules" (
  echo Installing packages for GhostHint. This needs an internet connection the first time.
  call npm install
  if errorlevel 1 goto failed
)
call npm run dev
if errorlevel 1 goto failed
goto end
:failed
echo.
echo GhostHint stopped because a command failed. Read the error above.
:end
pause
