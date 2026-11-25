@echo off
rem Backup ledger data to your private GitHub repo
cd /d "%~dp0"
if not exist data\ledger.db (
  echo [!] No ledger data found yet. Open the app and record something first.
  pause
  exit /b 1
)
git add -f data/ledger.db
git commit -m "backup: ledger data"
git push origin main
echo.
echo [OK] Backup finished. You can close this window.
pause
