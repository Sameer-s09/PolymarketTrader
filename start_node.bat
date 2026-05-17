@echo off
title VibeTrader - Node Stack

:: Kill anything already on port 3001 (backend) or 5173 (frontend)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3001 " ^| findstr LISTENING') do (
    echo Killing PID %%p on port 3001
    taskkill /PID %%p /F >nul 2>&1
)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5173 " ^| findstr LISTENING') do (
    echo Killing PID %%p on port 5173
    taskkill /PID %%p /F >nul 2>&1
)

:: Small pause to let sockets release
timeout /t 2 /nobreak >nul

cd /d "E:\Projects\vibecoding\ClaudeCowork\VibeTraderTerminal\candle-app"
npm run dev
