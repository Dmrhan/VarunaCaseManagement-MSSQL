# Test Scenarios

Bu doküman PM, QA ve geliştiricilerin Varuna Case Management'i manuel test
ederken kullanabileceği yapılandırılmış senaryoları içerir. Her senaryo bir
**persona** ile başlar, **adımları** sıralar ve **beklenen davranışı** açıklar.

> Bu liste pre-prod (dev) ve smoke regresyon testleri için referanstır. Hatalar
> bulunursa `docs/INCIDENTS.md`'e ekleyin; bulgular `docs/ROADMAP.md` veya
> `docs/TECHNICAL_DEBT.md`'ye düşer.

## Demo Personalar

Demo seed (`npm run db:seed:auth` — yalnızca local) aşağıdaki kullanıcıları
oluşturur. Production'da bu seed çalıştırılmaz; PM testleri için ayrı bir
demo Supabase project tercih edilir.

| Email | Rol | Şirket(ler) | Senaryolarda kullanım |
| --- | --- | --- | --- |
| `agent@varuna.dev` | Agent | PARAM | Frontline; vaka açar, not yazar, transfer eder |
| `backoffice@varuna.dev` | Backoffice | PARAM | Operatif çözüm; vakaya yanıt yazar |
| `supervisor@varuna.dev` | Supervisor | PARAM + UNIVERA | İzleyici atama, AI raporu, multi-tenant |
| `csm@varuna.dev` | CSM | PARAM | Müşteri temaslı senaryolar |
| `admin@varuna.dev` | Admin | PARAM + UNIVERA + FINROTA | Yönetim ekranları, tenant kontrolü |
| `sysadmin@varuna.dev` | SystemAdmin | Tüm şirketler | Platform yapılandırma, FieldDefinitions |

Demo şifreleri `prisma/seedAuth.ts` ile set edilir (varsayılan: `demo1234`).

---

## 1. Vaka Yaşam Döngüsü (Smoke)

**Persona:** Agent (`agent@varuna.dev`)

1. Login → Vakalar listesinde PARAM şirketinin vakaları görünür (başka şirket sızıntısı yok).
2. "Yeni Vaka" → müşteri ara, kategori seç, ürün grubu dropdown'ında sadece PARAM ürünleri.
3. Açıklamayı 10 karakter altı gir → AI başlık önerisi tetiklenmemeli; üstüne çık → öneri gelir (AI key varsa).
4. Vaka oluştur → Detay ekranı; SLA sayaçları aktif.
5. Statü değiştir (Açık → Üzerinde Çalışılıyor) → activity feed satırı düşer.
6. Öncelik değiştir → activity feed + watcher'a bildirim (varsa).
7. Çözüm taslağı isteme → AI yanıtı veya 503/timeout sonucu graceful fallback.

**Beklenen:** Her adım toast + activity feed. Hatalı senaryoda kullanıcı dostu mesaj görür, sayfa kırılmaz.

---

## 2. Notlar — Reply Thread + Reaction

**Personalar:** Agent ve Supervisor (iki sekmede)

1. **Agent:** Bir vakanın **Notlar** sekmesinde yeni not yazar (İç Not).
2. **Supervisor:** Aynı vakayı açar → not görünür.
3. **Supervisor:** Notun altındaki **↩ Yanıtla** → composer açılır → kısa yanıt + Gönder.
4. **Agent:** "X yanıt" rozeti tıkla → thread açılır, Supervisor yanıtını görür.
5. **Agent:** Aynı yanıt için **Yanıtla butonu yok** (max 1 derinlik).
6. **Agent:** Notun altında 😊+ butonu → 👍 → chip "👍 1" + highlight (mine).
7. **Supervisor:** Aynı nota 👀 → chip "👀 1" görünür; **Agent:** 60 saniye içinde bell'de "X notunuza 👀 tepkisi verdi" bildirimi.
8. **Agent:** Kendi 👍'ına tekrar tıkla → chip kaybolur (toggle off), **bildirim üretilmez** (removal).

**Beklenen:** Thread + reactions sorunsuz; bildirim sahibe gider, reactor kendine bildirim almaz.

---

## 3. Watcher + Bildirimler

**Personalar:** Supervisor + Agent + 2. Agent (varsa)

1. **Supervisor:** Bir PARAM vakasını aç → Sağ panelde **İzleyiciler** kartı → +  Agent'ı ekle.
2. **Agent:** O vakayı aç → kendisi izleyici listesinde görünür.
3. **2. Agent (Supervisor):** Aynı vakaya **not** ekle.
4. **Agent:** Bell badge artar; drawer'da "X vakasında yeni not" satırı (60 saniye polling içinde).
5. **Supervisor:** Vakayı başka takıma transfer et → izleyicilere "vaka aktarıldı" bildirimi.
6. **Agent:** Drawer'ı aç → görünen notification'lar otomatik seen yapılır → ikinci açışta listede kalır ama tekrar açınca count 0.

**Beklenen:** Bell badge tutarlı; bildirim mesajları doğru (`payload.message`). Aktör kendine de bildirim alır (gürültü kabul, spec gereği).

---

## 4. Linked Cases (Bağlantılı Vakalar)

**Persona:** Supervisor

1. Bir vakanın **Bağlantılar** sekmesi → RUNA AI öneri kartı yüklenir (max 3 aday).
2. AI önerilerinden birini tıkla → Related/Parent/Duplicate seçimi → ekle.
3. Hedef vakayı aç → Bağlantılar sekmesinde **simetrik** Duplicate görünür.
4. **Manuel ekle:** "Vaka Bağla" modal → vaka ara → Related ekle.
5. Bağlantıyı kaldır → her iki uçta da kalkar (Duplicate symmetric remove).
6. Aynı vakaya kendisini bağlamayı dene → **self_link** hatası.
7. Farklı şirketteki vakaya bağlamayı dene → **cross_tenant** reddedilir.
8. A → B Parent zaten varsa B → A Parent ekleme → **circular** reddedilir.

**Beklenen:** Tüm hata yolları kullanıcı dostu mesaj; AI fail durumunda "AI önerisi alınamadı" amber satır.

---

## 5. AI — Durum Raporu (Status Report)

**Persona:** Supervisor

1. Vaka detay header'ında **Durum Raporu Oluştur** butonu → modal açılır → AI yanıtı bekler.
2. AI başarılı → mail-ready format prose halinde rapor, kopyalanabilir.
3. AI fail (sim. OPENAI_API_KEY rotate edilmiş) → kullanıcıya 503 + "AI servisi yapılandırılmamış" toast.
4. Çok uzun açıklama (10K+ char) → 400 input_too_large; OpenAI çağrısı yapılmaz.

**Beklenen:** Hata durumlarında modal hang değil; net toast.

---

## 6. AI — Customer Pulse (Müşteri Durumu)

**Persona:** Agent

1. Vaka detay açıldığında sağ alt panelde "Müşteri Durumu" otomatik yüklenir (deterministic önce).
2. AI özet upgrade arka planda gelir → metin AI versiyonu ile değişir, "RUNA AI özet" violet rozet.
3. AI fail → metin deterministic kalır + amber **"Standart özet (AI önerisi alınamadı)"** rozet.
4. Repeated issues + son 30 gün vakaları + SLA ihlal metrikleri görünür.
5. Pulse state badge (Stable/Watch/Risky/Critical) doğru renk + dot.

**Beklenen:** Kullanıcı her zaman gerçek pulse verisini görür; AI olsa da olmasa da rozet net.

---

## 7. AI — Suggest Links

**Persona:** Agent

1. Vakanın Bağlantılar sekmesi → AI kart "Analiz ediliyor…" → öneri listesi.
2. Yenile butonu → tekrar analiz; aria-label "Benzer vakaları yeniden analiz et".
3. Aday yoksa "Önerilecek benzer vaka bulunamadı".
4. AI fail → amber **"AI önerisi alınamadı"** + ShieldAlert ikon.

**Beklenen:** Boş ↔ fail farkı net.

---

## 8. Multi-Tenant Izolasyon

**Personalar:** Admin (PARAM + UNIVERA) ve PARAM-only Agent

1. **Admin:** PARAM şirketi seçili → vakalar PARAM. UNIVERA seçimine geç → UNIVERA vakaları.
2. **Agent:** Sadece PARAM görür; URL ile UNIVERA case id'sine git → 403 / 404.
3. **Yeni vaka açarken** ürün grubu dropdown → sadece o şirketin distinct grupları (P0.2 fix sonrası).
4. **AI suggest-links:** Sadece aynı şirketin son 30 gün vakaları (cross-tenant aday yok).
5. **Mention dropdown:** Vaka şirketinde aktif kullanıcılar (cross-tenant @ ile başkasını etiketleme reddedilir).
6. **Watcher / Linked Case ekle:** Hedef başka şirket → reddedilir.

**Beklenen:** Hiçbir liste / autocomplete / AI çıktısı cross-tenant data sızdırmaz.

---

## 9. Bell Badge — Mention + Notification Birleşik Feed

**Persona:** Supervisor

1. Login → Bell sayacı (mention + generic notification toplamı).
2. Drawer aç → en yeni en üstte; mention satırı `@` ikonu, reaction satırı 😊 ikonu, watcher satırı 👁 ikonu.
3. Mention satırı tıkla → vakaya gidilir, o vakadaki mention'lar seen yapılır.
4. Notification satırı tıkla → vakaya gidilir.
5. Drawer açıldıktan sonra kapan → generic notification'lar seen (mention seen ayrı flow).

**Beklenen:** Mention + notification ayrı kanal ama tek UI; sayaç tutarlı.

---

## 10. Dark Mode Smoke

**Persona:** Her rol

1. Sistem dark mode → tüm sayfalarda beyaz kutu kalmamalı:
   - Header, tab nav, sağ panel kartları (RUNA AI, QA Score, Watchers, Links, Customer Pulse)
   - Bağlantılar modal'ı seçenek butonları + checklist
   - Notlar, replies, reaction chip ve picker'ı
   - Bell drawer içeriği
   - CasesList page başlığı
2. Mention dropdown error → kırmızı styled (light + dark).
3. AI fail rozetleri → amber renk (light + dark).

**Beklenen:** Tek bir hardcoded `bg-white` veya `text-slate-900` (dark variant'sız) yüzeyde okunmaz alan yok.

---

## 11. Activity Feed — Tüm Aksiyonlar

**Persona:** Agent

1. Yeni not, çağrı, atama değişikliği, statü değişimi, reply, transfer, file upload — her biri activity feed'de **Türkçe** mesaj.
2. Filtreler: tümü / not / çağrı / statü / atama.
3. AI metadata field updates feed'i kirletmemeli (örn. `aiCategorySuggestion` field).

**Beklenen:** Feed temiz + okunabilir + filtreler doğru çalışır.

---

## Bilinen Kısıtlamalar (Test Beklentisi)

Aşağıdakiler şu an **uygulanmamış** veya **kısmi**; bu senaryolarda test etmeyin:

- **E-posta bildirimi**: Hiçbir notification e-posta göndermez. `channel='InApp'` only. (Faz 2 §6 kapsamında planlandı.)
- **Watcher Inbox UI**: BFF endpoint `/watching` ve `/me/notifications/unread` mevcut; ayrı bir inbox sayfası yok. Watcher kullanıcılar bell drawer'dan takip eder.
- **CasesList link count indicator**: Liste satırında "bu vaka X başka vakaya bağlı" küçük chip yok. Bağlantılar sayfasından görülür.
- **CaseNotification cleanup**: Tablo append-only; eski satırlar henüz cron ile silinmiyor (retention policy TBD).
- **Eski notlara reaksiyon bildirimi**: PR #68 öncesi yazılmış notlar `authorId` taşımıyor; reaksiyon eklenirse bildirim üretilmez (sessiz fallback). Yeni notlar test edin.
- **OpenAI rate-limit (429)**: Gerçek trafikte test edilemez; kod yolu statik review ile kabul edildi.
- **Mobile responsive**: Telefon emülasyonuyla genel akış test edilebilir ama "mobile-first" tasarım hedefi değil.

---

## Yeni Senaryo Eklerken

- Persona ile başla (rol + şirket).
- Adımları numaralı sırada yaz; her adım gözlemlenebilir bir aksiyon olsun.
- "Beklenen:" satırını mutlaka yaz.
- Negatif (hata) durumlarını da test et.
- Hata bulunursa `docs/INCIDENTS.md`'e tarihli kayıt düş.
