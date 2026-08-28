@echo off
chcp 65001 >nul
echo 正在啟動 OpenModel Selector (AI 開放模型選擇決策與硬體搭配矩陣)...
cd /d "%~dp0"
python serve.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Python 伺服器啟動遇到問題，改為直接在預設瀏覽器開啟 index.html...
    start "" index.html
)
pause
