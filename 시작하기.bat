@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo WoW Forever 캘린더를 시작합니다. 이 창을 닫으면 종료됩니다.
start "" http://localhost:3000
node server.js
pause
