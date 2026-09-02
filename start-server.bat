@echo off
REM Starts the Onboarding Control Tower server (API + form-response auto-import).
REM Used by Windows Task Scheduler to launch the app on boot / log on.
REM See the "Keeping it running" section in Readme.md.

cd /d "%~dp0"

:run
node server\index.js
echo Server exited with code %errorlevel% at %date% %time%. Restarting in 10s...
timeout /t 10 /nobreak >nul
goto run
