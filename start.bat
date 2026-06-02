@echo off
chcp 65001 >nul
title Auto-Scheduler

echo ========================================
echo    Auto-Scheduler
echo ========================================
echo.
echo Starting Backend and Frontend...
echo    Backend: http://localhost:3001
echo    Frontend: http://localhost:5173
echo.
echo Press Ctrl+C to stop all services...
echo.

cd /d "%~dp0"
start "" npm run dev
timeout /t 5 /nobreak >nul
start "" http://localhost:5173
