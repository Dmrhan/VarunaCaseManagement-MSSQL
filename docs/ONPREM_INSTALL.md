# On-Prem Kurulum (Windows Server + MSSQL)

Bu doküman Varuna Case Management'ın Supabase/Vercel'siz, tamamen on-premise
kurulumunu anlatır. Mimari: tek Node.js süreci — Express hem `/api`'yi hem
build edilmiş frontend'i (`dist/`) servis eder; zamanlanmış job'lar aynı
süreçte koşar. Veritabanı: Microsoft SQL Server. Dosya ekleri: yerel disk.

## 1. Önkoşullar

| Bileşen | Sürüm / Not |
|---|---|
| Windows Server | 2019+ (geliştirme: Windows 10/11 da olur) |
| Node.js | 20.6+ (`--env-file` desteği gerekli; test edilen: 22/24) |
| SQL Server | 2019+ (test edilen: 15.0.4360) |
| Disk | Ekler için ayrı bir veri dizini (ör. `D:\varuna-data\attachments`) |

### SQL Server hazırlığı

1. Veritabanını **Turkish_100_CI_AS_SC_UTF8** collation ile oluştur
   (Türkçe case-insensitive arama buna dayanır):
   ```sql
   CREATE DATABASE VarunaCaseManagement COLLATE Turkish_100_CI_AS_SC_UTF8;
   ```
2. SQL login oluştur ve `db_owner` ver (migration'lar DDL çalıştırır).
3. **TCP portunu sabitle.** Named instance'lar varsayılan olarak dinamik port
   kullanır ve restart'ta değişebilir; Prisma instance adı çözemez, porta bağlanır.
   SQL Server Configuration Manager → SQL Server Network Configuration →
   Protocols → TCP/IP → IP Addresses → IPAll → "TCP Dynamic Ports"u boşalt,
   "TCP Port"a sabit değer yaz (örn. 1433 veya 50404) → servisi yeniden başlat.
   Mevcut portu öğrenmek için:
   ```sql
   SELECT local_tcp_port FROM sys.dm_exec_connections WHERE session_id=@@SPID;
   ```

## 2. Uygulama kurulumu

```powershell
git clone <repo-url> C:\apps\VarunaCaseManagement
cd C:\apps\VarunaCaseManagement
npm install
copy .env.example .env
# .env'i doldur (aşağıdaki tablo)
npx prisma migrate deploy     # şemayı kurar (boş DB'de tüm migration'lar koşar)
npm run db:seed               # lookup/demo verisi (opsiyonel ama önerilir)
npm run db:seed:auth          # demo kullanıcılar (ilk girişten sonra silinebilir)
npm run build                 # frontend'i dist/ altına derler
npm start                     # http://localhost:3101
```

İlk giriş: `sysadmin@varuna.dev / Test1234!` → admin panelinden gerçek
kullanıcıları oluştur, demo kullanıcıları pasifleştir/şifrelerini değiştir.

### .env değişkenleri

| Değişken | Açıklama |
|---|---|
| `DATABASE_URL` | `sqlserver://HOST:PORT;database=VarunaCaseManagement;user=...;password=...;encrypt=false;trustServerCertificate=true` — named instance kullanılıyorsa instance'ın SABİT TCP portunu yaz |
| `PORT` | BFF + UI portu (default 3101) |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | 32+ karakter, birbirinden farklı rastgele string'ler. Üretim: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JWT_ACCESS_EXPIRY` / `JWT_REFRESH_EXPIRY` | default `30m` / `7d` |
| `STORAGE_ROOT` | Vaka eklerinin dizini — **yedeklemeye dahil et** |
| `TCKN_HASH_PEPPER` | 16+ karakter rastgele string (KVKK — TCKN hash'leri için; sonradan DEĞİŞTİRİLEMEZ, değişirse eski TCKN aramaları kırılır) |
| `OPENAI_API_KEY` | AI özellikleri (opsiyonel; yoksa AI endpoint'leri 503, uygulama çalışır). Firewall'da `api.openai.com:443` çıkışı gerekir |
| `CRON_SECRET` | HTTP cron endpoint'lerini manuel tetiklemek için (opsiyonel; scheduler zaten gömülü) |
| `CORS_ORIGIN` | Yalnız frontend ayrı origin'den sunuluyorsa |
| `CRON_SCHEDULER_ENABLED` | `false` → gömülü zamanlayıcı kapanır (harici zamanlayıcı kullanılacaksa) |
| `DEVOPS_PAT_ENC_KEY` | **DevOps Faz 2.1 — ZORUNLU** (PAT şifreleme). 32 byte; üret: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Tek seferlik ops kurulumu; PAT'in aksine rotate edilmez. Anahtar yoksa admin DevOps Ayarları'nda 503 + "DevOps PAT şifreleme anahtarı sunucuda tanımlı değil" |
| `TFS_BASE_URL` | DevOps Faz 1 — TFS koleksiyon URL'i (sonu `/_apis`, proje route'u GİRMEZ). Örn: `https://unitfs.univera.com.tr/tfs/DefaultCollection/_apis` |
| `TFS_USERNAME` | DevOps Faz 2.1 follow-up — on-prem TFS Basic/NTLM kullanıcı adı. `DOMAIN\user` veya UPN. Cloud Azure DevOps PAT-only ise BOŞ bırak (Basic `:pat` kullanılır) |
| `TFS_PAT` | DevOps Faz 1 — default tenant secret (DB satırı yokken fallback). Admin UI üzerinden per-tenant override edilebilir; o zaman bu env opsiyonel |
| `TFS_API_VERSION` | DevOps Faz 1 — TFS REST sürümü, on-prem default `4.1`, cloud `6.0` |
| `TFS_TIMEOUT_MS` | DevOps Faz 1 — request timeout, default `15000` |
| `TFS_TEST_WORKITEM_ID` | DevOps Faz 2.1 — admin "Bağlantıyı test et" için varsayılan work item id (body'de gönderilmediğinde) |

## 3. Kalıcı çalıştırma

### Seçenek A — PM2 (bu makinede kullanılan)

```powershell
npm install -g pm2 pm2-windows-startup
cd C:\apps\VarunaCaseManagement
pm2 start ecosystem.config.cjs   # repo kökündeki tanım (fork mode, log rotate path'leri)
pm2 save                         # süreç listesini dump'a yaz
pm2-startup install              # kullanıcı login'inde otomatik resurrect
```

Günlük komutlar: `pm2 status` · `pm2 logs varuna-cm` · `pm2 restart varuna-cm`.

> **Bilinen sorun — `connect EPERM \\.\pipe\rpc.sock`:** PM2, Windows'ta
> statik global pipe adı kullanır (`pm2/paths.js` içinde `\\.\pipe\rpc.sock`).
> Makinede pm2 gömülü BAŞKA bir yazılım varsa (bu sunucuda vardı) pipe çakışır
> ve pm2 hiç açılmaz. Çözüm: `%APPDATA%\npm\node_modules\pm2\paths.js`
> dosyasındaki win32 bloğunda pipe adlarını PM2_HOME'dan türet (bkz. uygulanan
> yama — pipe adına `C--Users-...-.pm2-` öneki). **pm2 sürüm yükseltmesi bu
> yamayı siler; yükseltme sonrası yeniden uygulanmalı.**
>
> Not: `pm2-startup` kullanıcı LOGIN'inde başlatır (registry Run). Sunucu
> login'siz reboot ediliyorsa NSSM seçeneğini kullanın.

### Seçenek B — NSSM (login gerektirmeyen gerçek Windows Service)

[NSSM](https://nssm.cc) (the Non-Sucking Service Manager).

```powershell
nssm install VarunaCM "C:\Program Files\nodejs\node.exe" "--env-file=.env server\index.js"
nssm set VarunaCM AppDirectory C:\apps\VarunaCaseManagement
nssm set VarunaCM AppStdout C:\apps\VarunaCaseManagement\logs\out.log
nssm set VarunaCM AppStderr C:\apps\VarunaCaseManagement\logs\err.log
nssm set VarunaCM AppRotateFiles 1
nssm set VarunaCM AppRotateBytes 10485760
nssm start VarunaCM
```

Alternatif: `pm2` + `pm2-windows-startup`.

HTTPS için önerilen: IIS (ARR reverse proxy) veya nginx ile 443 → 3101
yönlendirmesi + sertifika sonlandırma. Uygulama kendisi HTTP dinler.
IIS'e taşıma adım adım: [IIS_DEPLOY.md](IIS_DEPLOY.md).

## 4. Zamanlanmış job'lar

Sürece gömülüdür (`server/cronScheduler.js`, Europe/Istanbul):

| Job | Zamanlama | İş |
|---|---|---|
| snooze-wakeup | her 5 dk | Ertelenen vakaları uyandırır |
| pattern-detect | her 15 dk | Vaka kümelenmesi → PatternAlert |
| qa-score-batch | 02:00 | AI QA skorlama (OPENAI_API_KEY yoksa no-op) |
| notification-cleanup | 03:00 | 30 günden eski okunmuş bildirimleri siler |
| actionitem-archive | 03:30 | Kapanmış eylem öğelerini arşivler |

Tümü idempotent; servis restart'ı sorun çıkarmaz. Manuel tetik:
`POST /api/cron/<job>` + `Authorization: Bearer ${CRON_SECRET}`.

## 5. Bilgi Bankası (KB/RAG)

KB/RAG çekirdeği (eski ticket-analiz) uygulamaya gömülüdür (`server/kb/kbCore.js`
+ `/api/v1/*` endpoint'leri). Çalışması için:

1. `data/embeddings.sqlite` (+ `panorama-docs/`, `cc-*.json`, `solutions/`,
   `known-issues/`) dosyaları repo'ya DAHİL DEĞİLDİR (gitignore) — yeni kuruluma
   mevcut sunucudan kopyalanmalı.
2. .env: `ANTHROPIC_API_KEY` (RAG cevapları), `API_KEYS` (v1 Bearer auth),
   `EXTERNAL_KB_API_KEY` (CSM'in kendi v1'ine bağlanma anahtarı — API_KEYS
   listesindeki ilk anahtarla aynı), `TICKET_MSSQL_*` (analiz pipeline'ının
   okuduğu VeriOkumaDonusum DB'si), `CC_SESSION_SECRET`.
3. Embedding lokal modeldir (Xenova multilingual-e5-base) — ilk sorguda
   ~110MB model indirilir ve cache'lenir; sonrası tamamen offline.
4. `ExternalKbSetting` her şirket için `baseUrl=http://127.0.0.1:<PORT>`,
   `authType=bearerToken`, `apiKeySecretName=EXTERNAL_KB_API_KEY` olmalı
   (Admin → External KB ekranından da düzenlenebilir).
5. KB içeriği güncelleme (yeni PDF/doküman ingest) şimdilik ticket-analiz
   repo'sundaki scriptlerle yapılır; üretilen `data/embeddings.sqlite` buraya
   kopyalanır (kbCore yeniden build gerekmez).

## 6. Yedekleme

1. **MSSQL**: standart SQL Server backup planı (full + log).
2. **`STORAGE_ROOT`**: dosya ekleri DB'de değil diskte — dizini yedeğe dahil et.
3. **`data/` dizini**: KB vektör deposu (`embeddings.sqlite`) ve taksonomi/
   panorama dosyaları — yedeğe dahil et (yeniden üretimi saatler sürer).
4. **`.env`**: secret'lar (JWT_SECRET, TCKN_HASH_PEPPER, ANTHROPIC_API_KEY,
   API_KEYS) kaybolursa oturumlar/TCKN aramaları/KB kırılır — güvenli kasada sakla.

## 7. Güncelleme

**KRİTİK SIRA:** `service stop → mutate → service start`. İki kural birlikte:
1. Migration **mutlaka** yeni process başlamadan ÖNCE bitmiş olmalı; aksi
   halde Prisma Client yeni alanları select edip P2022 ile çakar.
2. `npm ci` + `npm run build` **çalışan service'in altından** node_modules
   ve dist/'i mutate eder → service ayaktayken yarım dosyalara çakar.
   Service ÖNCE durur, sonra mutate, sonra başlar.

### PM2 ile (kanonik kısayol)

```powershell
cd C:\apps\VarunaCaseManagement
npm run deploy:onprem
```

İçeride [`scripts/deploy-onprem.mjs`](../scripts/deploy-onprem.mjs) sırayı
yönetir: `pm2 stop → git pull → npm ci → migrate deploy → build → pm2 start`.

**PM2 stop verify**: script `pm2 jlist` ile service'in gerçekten durduğunu
doğrular; "online" ise mutate iptal (exit 3).

**Real rollback**: mutate fail durumunda `git reset --hard <oldHead>` +
`dist/` backup restore + `npm ci` ile eski state geri yüklenir, sonra
`pm2 start` eski state ile ayağa kalkar (chimera state YOK). Çıkış kodları:
- 0 yeni build canlıda · 1 mutate fail rollback yapıldı · 2 pm2 start fail ·
3 pre-flight fail

Detay: [OPERATIONS.md "On-Prem (PM2) Deploy"](OPERATIONS.md).

Downtime: ~30-120 sn (build süresi).

### nssm ile (Windows Service `VarunaCM`)

```powershell
cd C:\apps\VarunaCaseManagement
nssm stop VarunaCM            # ÖNCE: live tree kapansın
git pull
npm ci
npm run db:migrate:deploy     # start'tan ÖNCE bitmiş olmalı
npm run build
nssm start VarunaCM
```

> **Sadece `db:migrate:deploy` kullanılır.** Prod'da `db:migrate` (= `prisma
> migrate dev`), `db:reset`, `prisma db push` **YASAK**. `migrate deploy`
> idempotent + non-destructive — pending migration yoksa no-op.

Zero-downtime gerekiyorsa atomik release-dir / symlink swap pattern'i kullan
(bkz. [docs/OPERATIONS.md "Zero-downtime atomic release"](OPERATIONS.md)).

## 8. Sağlık kontrolü / sorun giderme

- `GET /api/health` — süreç ayakta mı
- `GET /api/health/deep` — DB erişilebilir mi (+ gecikme)
- Login 503 + "JWT_SECRET tanımlı değil" → .env eksik
- `P1001 Can't reach database` → MSSQL portu değişmiş olabilir (bkz. §1.3)
- Dosya upload 500 → `STORAGE_ROOT` dizinine servis hesabının yazma izni var mı

## 9. Bilinen sınırlamalar

- E-posta gönderimi yok: kullanıcı oluşturma/şifre sıfırlama admin panelinden,
  şifre kullanıcıya elden iletilir (tasarım kararı — bkz. MSSQL_ONPREM_PLAN_V2.md).
- Google OAuth kaldırıldı (istenirse ileride OIDC eklenebilir).
- `prisma migrate dev` filtered unique index'leri drift sanabilir — yeni
  migration'ları `--create-only` ile üretip gözden geçirin
  (bkz. prisma/schema.prisma baş yorumu).
