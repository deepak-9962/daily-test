@echo off
echo =========================================
echo       Starting Daily Poll Server...
echo =========================================
start /B npm start

echo Waiting a few seconds for the server to wake up...
timeout /t 3 /nobreak >nul

echo Opening your Admin Panel...
start http://localhost:3000/admin.html

echo =========================================
echo Generating a public link for the other person...
echo (Look for the "your url is: https://..." below and copy it!)
echo =========================================
npx --yes localtunnel --port 3000
pause
