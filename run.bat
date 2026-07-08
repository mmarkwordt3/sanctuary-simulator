@echo off
REM ---------------------------------------------------------------------------
REM Sanctuary launcher for Windows.
REM Installs dependencies if needed, then starts the Vite development server.
REM ---------------------------------------------------------------------------

setlocal

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required but was not found on your PATH.
  echo Please install Node.js 18 or newer from https://nodejs.org/ and try again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies. This may take a minute...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo Starting the Sanctuary development server...
echo Open the printed http://localhost URL in your browser. Press Ctrl+C to stop.
call npm run dev

endlocal
