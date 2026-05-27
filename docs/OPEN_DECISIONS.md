# Open Decisions Register

**Last audited:** 2026-05-27 (Hidden Backlog Fragment Audit PR-C consolidation)
**Owner:** Ürün direktörü (connect@univera.com.tr)

> Bu dosya **kararların canonical hâlidir** — daha önce 5 ayrı doc'a dağılmış product / tech kararları tek noktada toplanmıştır:
> [`docs/PRODUCT_SPEC.md §15`](PRODUCT_SPEC.md), [`docs/FAZ2_COLLAB_SPEC.md §"Açık Karar Noktaları"`](FAZ2_COLLAB_SPEC.md), [`docs/OPERATIONS_DASHBOARD_DESIGN.md §7`](OPERATIONS_DASHBOARD_DESIGN.md), [`docs/WORK_REGISTER.md §"Do Not Forget"`](WORK_REGISTER.md), [`docs/planning_cards/`](planning_cards/).
>
> Source dokümanlardaki orijinal tablo/satır metni **bu PR'da silinmedi** — yalnız bir cross-reference notu eklendi. Eski metinler doc-hygiene PR'ında (PR-D PRODUCT_SPEC refresh) temizlenebilir.

---

## Purpose

- Tek soruya 5 farklı yerden 5 farklı cevap çıkmasın
- "Şu karar verildi mi?" sorusu tek arama ile yanıtlansın
- Karar tarihi + sahibi + kanıt bağlantısı tek noktada görünsün
- Açık kararlar PR template (Planning Card link satırı) üzerinden yeni iş başlamadan önce kontrol edilebilsin

---

## Status legend

| Status | Anlamı |
|---|---|
| **PENDING** | Açık; ürün/teknik karar bekliyor. Yeni iş başlamadan önce karar alınmalı (eğer karara bağlı ise). |
| **RESOLVED** | Karar verildi + kod/doc'a yansıdı. Destination satırı kanıt verir. PRODUCT_SPEC refresh turunda bu satır migrate edilir. |
| **DEFERRED** | Bilinçli olarak ileri faza ertelendi. Trigger koşulu Target timing'de yazılır. |
| **OBSOLETE** | Orijinal soru artık geçersiz (premise çürüdü / scope dışı / spec'ten çıkarıldı). |

---

## Decision fields

Her karar şu alanları taşır (compact format, gerekirse sub-line):

- **ID** — `OD-XXX` (3-haneli sayaç)
- **Area** — 8 kategori (aşağıdaki bölümler)
- **Decision** — tek cümle soru
- **Context** — 1-2 satır neden bu karar gerekli
- **Options** — kısa madde listesi
- **Recommended default** — varsa öneri (Status=PENDING için non-binding hint, Status=RESOLVED için tarihçe)
- **Status** — yukarıdaki 4'ten biri
- **Owner** — kim karar verecek (ürün direktörü / DPO / Eng / Ops)
- **Target timing** — trigger ya da sprint referansı
- **Source** — orijinal dokümanın §veya tablo adresi
- **Destination** — RESOLVED ise nerede yaşıyor (PRODUCT_SPEC §, BACKLOG item, planning card, vs.)

---

## 1. Product / Workflow

### OD-001 — Jira → SLA pause politikası
- **Decision:** Bir vaka Jira'ya devredildiğinde SLA sayacı durmalı mı?
- **Options:** (a) Otomatik pause (3rdPartyBekleniyor analoğu), (b) Manuel statü değişikliği zorunlu, (c) Hiç pause yapma
- **Status:** **PENDING**
- **Owner:** Ürün direktörü
- **Target timing:** Jira sync (BACKLOG P4 / OD-051) implement edilmeden önce
- **Source:** PRODUCT_SPEC.md §15 line 229 ("Jira → SLA pause — Netleştirilmeli")

### OD-002 — Closed vs Solved durumu
- **Decision:** Müşteri kabul mekanizması gelirse `Cozuldu` ikiye ayrılsın mı (`Resolved` + `Closed`)?
- **Status:** **DEFERRED**
- **Target timing:** Phase 6 — customer acceptance portalı şipse aktif olur
- **Source:** planning_cards/WR-D4-D3-RESOLUTION-APPROVAL-NOTIFICATION-RULES.md §21 #9

### OD-003 — Çözüm öncesi eksik bilgi gate'i
- **Decision:** §9 Eksik Bilgi Tespiti (`CategoryRequiredInfo`) çözüm öncesi denetimi **engelle** mi yoksa **uyar** mı?
- **Options:** (a) hard block (b) soft warning (c) tenant-config
- **Status:** **PENDING**
- **Owner:** Ürün direktörü
- **Target timing:** P3 backlog item başlarken
- **Source:** FAZ2_COLLAB_SPEC.md §9; mirrored in BACKLOG P3 "§9 Eksik Bilgi Tespiti"

### OD-004 — Başarı kriteri (success_criteria) zorunluluğu
- **Decision:** `successCriteria` alanı olmadan vaka kapanabilir mi?
- **Recommended default:** Evet — opsiyonel, yalnız uyarı banner'ı
- **Status:** **PENDING**
- **Owner:** Ürün direktörü
- **Source:** FAZ2_COLLAB_SPEC.md §"Açık Karar Noktaları" → "Başarı kriteri zorunluluğu"

### OD-005 — Niyet (case_intent) güven eşiği
- **Decision:** AI confidence 0.7 altında "Belirsiz" enum mu kullanılsın?
- **Recommended default:** Evet — kullanıcı seçim yapar
- **Status:** **PENDING**
- **Owner:** Ürün direktörü
- **Source:** FAZ2_COLLAB_SPEC.md §"Açık Karar Noktaları" → "Niyet güven eşiği"

### OD-006 — Müşteri etki katsayısı ağırlığı
- **Decision:** `impactScope=Bayi Ağı` için ağırlık 3x mi daha fazla mı?
- **Recommended default:** 3x — A/B testle iyileştirilir
- **Status:** **PENDING**
- **Owner:** Ürün direktörü
- **Source:** FAZ2_COLLAB_SPEC.md §"Açık Karar Noktaları" → "Etki katsayısı"

### OD-007 — Phone uniqueness scope
- **Decision:** Telefon numarası unique constraint kapsamı ne olmalı?
- **Options:** (a) Account içinde unique (b) Company içinde unique (c) Global unique (d) Hiç unique değil, sadece format normalize
- **Status:** **RESOLVED** — (d) E.164 normalize var, DB unique constraint yok (mükerrer çoklu telefon gerçekliği için)
- **Destination:** WR-A2 shipped (planning card); ROADMAP Recent Ships "A2 VKN/TCKN/phone validation"
- **Source:** WORK_REGISTER §"Do Not Forget" #6

### OD-008 — Import create/update/skip kuralları (Phase 1)
- **Decision:** İmport sync mode'u?
- **Status:** **RESOLVED** — Phase 1: create + update (idempotent matching key = VKN); Phase 2b commit path açıldığında child entities için aynı politika
- **Destination:** WR-A8 Phase 1 shipped (PR #192)
- **Source:** WORK_REGISTER §"Do Not Forget" #7

### OD-009 — A8 Phase 2b: `isPrimary` contact uniqueness
- **Decision:** İmport sırasında ikinci `isPrimary=true` contact → son satır kazanır mı yoksa error mı?
- **Status:** **PENDING**
- **Target timing:** A8 Phase 2b kickoff (BACKLOG P2 "A8 Phase 2b Customer 360 Import commit path") öncesi
- **Source:** planning_cards/WR-A8-PHASE2-CUSTOMER-360-IMPORT.md §"Bilinçli Bırakılanlar / Açık Sorular" #1

### OD-010 — A8 Phase 2b: `isDefault` address uniqueness
- **Decision:** Aynı tip için iki default satırı → son kazanır vs error?
- **Status:** **PENDING**
- **Target timing:** A8 Phase 2b kickoff öncesi
- **Source:** planning_cards/WR-A8-PHASE2-CUSTOMER-360-IMPORT.md §"Açık Sorular" #2

### OD-011 — A8 Phase 2b: duplicate contact (aynı email) severity
- **Decision:** Warning mı error mı?
- **Recommended default:** Warning (operatör görür ama commit yapar)
- **Status:** **PENDING**
- **Target timing:** A8 Phase 2b kickoff öncesi
- **Source:** planning_cards/WR-A8-PHASE2-CUSTOMER-360-IMPORT.md §"Açık Sorular" #3

### OD-012 — A8 Phase 2b: companyCode resolution
- **Decision:** Multi-company admin için import wizard'da "hedef şirket" tek seçim mi per-row seçim mi?
- **Recommended default:** Tek seçim (Phase 1 ile uyumlu)
- **Status:** **PENDING**
- **Target timing:** A8 Phase 2b kickoff öncesi
- **Source:** planning_cards/WR-A8-PHASE2-CUSTOMER-360-IMPORT.md §"Açık Sorular" #4

### OD-013 — A8 Phase 2b: date format esnekliği
- **Decision:** ISO 8601 zorunlu mu yoksa "DD.MM.YYYY" TR format da kabul mu?
- **Recommended default:** İkisini de kabul eden normalizer; ambiguous (örn. 03/04/2026) → error
- **Status:** **PENDING**
- **Target timing:** A8 Phase 2b kickoff öncesi
- **Source:** planning_cards/WR-A8-PHASE2-CUSTOMER-360-IMPORT.md §"Açık Sorular" #6

### OD-014 — A8 Phase 2b: composite schema version
- **Decision:** Schema versiyon hash mi tarih+counter mı?
- **Recommended default:** Tarih+counter (`2026-05-22.customer360.v1`) — okuması kolay, drift tespiti net
- **Status:** **PENDING**
- **Target timing:** A8 Phase 2b kickoff öncesi
- **Source:** planning_cards/WR-A8-PHASE2-CUSTOMER-360-IMPORT.md §"Açık Sorular" #7

### OD-015 — `policy.reopenRequiresReApproval`
- **Decision:** Reopen sonrası yeniden onay gerekir mi?
- **Status:** **PENDING (Phase 2 field)**
- **Target timing:** Resolution Approval Phase 2 başlarken
- **Source:** planning_cards/WR-D4-D3-RESOLUTION-APPROVAL-NOTIFICATION-RULES.md §21 #11

---

## 2. Tenant / Security / Privacy

### OD-020 — TCKN saklama stratejisi
- **Decision:** TCKN nasıl saklanmalı?
- **Options:** (a) Clear text + DB encryption (b) HMAC hash + lookup (c) Masked + last-4 query (d) Saklama yapmama, sadece validation
- **Status:** **RESOLVED** — (b)+(c) hybrid: `HMAC-SHA256 + last4` + masked display only; plain TCKN/tcknHash response'larda asla görünmez
- **Destination:** WR-A2 shipped (PR #159, commit `a22ddf1`); planning card; ROADMAP Recent Ships
- **Source:** WORK_REGISTER §"Do Not Forget" #1; PRODUCT_SPEC §15

### OD-021 — OpenAI DPA (KVKK)
- **Decision:** OpenAI ile KVKK uyumlu data processing agreement netleştirilmesi
- **Status:** **PENDING**
- **Owner:** Hukuk ekibi + Ürün direktörü
- **Target timing:** Production rollout öncesi (mevcut tek tenant Univera için risk düşük)
- **Source:** PRODUCT_SPEC.md §15 ("OpenAI DPA — Hukuk ekibi")

### OD-022 — TCKN DPO read trail / audit log
- **Decision:** TCKN read/write audit log nasıl tutulmalı?
- **Options:** (a) Ayrı `TCKNAuditLog` tablosu (b) Mevcut `AIUsageLog` benzeri pattern reuse (c) Generic `AuditEvent` tablosu (her hassas read)
- **Recommended default:** (a) — TCKN-spesifik ayrı tablo daha denetim dostu
- **Status:** **PENDING**
- **Owner:** DPO + Ürün direktörü
- **Target timing:** BACKLOG P1 "TCKN DPO read trail / audit log" başlarken
- **Source:** planning_cards/MASTER_DATA_DECISION_SPRINT.md §Open Questions; mirrored in BACKLOG P1

### OD-023 — TCKN_HASH_PEPPER rotation owner + mekanizma
- **Decision:** Pepper kim üretip yönetir, rotation nasıl yapılır?
- **Options:** (a) System admin manuel (.env) (b) KMS (Supabase Vault / GCP / AWS) (c) Forward-only rotation (eski hash'ler sealed kalır)
- **Status:** **PENDING**
- **Owner:** Security / Ürün direktörü
- **Target timing:** İlk pepper rotation (yıllık veya security incident); TECHNICAL_DEBT "TCKN pepper rotation owner / runbook" item'i bu kararı bekliyor
- **Source:** planning_cards/MASTER_DATA_DECISION_SPRINT.md §Open Questions

### OD-024 — Kiracı AI anahtarı şifreleme
- **Decision:** CompanySettings'e `aiApiKey` eklenirse şifreleme nereden?
- **Recommended default:** Supabase Vault
- **Status:** **PENDING (DEFERRED)**
- **Target timing:** ROADMAP "Commercialization — Multi-tenant AI key" trigger: ikinci paying tenant
- **Source:** FAZ2_COLLAB_SPEC.md §"Açık Karar" → "Kiracı AI anahtarı şifreleme"

### OD-025 — Public form (CaseInfoRequest) auth modeli
- **Decision:** Müşterinin doldurabileceği public form için auth?
- **Options:** (a) Token URL (TTL'li) (b) Magic link (e-posta tıkla) (c) OTP (e-posta + 6-haneli kod) (d) Hiçbiri — sadece e-posta reply
- **Status:** **PENDING**
- **Owner:** Ürün direktörü + DPO (KVKK)
- **Target timing:** BACKLOG P3 "CaseInfoRequest / Bilgi Bekleniyor flow" (WR-C8) başlarken
- **Source:** WORK_REGISTER §"Do Not Forget" #15; planning_cards (WR-C8 not yet authored)

### OD-026 — Auth domain restriction
- **Decision:** Authentication'da domain whitelist gerekli mi?
- **Options:** (a) Google Console domain restriction (b) `server/db/auth.js`'a app-layer domain check (c) Yok — her domain ile giriş
- **Status:** **PENDING (DEFERRED)**
- **Target timing:** İkinci paying tenant onboarding (BACKLOG P4 "Auth domain restriction")
- **Source:** AUTH_SETUP.md §4d

---

## 3. AI / Automation

### OD-030 — Pattern aksiyon önerisi kaynağı
- **Decision:** PatternAlert detail UI aksiyon önerileri nereden gelmeli?
- **Options:** (a) Static (kategori → öneri eşleşmesi) (b) AI-generated (c) Hybrid
- **Status:** **PENDING**
- **Owner:** Ürün direktörü
- **Target timing:** BACKLOG P4 "PatternAlert detail / action source decision" (WR-F6) başlarken
- **Source:** WORK_REGISTER §"Do Not Forget" #14

### OD-031 — §5.5 Bekçi AI scope vs PatternAlert overlap
- **Decision:** "Saatlik durmuş vaka hatırlatıcı" PatternAlert ile overlap mi yoksa yeni cron mu?
- **Options:** (a) Aynı işin reformulation'ı (PatternAlert'i rename) (b) Yeni cron, distinct sinyal
- **Status:** **PENDING**
- **Owner:** Ürün direktörü + Eng
- **Target timing:** BACKLOG P3 "Bekçi AI scope clarification" başlarken
- **Source:** FAZ2_COLLAB_SPEC.md §5.5

### OD-032 — Duygu tonu önbelleği
- **Decision:** Sentiment AI çağrısı her not için mi toplu mu?
- **Recommended default:** Toplu (5 dk gecikme) — maliyet
- **Status:** **PENDING**
- **Owner:** Ürün direktörü + Eng (cost)
- **Target timing:** BACKLOG P3 "§8 Duygu Tonu Analizi" başlarken
- **Source:** FAZ2_COLLAB_SPEC.md §"Açık Karar"

### OD-033 — Risk Lens ağırlıkları
- **Decision:** Sabit ağırlıklar mı ML mi?
- **Recommended default:** İlk versiyon sabit ağırlık; Faz 3'te ML evaluation
- **Status:** **DEFERRED**
- **Target timing:** Faz 3 (Risk Lens sonrası A/B testle gözlem)
- **Source:** FAZ2_COLLAB_SPEC.md §"Açık Karar"

### OD-034 — AI Brief sticky vs dismiss
- **Decision:** AI Brief kartı dismiss sonrası kullanıcı manuel mi açsın?
- **Recommended default:** Sticky + dismiss → 24h hide
- **Status:** **PENDING**
- **Owner:** Ürün direktörü
- **Source:** OPS §7 Q15

### OD-035 — AI Report tone presetleri
- **Decision:** "executive" + "operational" yeterli mi, ek preset gerek mi (technical / detailed / summary)?
- **Status:** **PENDING**
- **Owner:** Ürün direktörü
- **Source:** OPS §7 Q16

### OD-036 — AI Report narrative language
- **Decision:** Default Türkçe; çok dilli (TR/EN) ne zaman?
- **Recommended default:** Phase 4 (lens'lerle birlikte language toggle); şimdilik Türkçe
- **Status:** **DEFERRED**
- **Source:** OPS §7 Q17

### OD-037 — AI feedback (👍/👎) sonuç kullanımı
- **Decision:** Feedback prompt iyileştirme için mi yoksa sadece monitoring mu?
- **Recommended default:** Monitoring (Phase 5+ fine-tune değerlendirilir)
- **Status:** **DEFERRED**
- **Source:** OPS §7 Q20

### OD-038 — Insight tetik eşikleri (SLA +20%, Backlog +15%, ...)
- **Decision:** Eşikler config'e mi (admin tunable) yoksa kodda mı?
- **Status:** **PENDING**
- **Owner:** Ops Manager domain expert + Eng
- **Source:** OPS §7 Q21

### OD-039 — AI Brief — admin role cross-tenant insight
- **Decision:** CSLeadership için cross-tenant insight ("PARAM SLA Univera'ya göre 2× kötü") mi yoksa her tenant ayrı mı?
- **Status:** **PENDING**
- **Owner:** Ürün direktörü
- **Source:** OPS §7 Q19

### OD-040 — People-safe forbidden list bakımı
- **Decision:** Yasak terim listesi config dosyasında mı (admin tunable) yoksa kodda mı?
- **Recommended default:** Kodda (audit + review zorunlu)
- **Status:** **PENDING**
- **Source:** OPS §7 Q18

### OD-041 — AI Fabric — Agent rol görünürlüğü
- **Decision:** Agent için AI yüzeyi ne kadar görünür?
- **Options:** (a) Sadece kişisel explainer ("Bu metrikim ne anlama geliyor?") (b) AI Fabric tamamen Supervisor+ (c) Agent'a contextual actions açık
- **Status:** **PENDING**
- **Owner:** Ürün direktörü
- **Source:** OPS §7 Q23

---

## 4. Notifications / Communication

### OD-050 — WebSocket vs polling
- **Decision:** Uygulama içi bildirim için 30sn polling yeterli mi yoksa WebSocket gerek mi?
- **Recommended default:** Faz 2: polling → Faz 3: WebSocket gerekirse
- **Status:** **DEFERRED**
- **Target timing:** Yakın-vade revisiting beklenmiyor (Action Center silent polling kararı verildi)
- **Source:** FAZ2_COLLAB_SPEC.md §"Açık Karar"; ROADMAP "Scale — Real-time refresh"

### OD-051 — Active e-posta sağlayıcı seçimi
- **Decision:** İlk active sender hangi sağlayıcı?
- **Options:** (a) Resend.com (b) Tenant SMTP (c) In-house SMTP
- **Recommended default:** Resend.com (basit API, KVKK uyumlu DPA tahmini)
- **Status:** **PENDING**
- **Owner:** Ürün direktörü
- **Target timing:** BACKLOG P2 "Resend email MVP" başlarken
- **Source:** FAZ2_COLLAB_SPEC.md §"Açık Karar"; planning_cards/WR-D4-D3 §21 #6

### OD-052 — SMS sağlayıcısı
- **Decision:** SMS provider seçimi?
- **Options:** NetGSM / İletimerkezi / başka
- **Recommended default:** Yerel operatör (NetGSM/İletimerkezi)
- **Status:** **DEFERRED**
- **Target timing:** Resend MVP'den sonra (ROADMAP "Notification — Channel matrix + businessHours + daily digest" altında)
- **Source:** FAZ2_COLLAB_SPEC.md §"Açık Karar"

### OD-053 — Takipçi günlük digest saati
- **Decision:** Sabit 09:00 mu kullanıcı tercihi mi?
- **Recommended default:** Varsayılan 09:00, kullanıcı override edebilir
- **Status:** **PENDING**
- **Target timing:** ROADMAP "Notification daily digest" item'i implementation öncesi
- **Source:** FAZ2_COLLAB_SPEC.md §"Açık Karar"

### OD-054 — Notification event taxonomy + tenant override scope
- **Decision:** Event listesi kod-tarafı kapalı mı admin-tarafı açık mı?
- **Status:** **RESOLVED** — D3 Phase 1/2 ship sırasında event taxonomy kod-tarafı belirlendi; tenant template/rule override hem rule hem template seviyesinde
- **Destination:** WR-D3 Level A shipped (PR #263/#264/#265); planning_cards/WR-D4-D3 §21 #7
- **Source:** WORK_REGISTER §"Do Not Forget" #9

### OD-055 — Customer notification timing
- **Decision:** Müşteri bildirimi onayla aynı anda mı sonrası mı?
- **Status:** **RESOLVED** — Onay sonrası, ayrı event (`customer_notification_created`). Onay tek başına müşteriye haber göndermez.
- **Destination:** WR-D4 Level A shipped; planning_cards/WR-D4-D3 §21 #4

### OD-056 — Agent self-approval default
- **Decision:** Politika oluşturmadan default agent kendi vakasını onaylayabilir mi?
- **Status:** **RESOLVED** — Default `false`. Politika başına opt-in (`allowSelfApprove`).
- **Destination:** WR-D4 Level A shipped; planning_cards/WR-D4-D3 §21 #1

### OD-057 — Approval required default
- **Decision:** Approval default zorunlu mu politika varlığı tetik mi?
- **Status:** **RESOLVED** — Politika varlığı tetik (simple). Tenant Admin politika oluşturmazsa flow tetiklenmez. `Company.resolutionApprovalEnabled` flag yok.
- **Destination:** WR-D4 Level A shipped; planning_cards/WR-D4-D3 §21 #2 + #10

### OD-058 — UI status etiketleri (approval)
- **Decision:** Onay UI'da hangi etiketler?
- **Status:** **RESOLVED** — "İç Onay Bekliyor" + "Onaylandı" + "Reddedildi"; "Müşteri" sözcüğü iç onayda yok.
- **Destination:** WR-D4 Level A shipped; planning_cards/WR-D4-D3 §21 #3

### OD-059 — Rejection sonrası vaka davranışı
- **Decision:** Onay reddedilince vaka nereye gider?
- **Status:** **RESOLVED** — `rejectionBehavior` enum: `ReturnToAssignee` (default) / `ReturnToTeam` / `Escalate`
- **Destination:** WR-D4 Level A shipped; planning_cards/WR-D4-D3 §21 #12

### OD-060 — Phase 2A inbox /inbox sayfası
- **Decision:** Action Center için ayrı `/inbox` route?
- **Status:** **RESOLVED (Phase 2A)** — Phase 2A'da `/inbox` açılmaz; drawer yeterli. 3 Phase-3 sorusu OD-070/071/072'de.
- **Destination:** planning_cards/WR-NOTIFICATION-CENTER §18.H

### OD-070 — Phase 3 inbox: My Home tüm rollere açık mı?
- **Decision:** CSM, Backoffice, Admin için My Home erişimi açılırsa ek wide surface ihtiyacı düşer.
- **Status:** **PENDING**
- **Target timing:** Phase 3 inbox kickoff öncesi
- **Source:** planning_cards/WR-NOTIFICATION-CENTER §18.H Phase 3 Q1

### OD-071 — Phase 3 inbox: ayrı `/inbox` sayfası mı?
- **Decision:** Wide surface universal hâle gelir; My Home erişiminden bağımsız çalışır.
- **Status:** **PENDING**
- **Target timing:** Phase 3 inbox kickoff öncesi
- **Source:** planning_cards/WR-NOTIFICATION-CENTER §18.H Phase 3 Q2

### OD-072 — Phase 3 inbox: Admin / SystemAdmin için inbox nerede?
- **Decision:** My Home içinde mi, ayrı bir admin yüzeyinde mi, drawer mı yeterli?
- **Status:** **PENDING**
- **Target timing:** Phase 3 inbox kickoff öncesi
- **Source:** planning_cards/WR-NOTIFICATION-CENTER §18.H Phase 3 Q3

### OD-073 — ActionItem Done retention
- **Decision:** Done satırları kaç gün sonra archive?
- **Recommended default:** 30 gün → cold storage (`ActionItemArchive` tablosu veya `archivedAt` alanı)
- **Status:** **RESOLVED** — 30 gün karar verildi; cron implementation BACKLOG P2 "ActionItem Done retention / archive cron" item'inde
- **Destination:** BACKLOG P2 + planning_cards/WR-ACTION-CENTER §20 #5 + WR-NOTIFICATION-CENTER §18.F
- **Source:** Multi-card consensus

---

## 5. Analytics / Reporting

### OD-080 — Granularity hour vs day
- **Decision:** Time-series chart için zaman aralığı seçimi?
- **Recommended default:** Otomatik — aralık ≤7g → hour, fazla → day
- **Status:** **PENDING**
- **Source:** OPS §7 Q1

### OD-081 — Top N kaç olsun
- **Decision:** Top 10 takım / top 20 kategori / top 10 müşteri yeterli mi?
- **Recommended default:** 10 ile başla; "Tümünü gör" link drill-down açar
- **Status:** **PENDING**
- **Source:** OPS §7 Q2

### OD-082 — Eski "Vaka Raporları" page'i ne olacak?
- **Decision:** Operations Dashboard yeni page ile aynı sidebar entry'sine devralacak mı, deprecated banner mı?
- **Status:** **PENDING**
- **Source:** OPS §7 Q4

### OD-083 — AI insight prompt versionlama
- **Decision:** `promptVersion` response'a eklensin mi (client cache invalidation için)?
- **Recommended default:** Evet, `promptVersion: "v1"` alanı
- **Status:** **PENDING**
- **Source:** OPS §7 Q5

### OD-084 — CSLeadership rolü
- **Decision:** `User.role` enum'a `CSLeadership` mi eklensin yoksa `crossTenantAnalytics` Boolean flag mı?
- **Recommended default:** Enum (§2.2A seçimi)
- **Status:** **PENDING**
- **Owner:** Onay bekliyor
- **Source:** OPS §7 Q6

### OD-085 — Supervisor takım eşlemesi
- **Decision:** Supervisor → yönettiği takımlar lookup'ı?
- **Options:** (a) `UserCompany.role='Supervisor'` olduğu şirketin **tüm** takımları (geniş) (b) `Person/Team` modeline `supervisorId` eklemek (precise, migration gerek)
- **Status:** **PENDING**
- **Source:** OPS §7 Q7

### OD-086 — Drilldown 403 vs silent narrow
- **Decision:** Agent başka takım için drill-down isterse 403 mı silent 0-result + scope metadata mı?
- **Recommended default:** Silent narrow + scope metadata
- **Status:** **PENDING**
- **Source:** OPS §7 Q8

### OD-087 — `firstResponseTimeMin` field migration
- **Decision:** Schema migration + cron backfill mi gizli/disabled metric mi?
- **Status:** **PENDING**
- **Target timing:** BACKLOG P2 "firstResponseTimeMin metric instrumentation" başlarken
- **Source:** OPS §7 Q9

### OD-088 — `avgTtrHours` pause çıkarımı
- **Decision:** Pause süresi çıkarılıyor; wall-clock alternatif (`avgTtrWallClockHours`) eklenmeli mi?
- **Status:** **PENDING**
- **Owner:** PM beklentisi
- **Source:** OPS §7 Q10

### OD-089 — `reopenRatePct` denominator (Resolved-based)
- **Decision:** Period içinde çözülen vakalardan kaçı sonradan reopen oldu?
- **Status:** **RESOLVED (Phase 1)** — Resolved-based payda kabul edildi. Quality signal semantiği ile uyumlu.
- **Destination:** OPS §2.6.2 reopenRatePct
- **Source:** OPS §7 Q11

### OD-090 — `MetricQueryAudit` retention
- **Decision:** Audit row'ları sınırsız mı yoksa 90 gün cleanup cron mu?
- **Status:** **PENDING**
- **Target timing:** ROADMAP "Admin Tooling — Audit replay UI" başlarken
- **Source:** OPS §7 Q12

### OD-091 — Min sample thresholds (n=5/10/20)
- **Decision:** §2.6.2'deki tahmini değerler domain expert tarafından onay
- **Status:** **PENDING**
- **Owner:** Ops Manager / HR onay (QA score için özellikle)
- **Source:** OPS §7 Q13

### OD-092 — `BacklogSnapshot` cron timing
- **Decision:** Phase 5 opsiyonel olarak işaretlendi; daha erken çekilebilir mi?
- **Status:** **PENDING**
- **Target timing:** BACKLOG P3 "backlogChangePct — BacklogSnapshot tablosu" karar bağımlısı
- **Source:** OPS §7 Q14

### OD-093 — PDF rendering altyapısı
- **Decision:** Puppeteer mı pdfkit mı?
- **Options:** Puppeteer (layout güvenilir, ağır) / pdfkit (hızlı, az feature)
- **Status:** **PENDING**
- **Target timing:** REPORT_STUDIO_BACKLOG P1 "Server-side PDF" başlarken
- **Source:** OPS §7 Q31

### OD-094 — Async export job kuyruğu
- **Decision:** Job queue altyapısı?
- **Options:** (a) Supabase Postgres `ExportJob` + cron worker (b) Vercel Cron + 1 endpoint (c) ayrı microservice
- **Status:** **PENDING**
- **Source:** OPS §7 Q32

### OD-095 — Report retention
- **Decision:** `ReportGenerationLog` retention — 1 yıl mı 3 yıl mı (HR/audit talepleri)?
- **Status:** **PENDING**
- **Source:** OPS §7 Q33

### OD-096 — Scope label lokalizasyonu
- **Decision:** Türkçe rapor → Türkçe label otomatik mi user choice mı?
- **Status:** **PENDING**
- **Source:** OPS §7 Q34

### OD-097 — Mail draft (.eml) → SMTP gönderme
- **Decision:** Doğrudan SMTP send (Phase 6+) eklensin mi?
- **Status:** **DEFERRED**
- **Target timing:** Phase 6+ (mail kanal altyapısı şipse)
- **Source:** OPS §7 Q35

### OD-098 — "Pure deterministic" mod UI etiketi
- **Decision:** AI'sız raporun UI etiketi?
- **Options:** "AI narrative dahil değil" / "Yalnız deterministik" / "Raw KPI raporu"
- **Status:** **PENDING**
- **Source:** OPS §7 Q38; REPORT_STUDIO_BACKLOG §"Acik Urun Kararlari"

### OD-099 — Drill-down evidence rapor içinde
- **Decision:** caseNumber linki mi yoksa full case detayı embed mi?
- **Status:** **PENDING**
- **Source:** OPS §7 Q39

### OD-100 — Audit footer "düzenlemeler"
- **Decision:** AI çıktısı kullanıcı tarafından modifiye edilirse footer'da "Düzenlendi" notu zorunlu mu?
- **Recommended default:** Evet — şeffaflık için
- **Status:** **PENDING**
- **Source:** OPS §7 Q40

---

## 6. Integrations

### OD-110 — Jira sync mekanizması
- **Decision:** 10dk cron poll mu webhook mu?
- **Options:** (a) 10dk cron poll (b) Webhook + cron fallback (c) Sadece webhook
- **Status:** **PENDING**
- **Owner:** Eng + Ürün direktörü
- **Target timing:** BACKLOG P4 "Jira 10-min sync (WR-E2)" başlarken
- **Source:** WORK_REGISTER §"Do Not Forget" #10

### OD-111 — Jira resolved-then-reopened davranışı
- **Decision:** Reopen olunca yeni issue mi eski issue reopen mi?
- **Options:** (a) Yeni issue + link (b) Eski issue reopen + comment (c) Agent'a bırak (modal)
- **Status:** **PENDING**
- **Target timing:** BACKLOG P4 "Jira reopen policy (WR-E3)"
- **Source:** WORK_REGISTER §"Do Not Forget" #11

### OD-112 — AloTech sözleşme + credential modeli
- **Decision:** Tenant başına API key, single key all-tenants, OAuth?
- **Status:** **PENDING**
- **Owner:** Eng + Ürün direktörü
- **Target timing:** AloTech sözleşme onayı
- **Source:** WORK_REGISTER §"Do Not Forget" #12

### OD-113 — Caller ID → Account match stratejisi
- **Decision:** Strict (tam eşleşme) / Fuzzy (telefon + segment) / Disambiguation modal her zaman?
- **Status:** **PENDING**
- **Owner:** Ürün direktörü (false-match risk)
- **Target timing:** BACKLOG P4 "Incoming call auto-open (WR-E5)"
- **Source:** WORK_REGISTER §"Do Not Forget" #13

### OD-114 — AD/Emakin enterprise SSO provider
- **Decision:** Identity provider seçimi?
- **Options:** Azure AD / Okta / Emakin
- **Status:** **PENDING**
- **Owner:** Ürün direktörü (enterprise sözleşme)
- **Target timing:** UNIVERA enterprise sözleşme veya ilk enterprise tenant
- **Source:** WORK_REGISTER §"Do Not Forget" — implicit (B4)

---

## 7. Architecture / Operations

### OD-130 — Repo default base branch
- **Decision:** Repo default base `dev`'e çevirilsin mi (bugün `main`)?
- **Context:** Dual-path Git Flow workaround sürekli operasyonel maliyet. GitHub Settings → Default branch tek tıkla çözer.
- **Status:** **PENDING**
- **Owner:** GitHub Admin
- **Target timing:** Tek seferlik ayar
- **Source:** TECHNICAL_DEBT "Repo default base = main / dual-path workaround"

### OD-131 — Vercel Hobby → Pro upgrade
- **Decision:** Cron limiti aşılırsa Pro'ya geçilsin mi?
- **Status:** **PENDING (cost gate)**
- **Owner:** Ürün direktörü (billing)
- **Source:** ROADMAP "Infra — Vercel Hobby → Pro cron geçişi"

### OD-132 — Supabase Hobby → Pro upgrade
- **Decision:** Pooler aksaklığı 2. kez 30dk+ sürerse Pro'ya geçilsin mi ($25/ay)?
- **Status:** **PENDING (cost gate)**
- **Owner:** Ürün direktörü + Eng
- **Source:** INCIDENTS.md §3.1

### OD-133 — MSSQL portability migration plan
- **Decision:** MSSQL'e geçiş ne zaman ve nasıl?
- **Status:** **DEFERRED**
- **Target timing:** Customer talep ederse (mevcut tek tenant: PostgreSQL yeterli)
- **Source:** SUPABASE_SETUP.md §"MSSQL'e geçiş"

### OD-134 — `firstAgentResponseAt` schema migration vs disabled metric
- **Decision:** Schema migration + cron backfill mi yoksa "Eklenince aktif" disabled metric mi?
- **Status:** **PENDING**
- **Target timing:** BACKLOG P2 "firstResponseTimeMin" başlarken
- **Source:** OPS §7 Q9 (duplicate of OD-087)

### OD-135 — Account-Company relationship CRUD endpoint
- **Decision:** Account ↔ Company ilişki güncellemesi ayrı endpoint mi olacak?
- **Status:** **DEFERRED**
- **Target timing:** Account merge öncesi (ROADMAP Phase F)
- **Source:** API.md `PATCH /api/accounts/:id` note

### OD-136 — Cross-lens drill-down davranışı
- **Decision:** Customer lens'te bir müşteriye tıkladığında Operations lens'e mi geçeyim yoksa aynı lens'te mi kalayım?
- **Recommended default:** Aynı lens'te kal; "Operasyonu Gör" butonu lens switch yapsın
- **Status:** **PENDING**
- **Source:** OPS §7 Q30

### OD-137 — Lens cache stratejisi
- **Decision:** 4× cache key (snapshot+lens) kabul mü yoksa tek prompt + lens formatting mı?
- **Status:** **PENDING**
- **Source:** OPS §7 Q28

### OD-138 — Lens-specific report otomatik üretim
- **Decision:** 4 şablon Studio'da on-demand mı "Pazartesi otomatik üret + arşivle" da mı?
- **Status:** **DEFERRED**
- **Target timing:** Phase 5+
- **Source:** OPS §7 Q29

### OD-139 — Snooze cron mu lazy mi
- **Decision:** Action Center snooze release: 5dk cron mu lazy on-read mi?
- **Status:** **RESOLVED (Phase 1)** — Lazy on-read; Phase 2'de cron eklendi
- **Destination:** planning_cards/WR-ACTION-CENTER §20 #2

### OD-140 — Approval override sonrası approver inbox
- **Decision:** Override yapılınca sibling approver'lar nasıl temizlenir?
- **Status:** **RESOLVED (Phase 1)** — Hepsi `Expired`. Phase 2'de override yapan kişiye "Override yapıldı" FYI eklenebilir.
- **Destination:** planning_cards/WR-ACTION-CENTER §20 #3

### OD-141 — "Bekleyen onayım" widget heuristic
- **Decision:** Mevcut "pendingApprovals" heuristic'in yerini alır mı?
- **Status:** **RESOLVED (Phase 1)** — Replace + heuristic widget rename "Önerilen Aksiyonlar" (mevcut algoritma korunur)
- **Destination:** planning_cards/WR-ACTION-CENTER §20 #4

### OD-142 — Action Center cross-tenant SystemAdmin aggregate
- **Decision:** SystemAdmin için cross-tenant toplam görünür mü?
- **Status:** **RESOLVED (Phase 1)** — Evet, minik kazanım
- **Destination:** planning_cards/WR-ACTION-CENTER §20 #6

### OD-143 — "InProgress" auto-transition vs manuel
- **Decision:** Vaka CaseDetail açılınca otomatik mi InProgress'e geçsin?
- **Status:** **RESOLVED (Phase 1)** — Auto on CaseDetail open; Phase 3'te toggle UI eklenebilir
- **Destination:** planning_cards/WR-ACTION-CENTER §20 #7

### OD-144 — Bell'de 2 sayaç (action + FYI) vs 1 toplam
- **Decision:** Action sayacı ile FYI sayacı ayrı mı?
- **Status:** **RESOLVED (Phase 1)** — 2 ayrı sayaç (Slack/Linear convention)
- **Destination:** planning_cards/WR-ACTION-CENTER §20 #8

---

## 8. UX / Help / Quality

### OD-160 — Mobile responsive yatırım seviyesi
- **Decision:** Dashboard tablet (768-1024px) için ne kadar adapte? Yöneticiler tablet kullanır mı?
- **Status:** **PENDING**
- **Source:** OPS §7 Q43

### OD-161 — Page max-width 4K destek
- **Decision:** 1920+ destek gerekir mi?
- **Recommended default:** Hayır — cockpit hissi için constrained kalsın
- **Status:** **PENDING**
- **Source:** OPS §7 Q42

### OD-162 — Storybook / component docs
- **Decision:** Premium primitive'ler için Storybook kurulsun mu?
- **Status:** **DEFERRED**
- **Target timing:** Phase 5+
- **Source:** OPS §7 Q44

### OD-163 — Auto-refresh kuralı override
- **Decision:** "5dk'da bir otomatik yenilesin" kullanıcı tercihi olarak açılabilir mi?
- **Recommended default:** Hidden setting olarak yes
- **Status:** **PENDING**
- **Source:** OPS §7 Q45

### OD-164 — Subjective "premium hissi" kalite kontrolü
- **Decision:** PR review'da kim "anti-pattern var" diye işaretler?
- **Recommended default:** PR template'inde checklist (PR açan + reviewer)
- **Status:** **PENDING**
- **Source:** OPS §7 Q46

### OD-165 — Animation library
- **Decision:** Framer Motion (+30KB bundle) eklensin mi yoksa Tailwind yeterli mi?
- **Recommended default:** Tailwind yeterli; Framer sadece drawer slide gibi karmaşık karelerde gerekirse
- **Status:** **PENDING**
- **Source:** OPS §7 Q47

### OD-166 — Print stylesheet timing
- **Decision:** §2.11.7 print-friendly @media Phase 2'de mi Phase 5+'da mı?
- **Recommended default:** Defer; PDF export geldiğinde print'e ihtiyaç azalır
- **Status:** **DEFERRED**
- **Source:** OPS §7 Q48

### OD-167 — Accessibility (a11y) hedefi
- **Decision:** WCAG 2.1 AA tüm dashboard? Screen reader uyumu? Dedicated audit Phase 5'te mi?
- **Status:** **PENDING**
- **Target timing:** Kurumsal müşteri a11y şartnamesi (BACKLOG/ROADMAP Known Limitations)
- **Source:** OPS §7 Q49

### OD-168 — Empty state copy lokalizasyonu
- **Decision:** İngilizce desteklenecekse her empty state için EN string + i18n setup ne zaman?
- **Recommended default:** Phase 4c (lens'lerle birlikte language toggle)
- **Status:** **DEFERRED**
- **Source:** OPS §7 Q50

### OD-169 — Command Strip default state
- **Decision:** Sticky band default expanded mi collapsed mi başlasın (cognitive overload R24)?
- **Recommended default:** Collapsed
- **Status:** **PENDING**
- **Source:** OPS §7 Q22

### OD-170 — `<RunaSurface>` primitive yeniden kullanım
- **Decision:** Eski `RunaAiCard`/`RunaAiChatPanel` replace mi yan yana mı?
- **Context:** Eski component'ler dead code (BACKLOG P1 cleanup); refactor Phase 4a kapsamı.
- **Status:** **PARTIALLY RESOLVED** — Eski component'ler dead, BACKLOG P1 cleanup item'ı buna işaret ediyor; Phase 4a tamamlanmadığı için yeni `RunaSurface` primitive de gelmedi
- **Source:** OPS §7 Q25

### OD-171 — Lens default örtüşmesi
- **Decision:** "Operations" rolündeki kullanıcı "Customer" lens'i kullanabilir mi?
- **Recommended default:** Read-only (§2.9.8 işareti)
- **Status:** **PENDING**
- **Source:** OPS §7 Q27

### OD-172 — Persona enum (Product Manager / Customer Success Lead)
- **Decision:** Bu rolleri `User.role` enum'a eklemek mi?
- **Status:** **OBSOLETE** — Karar verildi: EKLENMEZ. `server/analytics/scopeDerivation.js:14` kodda açıkça reddediyor. Bu roller flag/scope ile yönetilir, enum genişlemez.
- **Destination:** BACKLOG "Closed — Decision-recorded"; scopeDerivation.js:14
- **Source:** OPS §7 Q26

### OD-173 — 5-kullanıcı oturum testi planı
- **Decision:** Phase 2 sonrası kim test eder, hangi sürede, feedback yöntemi?
- **Status:** **PENDING**
- **Source:** OPS §7 Q41

---

## Cross-references summary

Bu register'da decisions'ların kaynak doc'larından otomatik link verilmiştir. Source doc'lardaki orijinal metin **silinmedi**; bu PR'da yalnız "see OPEN_DECISIONS.md" cross-reference notu eklendi. PR-D (PRODUCT_SPEC refresh) sırasında orijinal kararlar bu canonical register'a migrate edilecek.

İlgili canonical doc'lar:
- [docs/BACKLOG.md](BACKLOG.md) — aktif iş; her NEEDS_DECISION item'ı OD-XXX referansı içerir (PR-B'de eklendi)
- [docs/ROADMAP.md](ROADMAP.md) — gelecek yön + Recent Ships
- [docs/TECHNICAL_DEBT.md](TECHNICAL_DEBT.md) — engineering risk
- [docs/REPORT_STUDIO_BACKLOG.md](REPORT_STUDIO_BACKLOG.md) — Report Studio P0-P3
- [docs/QUALITY_GATES.md](QUALITY_GATES.md) — change-type başına gate matrisi

---

## How to use this register

**Açık karar bekleyen iş kalemine başlamadan önce:**
1. PR Planning Card hazırlanırken bu register'da NEEDS_DECISION item'ı varsa **önce karar alınmalı**
2. Karar alındığında: Status `PENDING → RESOLVED`, Destination satırı doldurulur (örn. "WR-XX shipped commit `abc1234`")
3. Karar bilinçli erteliyse: Status `PENDING → DEFERRED`, Target timing satırı trigger koşulunu yazar
4. Premise çürürse: Status `OBSOLETE`, kısa "geçersiz oldu çünkü ..." notu

**Yeni karar gerektiğinde:**
- Uygun area altına yeni `OD-XXX` ID atayarak ekle (her area kendi 010-bloğunda; 1xx geniş bloklarda)
- Source satırı yeni karar'ı doğuran context'i göstersin (ör. backlog item, planning card, incident)

**Audit cycle:**
- Her major release sonrası 5 dakikalık taram: PENDING/DEFERRED hâlâ valid mi? RESOLVED item'ların Destination'ları canlı mı?
- Backlog Reality Audit pattern'inde (2026-05-27) bu register taranır.
