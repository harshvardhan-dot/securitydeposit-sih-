@echo off
echo Starting AICTE Security Deposit & FDR Management Portal...
echo.

REM Start backend FastAPI server in a new window
start "AICTE Backend (Port 8000)" cmd /k "cd backend && python run.py --port 8000"

REM Start frontend Vite dev server in a new window
start "AICTE Frontend (Port 5173)" cmd /k "cd frontend && npm.cmd run dev"

echo Backend started on:  http://127.0.0.1:8000
echo Frontend started on: http://localhost:5173
echo.
