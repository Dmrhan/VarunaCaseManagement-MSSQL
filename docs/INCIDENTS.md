# Incidents Runbook

Production veya local'de "uygulama açılmıyor / bootstrap fail / 500" türü olay
yaşandığında **bu dosyayı önce oku.** Belirti tipine göre tanı sırası ve
çözümler aşağıda. Yeni olay yaşandıkça §3'e ekle.

---

## 1. Hızlı Tanı Akışı

Olay raporu: "Uygulama yüklenemedi", "Bootstrap başarısız", "500 hatası".

### Adım 1 — Endpoint sağlığı
```
curl -s -w "HTTP %{http_code}\n" https://varuna-case-management.vercel.app/api/health
curl -s -w "HTTP %{http_code}\n" https://varuna-case-management.vercel.app/api/health/deep
```
- `/api/health` 200 + `/api/health/deep` 200 → BFF + DB ayakta. Sorun client-side veya auth.
- `/api/health` 200 + `/api/health/deep` 503 → DB erişim sorunu (pooler aksaklığı, auto-pause, env var).
- `/api/health` 500/504 → BFF dağıldı (deploy bozuk veya ENV eksik).
- Her ikisi de timeout → Vercel down (status.vercel.com).

### Adım 2 — Vercel Logs
Sol sidebar → **Logs**. Son 30 dk içindeki kırmızı/error satırlarına bak.
Tipik kalıplar:
- `Can't reach database server at ...:6543` → §3.1 (pooler)
- `Can't reach database server at ...:5432` → §3.1 (pooler — Vercel'den IPv6 sorunu)
- `Authentication failed` → DB password değişti/yanlış
- `relation "X" does not exist` → migration deploy edilmedi
- `OPENAI_API_KEY is not set` → env var eksik

### Adım 3 — Local'de tekrarla
Aynı sorun local'de var mı? Aynıysa DB-side sorun, farklıysa Vercel-side.
```bash
curl -s http://localhost:3101/api/health/deep
```

### Adım 4 — Supabase Dashboard
- supabase.com/dashboard → projeyi aç.
- Üstte sarı "Project paused" banner varsa → §3.2.
- Status "Healthy" ama dashboard yine de güvenilir değil — pooler aksaklığını çoğu zaman göstermez.

---

## 2. Önleyici Sistemler

| Sistem | Amaç | Konum |
|---|---|---|
| `/api/health/deep` | DB-touching probe | `server/app.js` |
| External pinger (UptimeRobot) | 5dk frequency, deep health'e alarm | UptimeRobot dashboard |
| GitHub Actions CI | Build kırılırsa main'e merge engeli | `.github/workflows/ci.yml` |
| `_prisma_migrations` tablosu | Schema versiyon takibi | DB |

UptimeRobot kurulumu:
1. uptimerobot.com → Free hesap aç
2. Add New Monitor → HTTPS → URL: `https://varuna-case-management.vercel.app/api/health/deep`
3. Monitoring Interval: 5 minutes
4. Alert Contacts: e-posta ekle
5. Keyword (opsiyonel, daha sıkı): "reachable" → eksikse alarm

---

## 3. Bilinen Olaylar

### 3.1 Supabase Pooler Geçici Aksaklığı (2026-05-02)

**Belirti:**
- `Can't reach database server at aws-1-eu-central-1.pooler.supabase.com:6543` (P1001)
- TCP el sıkışması başarılı (`nc -z host 6543` OK), Prisma yine de "Can't reach" diyor.
- Hem local hem prod aynı anda fail.
- Supabase dashboard "Healthy" gösterir.

**Tanı:**
- `nc -z aws-1-eu-central-1.pooler.supabase.com 6543` → TCP açık ama Prisma fail = pooler bozuk.
- DIRECT_URL (port 5432) çalışıyor mu? Test:
  ```bash
  node --env-file-if-exists=.env -e "
  import('@prisma/client').then(async ({PrismaClient}) => {
    const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
    try { console.log(await p.\$queryRaw\`SELECT 1\`); } catch(e) { console.error(e.message); }
    finally { await p.\$disconnect(); }
  })"
  ```

**Çözüm:**
- **İlk tercih: BEKLE.** Pooler aksaklıkları tipik <60dk sürer, müdahale gereksiz.
  - 10-15 dk sonra retest. Düzeldiyse normale dön.
- **Acil tercih: Workaround YAPMA.**
  - 5432'ye geçiş local'de çalışır AMA Vercel'den IPv6 yüzünden çalışmaz — boşa çaba.
  - Eğer 30 dk+ sürerse Supabase support ticket aç.

**Ne yapma:**
- Panik halinde `DATABASE_URL`'i 5432'ye geçirme. Vercel-prod kırılır.
- Aksaklık geçtikten sonra `prisma generate` çalıştırmayı unutma — generated client'ta cache kalmış olabilir.
- `.env` değişimi sonrası dev server restart şart (`npm run dev`).

**Kök neden bilgisi:**
- Hobby plan'da pooler aksaklığı için status sayfası bildirimi yok.
- Pro plan ($25/ay) status alerts + IPv4 Direct + auto-pause yok sağlar.

### 3.2 Supabase Auto-Pause (Hobby Plan)

**Belirti:** Kullanılmadan 7 gün geçince proje otomatik durur. DB erişilemez.

**Tanı:** Supabase Dashboard → üstte sarı "Project paused" banner.

**Çözüm:**
1. "Restore project" butonu → 1-2 dk bekle.
2. Hem local hem prod kendi kendine düzelir.

**Önleme:** UptimeRobot'un `/api/health/deep`'e 5dk ping atması auto-pause'u tetiklemez. Bu zaten kurulu.

### 3.3 Prisma Generated Client Cache

**Belirti:** `.env` DATABASE_URL parametresi değişti, hâlâ "Can't reach" hatası.

**Çözüm:**
```bash
npx prisma generate
```
Generated client `node_modules/.prisma/client/` dizininde — eski URL parametrelerini cache'liyor olabilir.

### 3.4 Local Dev Server Eski .env ile Çalışıyor

**Belirti:** `.env` güncellendi ama localhost:5273 hâlâ eski hatayı veriyor.

**Çözüm:** `npm run dev`'i kapat ve yeniden başlat. ESM module cache `.env` değişimlerini görmez.

---

## 4. Geliştirici Toolkit

```bash
# Vercel CLI (logs için)
npm i -g vercel
vercel login
vercel logs --json | tail -50

# Supabase ile direct test (psql yoksa node ile)
node --env-file-if-exists=.env -e "
import('@prisma/client').then(async ({PrismaClient}) => {
  const p = new PrismaClient();
  try { console.log('users:', await p.user.count()); }
  catch(e) { console.error('FAIL:', e.message); }
  finally { await p.\$disconnect(); }
})"

# Pooler TCP testi
nc -z -w 5 aws-1-eu-central-1.pooler.supabase.com 6543 && echo OK || echo FAIL
nc -z -w 5 aws-1-eu-central-1.pooler.supabase.com 5432 && echo OK || echo FAIL
```

---

**Son güncelleme:** 2026-05-02 — §3.1 olay sonrası oluşturuldu.
