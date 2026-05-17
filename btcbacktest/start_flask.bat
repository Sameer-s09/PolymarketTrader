@echo off
title VibeTrader - Flask Detector

:: Kill anything already on port 5050
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5050 " ^| findstr LISTENING') do (
    echo Killing PID %%p on port 5050
    taskkill /PID %%p /F >nul 2>&1
)
timeout /t 2 /nobreak >nul

cd /d "E:\Projects\vibecoding\claude\btcbacktest"
"C:\Users\Admin\AppData\Local\Programs\Python\Python311\python.exe" live_app.py
