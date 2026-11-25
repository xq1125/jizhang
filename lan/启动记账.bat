@echo off
rem JiZhang launcher - start server and open browser
cd /d "%~dp0"
set "PY=C:\Users\zhengkaiyu01\AppData\Local\Programs\Python\Python313\python.exe"
if not exist "%PY%" set "PY=python"
start "JiZhang Server" "%PY%" server.py
timeout /t 2 /nobreak >nul
start "" http://localhost:8765/
