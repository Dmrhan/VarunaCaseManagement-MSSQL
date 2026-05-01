# Auth/RBAC Setup

Supabase Auth + Google OAuth + 5-rol RBAC kurulumu.

---

## 1. Mimari özet

```
Frontend (Supabase JS client)
    ↓ email/password ya da Google OAuth
Supabase Auth (oturum + JWT)
    ↓ Authorization: Bearer <access_token>
BFF /api/* (verifyJwt middleware)
    ↓ token doğrula → DB'de User'ı çöz
    ↓ requireRole('Admin') gibi guard'lar
Route handler (req.user erişebilir)
```

**Tablolar:**
- `User` (DB) — Supabase Auth UUID + role (Agent / Backoffice / Supervisor / CSM / Admin) + isActive + personId
- `Person` (DB) — operasyonel atama hedefi, User'dan ayrı; bağlama `User.personId` ile

**Auto-provisioning:** Google OAuth ile ilk kez giren biri için DB'de User yoksa otomatik `Agent` rolüyle oluşur. Admin sonradan rolü yükseltir.

---

## 2. Demo kullanıcılar

`npm run db:seed:auth` ile 5 kullanıcı oluşur. Şifre tüm hesaplar için `Test1234!`:

| Rol         | E-posta                  |
|-------------|--------------------------|
| Agent       | agent@varuna.dev         |
| Backoffice  | backoffice@varuna.dev    |
| Supervisor  | supervisor@varuna.dev    |
| CSM         | csm@varuna.dev           |
| Admin       | admin@varuna.dev         |

**Production'da bu kullanıcıları sil veya şifreleri değiştir.** Demo amaçlı.

---

## 3. Frontend env vars

`.env` (lokal) + Vercel Env Vars (production):

```env
# Browser tarafı — Vite expose eder
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

**`anon/publishable` key'i nereden alacaksın:**
1. Supabase Dashboard → Settings → API
2. "Project API keys" altında "anon public" satırı (yeni format `sb_publishable_...`, eski format `eyJ...`)
3. Kopyala, hem lokal `.env`'e hem Vercel'e yaz (tırnaksız!)

---

## 4. Google OAuth

### a) Google Cloud Console
1. [console.cloud.google.com](https://console.cloud.google.com) → yeni proje (varsa atla)
2. **APIs & Services → OAuth consent screen:**
   - User Type: **External**
   - App name: `Varuna CRM`
   - User support email + Developer email: kendi e-posta
   - Scopes: default (email, profile, openid)
   - Test users: ekleme zorunlu değil (production mode için verify gerek)
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID:**
   - Application type: **Web application**
   - Name: `Varuna CRM Web`
   - Authorized JavaScript origins:
     - `http://localhost:5273` (lokal dev)
     - `https://varuna-case-management.vercel.app` (production)
   - Authorized redirect URIs: **Supabase callback URL** (sonraki adımda alacağız)
4. **Client ID + Client Secret** üret, kopyala. (Henüz redirect URI eklemeden de oluşturabilirsin, sonra döner editlersin.)

### b) Supabase Dashboard
1. **Authentication → Providers → Google**
2. **Enabled** toggle açık
3. **Client ID + Client Secret** Google'dan kopyaladığını yapıştır
4. **Callback URL (for OAuth)** kopyala — şuna benzer:
   ```
   https://mkrrnvsiwfitqltdlsur.supabase.co/auth/v1/callback
   ```
5. Google Cloud Console'a dön → 3.adımdaki "Authorized redirect URIs"a bu callback URL'sini ekle, kaydet.
6. Supabase → Save.

### c) Test
1. Lokalde `npm run dev` ile başlat
2. Login sayfasında "Google ile Giriş Yap"
3. Google account seç → consent → callback → app açılır
4. Yeni kullanıcı `Agent` rolüyle DB'de auto-create
5. Admin gerekirse rolü yükseltir (FAZ-sonraki: Admin User Management UI)

### d) Domain kısıtlaması (opsiyonel, sonra)
Sadece `@univera.com.tr` domain'i girebilsin istiyorsan:
- **Option A:** Google Cloud Console → OAuth consent screen → Authorized domains → ekle
- **Option B:** `server/db/auth.js` `verifyJwt`'in auto-provision bloğuna domain check ekle:
  ```js
  if (!user.email?.endsWith('@univera.com.tr')) {
    return res.status(403).json({ error: 'domain_blocked' });
  }
  ```

---

## 5. Korumalı endpoint'ler

| Path                   | Koruma            |
|------------------------|-------------------|
| `/api/auth/me`         | verifyJwt         |
| `/api/cases/*`         | verifyJwt (her rol) |
| `/api/lookups/*`       | verifyJwt         |
| `/api/ai/*`            | verifyJwt         |
| `/api/admin/*`         | verifyJwt + requireRole('Admin') |
| `/api/health`          | açık              |

**İleri sprint:** Cases üzerinde rol-spesifik kısıtlar (örn. iptal sadece Supervisor) eklenir — şu an her authenticated user her şeyi yapabiliyor.

---

## 6. Yetki matrisi (§13 — sonraki sprint)

| Aksiyon                   | Agent | Backoffice | Supervisor | CSM | Admin |
|---------------------------|:-----:|:----------:|:----------:|:---:|:-----:|
| Vaka açma                 | ✓     | ✓          | ✓          | ✓   | ✓     |
| Vaka atama (kendine)      | ✓     | ✓          | ✓          | ✓   | ✓     |
| Vaka devretme             | ✓     | ✓          | ✓          | ✓   | ✓     |
| Statü → İptalEdildi       |       |            | ✓          |     | ✓     |
| Statü → Eskalasyon        |       | ✓          | ✓          |     | ✓     |
| Supervisor onayı verme    |       |            | ✓          |     | ✓     |
| Admin tanım ekranları     |       |            |            |     | ✓     |
| Kullanıcı yönetimi        |       |            |            |     | ✓     |

Bu matrisi enforcement: ileri sprint. Şu an: admin = Admin only, geri kalan = auth gerekli.
