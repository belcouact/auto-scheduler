@echo off
chcp 65001 >nul
title Auto-Scheduler Starter

echo ========================================
echo    Auto-Scheduler
echo ========================================
echo.
echo Starting Backend Server...

start "Auto-Scheduler Backend" cmd /k "cd /d "%~dp0server" && npm run dev"

timeout /t 3 /nobreak >nul

echo Starting Frontend...

start "Auto-Scheduler Frontend" cmd /k "cd /d "%~dp0client" && npm run dev"

echo.
echo ========================================
echo    Both services are starting...
echo    Backend: http://localhost:3001
echo    Frontend: http://localhost:5173
echo ========================================
echo.
echo Press any key to exit this window...
pause >nul
