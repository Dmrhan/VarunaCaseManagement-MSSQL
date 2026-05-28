# Varuna Integration Test Pack

Manuel ve yarı-otomatik QA için kullanılan hazır test fixture'ları. Customer 360 Phase 2a dry-run + Phase 2b commit/rollback senaryolarını kapsar.

## Üretim

Tüm fixture dosyaları script çıktısıdır; repo'da hem script hem üretilmiş dosyalar takip edilir (büyük olmadıkları için).

```bash
# Customer 360 Phase 2a sample workbook (XLSX + CSV fallback)
node scripts/generate-customer360-sample-xlsx.js
```

Bu komut şu dosyaları üretir:

```
docs/integration-test-pack/inbound/
  customer360-valid.xlsx
  customer360-errors.xlsx
  customer360-csv/
    Accounts.csv
    Companies.csv
    Contacts.csv
    Addresses.csv
    Projects.csv
```

Generator deterministic — aynı satırlar, aynı VKN'ler, aynı dosya boyutları.

## customer360-valid.xlsx — temiz dry-run senaryosu

**Sheet'ler ve satır sayıları:**
| Sheet | Satır | Notlar |
|---|---|---|
| Accounts | 3 | 1 valid VKN, 1 no-VKN (warning), 1 Bireysel customerType |
| Companies | 3 | COMP-UNIVERA bağı + 1 boş companyCode (auto-bind warning) |
| Contacts | 4 | 1 birincil iletişim, 3 ek; tüm email + phone geçerli |
| Addresses | 3 | TR, DE, NL — country ISO-2 normalize |
| Projects | 2 | COMP-UNIVERA + 1 boş accountCompanyKey (auto-bind warning) |

**Beklenen dry-run sonucu (selected company = COMP-UNIVERA):**
- `commitAvailable: false` (Phase 2a banner)
- 0 hata
- 2 `auto_bound_to_selected_company` warning (boş companyCode/accountCompanyKey için)
- accountContact için 1 `no_vkn` warning (Beta'nın VKN'i yok)
- Tüm entity'lerde `action='create'`

## customer360-errors.xlsx — hata yollarını tetikler

**Sheet'ler ve satır sayıları:**
| Sheet | Satır | Tetiklenen yol |
|---|---|---|
| Accounts | 2 | Satır 1: `name` boş → row error |
| Companies | 2 | Satır 1: `companyCode='COMP-PARAM'` → `account_company_selected_company_mismatch` |
| Contacts | 3 | Satır 1-2: aynı email → `duplicate_contact_in_source` warning · Satır 3: `accountKey='9999999999'` → `orphan_child_row` |
| Addresses | 1 | `country='Türkiyye'` → invalid country error |
| Projects | 1 | `accountKey='9999999999'` → `orphan_child_row` |

**Beklenen dry-run sonucu (selected company = COMP-UNIVERA):**
- `commitAvailable: false`
- `skipErrorsPreview.blockedIfSkipErrorsFalse: true`
- `skipErrorsPreview.cascadingSkipIfSkipErrorsTrue`: account #1 invalid → tüm child cascade skip
- Per-entity error counts:
  - account: 1
  - accountCompany: 1
  - accountContact: 1 + 2 warning
  - accountAddress: 1
  - accountProject: 1

## UI üzerinden manuel test

1. Admin olarak login (örn. `admin@varuna.dev`).
2. **Yönetim Paneli → Veri Aktarım Stüdyosu** ekranını aç.
3. Target seçici: **"Müşteri 360 (Phase 2a) · dry-run"** sekmesi.
4. Şirket: **UNIVERA**.
5. **Multi-sheet XLSX** modunu seç, `customer360-valid.xlsx` dosyasını yükle.
6. Auto-map çalışsın, sonra **"Doğrula ve Dry-run"** butonuna bas.
7. Sonuç:
   - 5 entity tile dolu, hata kırmızı yok
   - Completeness score panel dolu
   - 2 sarı warning satırı (auto-bind notları)
   - DB sorgu: `prisma.account.count()`, `prisma.accountCompany.count()`, vb. **değişmemiş olmalı**
8. Aynı sayfaya geri dön, `customer360-errors.xlsx` yükle.
9. Beklenen hatalar görünmeli:
   - Account #1: "Müşteri adı boş olamaz."
   - Company #1: "İlişkili şirket satırı seçili şirketten farklı..." (selected-company guard)
   - Contact: duplicate warning + orphan error
   - Address: "Ülke kodu tanınmadı..."
   - Project: "accountKey parent Account satırına eşleşmedi."
   - skipErrors preview: "commit bloklanırdı"

## CSV fallback

`customer360-csv/` klasörü `customer360-valid.xlsx`'in sheet-bazlı CSV karşılığıdır. Phase 2a UI'sı yalnız XLSX (multi-sheet) ve nested JSON kabul ediyor; CSV'ler tek-entity Phase 1 yolu veya BFF'e curl ile yapılacak ad-hoc testler için referanstır.

## Güvenlik / PII

- Tüm e-posta ve telefon değerleri `*.demo` / `+9053210000xx` blok'undan; gerçek müşteri değil.
- TCKN içermez (registry zaten reddederdi; smoke #17).
- Hiçbir dosya gerçek production ID içermez; `COMP-UNIVERA` seed konvansiyonudur.

## Bu fixture'lar ne YAPMAZ

- Dry-run akışı DB mutation yapmaz (Phase 2a tasarımı gereği).
- Phase 1 Account import path'iyle alakası yoktur (`Müşteri Ana Kartı` sekmesinde test edilmez).

## Phase 2b commit + rollback testi (shipped 2026-Q2)

Phase 2b commit + rollback artık production'da. Aynı fixture'lar **commit testi için kullanılabilir** — `Customer360Page.tsx` confirm dialog'u + commit/rollback butonları içerir. Smoke: `scripts/smoke-customer360-commit-rollback.js`.

Manuel commit akışı:

1. Yukarıdaki "UI üzerinden manuel test" adımlarını uygula (dry-run yeşil olunca).
2. **"Aktar"** butonuna bas (Phase 2a banner artık `commitAvailable: true` döner).
3. Confirm dialog'da değişiklik özetini onayla.
4. `accountRepository.count` + `accountCompanyRepository.count` ile satır sayılarının arttığını doğrula.
5. Test sonrası **"Geri Al"** butonu ile aynı `jobId` üzerinden rollback dene; sayılar başlangıç state'ine dönmeli.

Endpoint referansları: `POST /api/admin/imports/customer360/commit` + `POST /api/admin/imports/customer360/jobs/:id/rollback` (`server/routes/imports.js`).
