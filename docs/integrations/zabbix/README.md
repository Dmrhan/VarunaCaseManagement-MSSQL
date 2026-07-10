# Varuna ↔ Zabbix Entegrasyonu — Kurulum (IT'ye teslim)

> İki yönlü entegrasyon. Bu doküman IT/sysadmin içindir; adımlar ~15 dakikadır.
> Mimari özet: **alarmlar Zabbix'te çalar**, Varuna içindeki Sistem Sağlığı
> panosu (Faz 2) teşhis ekranıdır.

```
YÖN A (alarm):    Zabbix ──HTTP agent──▶ GET /api/system/health   (X-Health-Token)
YÖN B (görünüm):  Varuna ──JSON-RPC────▶ Zabbix API               (read-only kullanıcı)
```

---

## YÖN A — Zabbix, Varuna'yı izlesin (alarmlar)

### 1. Varuna tarafı (tek env)
Prod `.env` dosyasına güçlü bir token ekleyin ve süreci yeniden başlatın:

```
HEALTH_TOKEN=<en az 32 karakter rastgele değer>
```

> Token tanımlı değilse endpoint'in token yolu **tamamen kapalıdır**
> (fail-closed); yalnız SystemAdmin JWT ile erişilir.

Doğrulama (sunucuda):

```bash
curl -s -H "X-Health-Token: <token>" https://csm.varunasolution.com/api/system/health | head -c 300
# JSON dönmeli; 401/403 dönerse token yanlış demektir.
```

### 2. Zabbix tarafı
1. **Import**: Data collection → Templates → Import → `varuna-health-template.yaml`
2. Varuna uygulama host'una template'i **link**leyin.
3. Host **makroları**:
   - `{$VARUNA.HEALTH.URL}` → `https://csm.varunasolution.com/api/system/health`
   - `{$VARUNA.HEALTH.TOKEN}` → yukarıdaki HEALTH_TOKEN (**secret text** tipinde girin)
4. 1-2 dk içinde `Varuna: health raw` item'ına veri düşmeli (Latest data).

### 3. Gelen trigger'lar (eşikler makrolarla ayarlanır)

| Trigger | Varsayılan eşik | Anlamı |
|---|---|---|
| OLASI MAIL DÖNGÜSÜ | 5 dk'da >15 vaka (3 ardışık örnek) | **DISASTER** — 6 Temmuz olayı deseni; intake'i durdurup inceleyin |
| health endpoint yanıt vermiyor | 5 dk veri yok | Uygulama düşmüş/ağ kopmuş — panonun raporlayamayacağı durum |
| Ek diski kritik/azalıyor | boş < %10 / %20 | STORAGE_ROOT diski |
| Bildirim kuyruğu birikiyor | Pending > 50 | Resolver tıkalı olabilir |
| Uzun süredir gelen mail yok | > 720 dk | Mesai dışı doğaldır; sürekli ise IMAP yetki/şifre (1 Tem olayı) |
| Env yapılandırma eksik | env.ok = 0 | APP_PUBLIC_BASE_URL / IMAP polling / STORAGE_ROOT yazılabilirliği |

> Eskalasyon/nöbet (kime SMS, kime mail) Zabbix action'larında kurulur — 
> kurumdaki mevcut düzeninizi kullanın.

---

## YÖN B — Varuna, Zabbix'ten okusun (Faz 2 panosu için hazırlık)

### 1. Zabbix'te kullanıcı açın
- **Read-only** bir API kullanıcısı (örn. `varuna_dashboard`)
- Yalnız ilgili host grubuna (Varuna app + SQL sunucusu) **okuma** izni

### 2. Varuna prod `.env`

```
ZABBIX_API_URL=http://<zabbix-host>/zabbix/api_jsonrpc.php
ZABBIX_USERNAME=varuna_dashboard
ZABBIX_PASSWORD=<şifre>
```

> Not: Zabbix **6.4+** varsayılır (login parametresi `username`; UniCP aynı
> sunucuyu bu parametreyle kullanıyor). HTTPS endpoint varsa onu tercih edin.

### 3. Bize iletilecek bilgiler
- Varuna uygulama sunucusunun ve SQL sunucusunun (10.135.140.17) Zabbix **host adları veya ID'leri**
  (ID bilinmiyorsa sorun değil — uygulamadaki keşif ucu item'ları listeleyip doğru key'leri bulur)

---

## Sık sorunlar

| Belirti | Çözüm |
|---|---|
| `health raw` item'ı hata veriyor | URL'e sunucudan `curl` atın; 401 ise makrodaki token ile env'deki HEALTH_TOKEN'ı karşılaştırın |
| Login `Invalid params` (Yön B) | Zabbix <6.4 ise `username` yerine `user` gerekir — sürümü bildirin, istemciyi uyarlarız |
| Dependent item'lar boş | Master item'a veri düşüyor mu bakın; JSONPath alan adları `schemaVersion:1` sözleşmesine bağlıdır |
| `lastInboundAgeMin` gece alarm üretiyor | `{$VARUNA.INBOUND.STALE.MIN}` makrosunu büyütün ya da trigger'a zaman penceresi ekleyin |

*Payload sözleşmesi: `server/lib/systemHealth.js` (schemaVersion 1). Alan adları
değişirse template güncellenmelidir — değişiklik PR'larında bu README not düşülür.*
