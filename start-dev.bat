@echo off
chcp 65001 > nul
title ECT ERP - development start

echo.
echo ========================================
echo   ECT ERP - Fleet Dispatch Management System
echo   development start (backend + web console)
echo ========================================
echo.

:: the backend needs its environment file (database / Supabase / JWT settings)
if not exist "backend\.env" (
    echo [!] backend\.env not found - creating it from backend\.env.example ...
    copy "backend\.env.example" "backend\.env" > nul
    echo [!] Edit backend\.env with your database and Supabase settings, then run this script again.
    pause
    exit /b
)

echo [1/4] Installing backend dependencies...
cd backend
call npm install --silent
cd ..

echo [2/4] Installing web console dependencies...
cd frontend
call npm install --silent
cd ..

echo [3/4] Starting the backend (port 3000)...
start "ECT ERP backend (NestJS)" cmd /k "cd /d %~dp0backend && npm run start:dev"

timeout /t 3 > nul

echo [4/4] Starting the web console (port 5173)...
start "ECT ERP web console (Vite)" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo ========================================
echo   Started.
echo   Web console : http://localhost:5173
echo   Backend API : http://localhost:3000
echo   API docs    : http://localhost:3000/api/docs
echo.
echo   Sign in with the administrator account (see docs/DEPLOY.md)
echo   and change the default administrator password on the first login.
echo ========================================
echo.
pause
