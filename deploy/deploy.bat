@echo off
REM ============================================================
REM  Varuna CM - elle deploy (runner kurulana kadar).
REM  Yonetici yetkili CMD'den calistirin.
REM  Sira deploy.yml ile ayni: servisi ONCE durdur (vec0.dll kilidi),
REM  sonra guncelle/build, sonra baslat + saglik kontrolu.
REM ============================================================
setlocal
set APPDIR=C:\apps\VarunaCaseManagement
set SVC=VarunaCM
cd /d %APPDIR%

echo === [1/6] Servis durduruluyor (%SVC%) ===
nssm stop %SVC%

echo === [2/6] Kod guncelleniyor (origin/main) ===
git fetch origin || goto :fail
git checkout -f -B main origin/main || goto :fail

echo === [3/6] Bagimliliklar (npm ci) ===
call npm ci || goto :fail

echo === [4/6] Migration (prisma migrate deploy) ===
call npx prisma migrate deploy || goto :fail

echo === [5/6] Build (npm run build) ===
call npm run build || goto :fail

echo === [6/6] Servis baslatiliyor ===
nssm start %SVC%

echo.
echo === Saglik kontrolu ===
timeout /t 5 /nobreak >/dev/null
powershell -NoProfile -Command "try { $h = Invoke-RestMethod http://127.0.0.1:3101/api/health/deep -TimeoutSec 10; Write-Host ('DEPLOY TAMAM  ->  status=' + $h.status + '  db=' + $h.db) -ForegroundColor Green } catch { Write-Host 'UYARI: health check basarisiz - pm2/nssm loglarina bakin' -ForegroundColor Yellow }"
echo.
pause
goto :end

:fail
echo.
echo *** HATA: Bir adim basarisiz oldu. Servis yeniden baslatiliyor... ***
nssm start %SVC%
echo.
pause
exit /b 1

:end
endlocal
