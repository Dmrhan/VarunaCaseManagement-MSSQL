# IIS Sunucusuna Taşıma (Reverse Proxy + Windows Service)

Bu doküman, hâlen PM2 ile çalışan kurulumun **farklı bir Windows Server'a,
IIS arkasına** taşınmasını adım adım anlatır. Temel kurulum adımları için
[ONPREM_INSTALL.md](ONPREM_INSTALL.md) geçerlidir; burada yalnız taşıma
sırası ve IIS'e özgü farklar var.

## Mimari

```
İstemci ──HTTPS:443──▶ IIS (URL Rewrite + ARR)
                          │  TLS sonlandırma, X-Forwarded-For
                          ▼
                   http://127.0.0.1:3101
                   Node (NSSM Windows Service)
                   Express: /api + dist/ + gömülü cron
                          │
                          ▼
                     MSSQL (Prisma)
```

**Neden iisnode / HttpPlatformHandler değil?**

- iisnode bakımı bırakılmış bir proje; ESM (`"type": "module"`) ile sorunlu.
- HttpPlatformHandler'da süreç app-pool yaşam döngüsüne bağlanır: idle
  timeout / recycling süreci öldürür → gömülü cron durur, uzun KB analizi
  isteğin ortasında kesilir (geçmişteki `client_network_error` olayının
  IIS versiyonu). Reverse proxy modelinde Node süreci IIS'ten bağımsızdır.

## 0. Eski sunucudan taşınacaklar (checklist)

| Ne | Nereden | Not |
|---|---|---|
| `.env` | uygulama kökü | `TCKN_HASH_PEPPER` ve `JWT_*` **aynen** taşınmalı (pepper değişirse eski TCKN aramaları kırılır) |
| `data/` dizini | uygulama kökü | `embeddings.sqlite`, `cc-*.json`, `panorama-docs/` vb. — gitignore'da, repo'da YOK; yeniden üretimi saatler sürer |
| `STORAGE_ROOT` içeriği | `.env`'deki yol (ör. `D:\varuna-data\attachments`) | vaka ekleri |
| MSSQL veritabanı | — | DB aynı kalıyorsa sadece `DATABASE_URL` yeni sunucudan erişecek şekilde ayarlanır; DB de taşınacaksa backup/restore |

## 1. Yeni sunucu önkoşulları

1. **Node.js LTS** — eski sunucudakiyle aynı major sürüm (native modüller:
   better-sqlite3 / onnxruntime). `node --version` ile karşılaştır.
2. **IIS** + şu iki modül (IIS'e ek olarak ayrıca indirilir):
   - [URL Rewrite](https://www.iis.net/downloads/microsoft/url-rewrite)
   - [Application Request Routing (ARR)](https://www.iis.net/downloads/microsoft/application-request-routing)
3. ARR proxy'yi aç: IIS Manager → **sunucu** düğümü → Application Request
   Routing Cache → Server Proxy Settings → **Enable proxy** ✓.
   - Aynı ekranda **HTTP version: Pass through** ve **Reverse rewrite host
     in response headers** ✓ kalsın.
   - **Time-out**'u `300` saniye yap (KB "Analiz Et" istekleri uzun sürer;
     default 120 sn'de IIS 502.3 döner).
4. [NSSM](https://nssm.cc) — `nssm.exe`'yi PATH'te bir yere koy (ör.
   `C:\tools\nssm\`). nssm.cc'ye erişilemiyorsa: eski sunucuda
   `deploy\nssm\nssm.exe` olarak hazır bir kopya var (64-bit 2.24,
   gitignore'da — git clone ile GELMEZ, elle kopyalanmalı); alternatif
   `winget install nssm` / `choco install nssm`.
5. MSSQL erişimi: yeni sunucudan DB sunucusuna TCP portu açık olmalı
   (test: `Test-NetConnection <db-host> -Port <port>`).
6. Dışa çıkış: `api.openai.com:443` (+ kullanılıyorsa `api.anthropic.com:443`).

## 2. Uygulama kurulumu

```powershell
git clone <repo-url> C:\apps\VarunaCaseManagement
cd C:\apps\VarunaCaseManagement
npm ci                          # postinstall prisma generate'i çalıştırır
```

Eski sunucudan `.env`'i kopyala ve şu satırları yeni ortama göre düzelt:

```ini
PORT=3101
HOST=127.0.0.1        # IIS arkasında dışarıya kapalı dinle (yeni değişken)
DATABASE_URL=...      # yeni sunucudan DB'ye erişim
STORAGE_ROOT=...      # bu sunucudaki mutlak yol
CORS_ORIGIN=          # boş kalmalı (UI aynı origin'den proxy'leniyor)
```

Sonra:

```powershell
# data/ ve STORAGE_ROOT içeriğini eski sunucudan kopyala (robocopy önerilir)
robocopy \\eski-sunucu\c$\apps\VarunaCaseManagement-MSSQL\data .\data /E
robocopy \\eski-sunucu\d$\varuna-data\attachments D:\varuna-data\attachments /E

npx prisma migrate deploy       # DB aynıysa no-op; yeni DB'de şemayı kurar
npm run build                   # VITE_* flag'leri build'e gömülür — .env doğru olmalı!
node --env-file=.env server\index.js   # smoke: http://127.0.0.1:3101/api/health
```

> **VITE_ uyarısı:** `VITE_*` değişkenleri runtime'da değil **build anında**
> okunur. Flag değiştirince `npm run build` tekrarlanmalı.

## 3. Node'u Windows Service yap (NSSM)

```powershell
nssm install VarunaCM "C:\Program Files\nodejs\node.exe" "--env-file=.env server\index.js"
nssm set VarunaCM AppDirectory C:\apps\VarunaCaseManagement   # ÖNEMLİ: data/ yolları cwd-göreli
nssm set VarunaCM AppStdout C:\apps\VarunaCaseManagement\logs\out.log
nssm set VarunaCM AppStderr C:\apps\VarunaCaseManagement\logs\err.log
nssm set VarunaCM AppRotateFiles 1
nssm set VarunaCM AppRotateBytes 10485760
nssm set VarunaCM AppExit Default Restart                     # çökerse otomatik restart
nssm set VarunaCM Start SERVICE_AUTO_START
nssm start VarunaCM
```

Doğrula: `Invoke-RestMethod http://127.0.0.1:3101/api/health` ve
`...:3101/api/health/deep` (DB bağlantısı).

> Servis hesabının `STORAGE_ROOT` ve uygulama dizinine (logs/, data/) yazma
> izni olmalı. Varsayılan LocalSystem'de sorun çıkmaz; domain hesabı
> kullanılacaksa `icacls` ile izin ver.

## 4. IIS sitesi

1. Boş bir fiziksel kök oluştur: `C:\inetpub\varuna-proxy`.
2. Repo'daki [deploy/iis/web.config](../deploy/iis/web.config) dosyasını bu
   klasöre kopyala.
3. IIS Manager → Add Website:
   - Physical path: `C:\inetpub\varuna-proxy`
   - Binding: `https` / 443 / host adı (ör. `varuna.sirket.local`) + sertifika
   - HTTP→HTTPS redirect istiyorsan 80 binding'ini de ekle (web.config'deki
     kural yönlendirir).
4. App pool ayarı önemsizdir (kod çalıştırmıyor) ama temiz olsun diye:
   .NET CLR version = **No Managed Code**.
5. Test: `https://varuna.sirket.local/api/health` → `{"status":"ok"}`.

`web.config` özeti: tüm istekleri `http://127.0.0.1:3101`'e proxy'ler,
HTTP'yi HTTPS'e yönlendirir, upload limitini 100 MB'a çıkarır
(`maxAllowedContentLength`).

## 5. Kesin geçiş (cutover)

1. Yeni sunucuda smoke testleri çalıştır:
   ```powershell
   npm run smoke:release
   ```
2. Login + vaka açma + dosya ekleme + KB "Analiz Et" akışlarını elle doğrula.
3. Cron job'ların koştuğunu logdan doğrula (`logs\out.log` — snooze-wakeup
   her 5 dk'da bir iz bırakır).
4. **Eski sunucuyu kapat** — iki sürecin aynı DB'ye karşı cron koşturmaması
   için (job'lar idempotent ama gereksiz yük):
   ```powershell
   pm2 stop varuna-cm
   pm2 delete varuna-cm
   pm2 save
   pm2-startup uninstall    # boot'ta resurrect kaydını kaldırır
   ```
5. DNS / hosts kaydını yeni sunucuya çevir.

## 6. Güncelleme prosedürü (yeni sunucuda)

**KRİTİK SIRA:** `migrate → build → app restart`. Migration **mutlaka** app
restart'tan ÖNCE; aksi halde Prisma Client yeni alanları select edip P2022
(`column does not exist`) ile çakar.

### 6.a Sunucu PM2 ile yönetiliyorsa (kanonik kısayol)

```powershell
cd C:\apps\VarunaCaseManagement
npm run deploy:onprem
```

Tek komut şu sırayı garanti eder:
`git pull && npm ci && npm run db:migrate:deploy && npm run build && pm2 reload varuna-cm`

PM2 reload graceful — zero-downtime restart. `varuna-cm` PM2 app adı
[ecosystem.config.cjs](../ecosystem.config.cjs).

### 6.b Sunucu nssm ile yönetiliyorsa (Windows Service `VarunaCM`)

PM2 yerine nssm kurulu kutularda aynı sırayı **el ile** koşmak gerek (nssm
graceful reload sunmaz — stop/start şart):

```powershell
cd C:\apps\VarunaCaseManagement
git pull
npm ci
npm run db:migrate:deploy   # ← MUTLAKA stop'tan ÖNCE çalışsın da olur,
                             #   sonra da olur; ÖNEMLİ olan app start'tan
                             #   ÖNCE bitmiş olmasıdır
npm run build
nssm stop VarunaCM
nssm start VarunaCM
```

> **Sadece `db:migrate:deploy` kullanılır.** Prod'da `db:migrate` (= `prisma
> migrate dev`), `db:reset`, `prisma db push` **YASAK** — schema drift +
> veri kaybı riski. `migrate deploy` idempotent + non-destructive (pending
> migration yoksa no-op).

IIS tarafında hiçbir şey değişmez (proxy konfigürasyonu sabittir).

## 7. Sorun giderme (IIS'e özgü)

| Belirti | Neden / Çözüm |
|---|---|
| 502.3 Bad Gateway | Node servisi ayakta mı? `nssm status VarunaCM`; `127.0.0.1:3101/api/health` doğrudan dene |
| Uzun KB analizi 502.3 ile kesiliyor | ARR proxy timeout < istek süresi → §1.3'teki timeout'u artır |
| 404.13 / upload reddi | `maxAllowedContentLength` (web.config) — dosya boyutundan büyük olmalı |
| Rate limit herkese birden uygulanıyor | `trust proxy` ayarı `server/app.js`'te `loopback` — ARR'ın X-Forwarded-For gönderdiğini doğrula (default açık) |
| UI eski sürüm gösteriyor | `npm run build` unutulmuş ya da tarayıcı cache — Node `dist/`i 1 saat cache'ler, hard refresh |

Genel sağlık kontrolü ve diğer sorunlar: [ONPREM_INSTALL.md §8](ONPREM_INSTALL.md#8-sağlık-kontrolü--sorun-giderme).
