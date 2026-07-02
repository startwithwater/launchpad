@echo off
setlocal
set "PORT=7777"
title Launchpad

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not in PATH. Install Node.js and try again.
  pause
  exit /b 1
)

rem Already running? Just open the dashboard.
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul
if not errorlevel 1 (
  start "" "http://localhost:%PORT%/"
  exit /b 0
)

rem Start the control server minimized, then open the dashboard once it's up.
rem (/d sets the working directory, so the path with spaces needs no nested quotes)
start "Launchpad Server" /min /d "%~dp0" cmd /c "node server.js & pause"

set /a tries=0
:wait
ping 127.0.0.1 -n 2 >nul
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul
if not errorlevel 1 goto open
set /a tries+=1
if %tries% LSS 20 goto wait
echo Launchpad server did not start. Check the "Launchpad Server" window for errors.
pause
exit /b 1

:open
start "" "http://localhost:%PORT%/"
exit /b 0
