@echo off
setlocal
cd /d "%~dp0"
title Baron Sellauth Site Cloner

where node >nul 2>&1
if errorlevel 1 (
  echo [HATA] Node.js bulunamadi.
  echo Node.js 20 veya daha yeni bir surum kurup tekrar deneyin.
  echo https://nodejs.org/
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [HATA] npm bulunamadi. Node.js kurulumu eksik olabilir.
  pause
  exit /b 1
)

if not exist "node_modules\puppeteer\package.json" (
  echo [Baron] Gerekli paketler kuruluyor...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [HATA] Paket kurulumu basarisiz oldu.
    pause
    exit /b 1
  )
)

echo.
echo === Baron Sellauth Site Cloner ===
echo.

if "%~1"=="" (
  node src\index.js
) else (
  node src\index.js %*
)

if errorlevel 1 (
  echo.
  echo [HATA] Baron Sellauth Site Cloner calisirken hata olustu.
  pause
  exit /b 1
)

echo.
echo [Baron] Islem tamamlandi.
pause
