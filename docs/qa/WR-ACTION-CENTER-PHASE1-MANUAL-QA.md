# WR-ACTION-CENTER Phase 1 — Manuel QA Çek-listesi

> **Kapsam:** Approval Visibility MVP — yalnız 3 ActionItem kind (approval_pending / approval_decided / case_returned_to_assignee), bell + drawer + MyHome paneli.
> **Hedef:** Tek bir QA operatörünün, Team Lead onay görünürlüğü gap'inin pratikte kapandığını doğrulaması.
> **Ortam:** Dev veya pilot tenant.
> **Son güncelleme:** 2026-05-29

---

## Ön koşullar

- [ ] Pilot tenant'a en az bir **Çözüm Onayı Politikası** (örn. `approverType=AssignedTeamLead`) tanımlı.
- [ ] Pilot tenant'ta **Agent** + **Team Lead** (Person.isTeamLead=true) hesapları var.
- [ ] Feature flag `VITE_ACTION_CENTER_ENABLED=true` (dev'de varsayılan ON).

---

## A. Bell ve drawer görünürlüğü

### A.1 İki sayaç

- [ ] Header'da **iki bell ikonu** görünür:
  - Soldaki **Eylem Merkezi** (yeni — `ListChecks` ikonu)
  - Sağdaki **MentionBellBadge** (mevcut)
- [ ] Eylem Merkezi ikonu, üzerinde **kırmızı (action) + gri (FYI)** iki pill gösterir; sayaç sıfırsa pill görünmez.
- [ ] Hover tooltip: "X eylem bekliyor, Y bildirim".

### A.2 Drawer

- [ ] Eylem Merkezi ikonuna tıkla → sağdan **ActionCenterDrawer** açılır (~360-380px genişlik).
- [ ] Header: "Eylem Merkezi — Sana atanmış işler ve bildirimler".
- [ ] 4 tab: **Eylem Bekleyen** / **Bildirimler** / **Ertelenen** / **Yapıldı**.
- [ ] ESC tuşu drawer'ı kapatır.
- [ ] Mobil görünüm: tam ekran + arka plan tıklayınca kapanır.

---

## B. Happy path — Team Lead approval inbox

### B.1 Agent vakayı onaya gönderir

- [ ] Agent yeni bir vaka aç, kategori/öncelik politikanın `matchScope`'ı ile uyumlu.
- [ ] Vakayı Team Lead'in takımına ata.
- [ ] CaseDetail'de "Çözüm Onayına Gönder" → modal → çözüm özeti yaz → Gönder.

### B.2 Team Lead inbox'ı

- [ ] Team Lead hesabıyla login.
- [ ] **MyHome'da** "Bekleyen Onaylarım" paneli görünür, içinde 1 satır var.
- [ ] Header'da Eylem Merkezi bell'inde **kırmızı sayaç = 1**.
- [ ] Bell'e tıkla → drawer açılır, **Eylem Bekleyen** tab'ında 1 satır.

### B.3 Satır içeriği

- [ ] Sol ikon: `ShieldCheck` (amber).
- [ ] Başlık: **"Çözüm Onayı Bekliyor"**.
- [ ] Vaka numarası rozet.
- [ ] reasonLabel görünür: *"Çünkü '...' politikası kapsamında onaylayıcısın."*
- [ ] Vaka başlığı kısaltılarak gösteriliyor.

### B.4 Mini-action — Vakayı Aç (auto-InProgress)

- [ ] Drawer satırında **[Vakayı Aç]** butonu tıkla.
- [ ] Drawer kapanır, CaseDetail açılır.
- [ ] Geri MyHome'a dön → "Bekleyen Onaylarım" paneli'nde aynı satır şimdi **"çalışıyor"** rozetiyle (InProgress).
- [ ] Bell sayacı hâlâ 1 (InProgress da action sayılır).

### B.5 Mini-action — Onayla

- [ ] Drawer'ı tekrar aç, [Onayla] butonuna tıkla.
- [ ] Backend approval onaylanır; satır anında **"Yapıldı"** tab'ına geçer.
- [ ] **Eylem Bekleyen** sayaç **0** olur.
- [ ] **Yapıldı** tab'ında satır görünür, outcome=approved rozeti.

### B.6 Agent FYI

- [ ] Agent hesabına geç → Eylem Merkezi bell'inde **gri sayaç = 1** (FYI band).
- [ ] Drawer'da **Bildirimler** tab'ında "Onay sonuçlandı" satırı.
- [ ] reasonLabel: *"Gönderdiğin çözüm onayı sonuçlandı: Onaylandı."*
- [ ] [Okundu] tıkla → satır Yapıldı'ya geçer; gri sayaç 0.

---

## C. Reject path (ReturnToAssignee)

### C.1 Reject

- [ ] Yeni vaka + submit (B.1'i tekrar et).
- [ ] Team Lead bu sefer drawer'da [Reddet] tıkla → inline rejection reason kutusu açılır.
- [ ] Açıklayıcı bir gerekçe yaz → [Reddet].

### C.2 Agent dual ActionItem

- [ ] Agent hesabına geç.
- [ ] **Bildirimler** tab'ında **"Onay sonuçlandı"** satırı (FYI, outcome=rejected).
- [ ] **Eylem Bekleyen** tab'ında **"Reddedildi — revize"** satırı (kind=case_returned_to_assignee).
- [ ] Bell'de hem kırmızı (1) hem gri (1) sayaç görünür.

### C.3 Revise + resubmit

- [ ] [Vakayı Aç] → CaseDetail'de çözümü revize edip yeniden onaya gönder.
- [ ] Eski reject satırını Drawer'dan **Yok Say** ile kapat (closeNote: "revize ettim").

---

## D. Snooze + lazy wake-up

### D.1 Snooze preset

- [ ] Bekleyen bir satıra tıkla → **[Ertele]** butonu → 3 preset görünür (1 saat / Yarın 09:00 / Pazartesi 09:00).
- [ ] "1 saat" seç → satır **Ertelenen** tab'ına geçer.
- [ ] Bell'de eylem sayacı azalır, snoozed sayacı (drawer'ın 3. tab'ında) artar.

### D.2 Lazy wake-up

- [ ] Sunucu zamanını veya snoozedUntil değerini geçmişe sapla (DB direkt güncelle: `UPDATE "ActionItem" SET "snoozedUntil"=NOW()-INTERVAL '1 min' WHERE id=...`).
- [ ] Drawer'ı yenile (veya bell yeni summary çekene kadar bekle).
- [ ] Satır **Eylem Bekleyen**'e geri döner; snoozedUntil null'a düşer.

---

## E. Multi-approver Expired path

> Skip if tenant'da `approverType=Supervisor` (multi-eligible) bir policy yoksa.

- [ ] `approverType=Supervisor` politika tanımla.
- [ ] Birden fazla Supervisor (UserCompany.role=Supervisor + Person bağlı) hazırla.
- [ ] Bir Supervisor approval'ı approve etsin.
- [ ] Diğer Supervisor hesabıyla drawer'a bak → o approval için olan ActionItem **Expired** (Yapıldı tab'ında "geçersiz" rozeti).
- [ ] Kim onayladığını backend audit (CaseActivity) doğrular.

---

## F. Negatif kontroller

### F.1 Yanlış kullanıcı mutation

- [ ] User A başka bir kullanıcının ActionItem'ını HTTP üzerinden (örn. curl) markDone'a göndermeye çalışsa → **403 forbidden**.

### F.2 Tenant scope leak guard

- [ ] User A, companyX'e ait — ama farklı bir companyY için elden ActionItem insert edilse (DB'den manuel).
- [ ] User A'nın drawer'ında o satır **görünmez** (allowedCompanyIds dışı).

### F.3 Feature flag off

- [ ] `.env` dosyasında `VITE_ACTION_CENTER_ENABLED=false` yap, yeniden başlat.
- [ ] Header'da Eylem Merkezi ikonu **görünmez** (mevcut MentionBellBadge kalır).
- [ ] MyHome'da "Bekleyen Onaylarım" paneli görünmez.
- [ ] Backend hâlâ ActionItem üretmeye devam ediyor (DB'de yeni submit sonrası satır var) — flag flip seamless.

### F.4 Existing MentionBellBadge unchanged

- [ ] MentionBellBadge'ı tıkla → kendi drawer'ını açar (mention + notification feed).
- [ ] Davranış WR-ACTION-CENTER öncesi ile aynı (paralel çalışıyor).

### F.5 Bell sayaç hijyeni

- [ ] Drawer'da hiç satır yokken kırmızı/gri pill **gizli** (sayaç 0).
- [ ] 99+ ActionItem varsa pill metni **"99+"** olarak görünür.

---

## G. CaseDetail entegrasyonu

### G.1 Auto-InProgress on case open

- [ ] Bell drawer'ında Pending satırın varsa, satırdan [Vakayı Aç] yerine **CaseListPage** üzerinden aynı vakayı aç.
- [ ] Drawer'a geri dön: o ActionItem state'i **InProgress** ✓ (firstSeenAt stamp'lendi).
- [ ] Bu otomatik geçiş `markInProgressForCase` server-side hook'undan gelir; FE event olmadan da çalışır.

### G.2 Mevcut ResolutionApprovalCard

- [ ] CaseDetail'de eski Çözüm Onayı kartı eskiden olduğu gibi görünür ve çalışır (submit/approve/reject).
- [ ] Hem kart hem drawer satırı aynı approval'ı yönetir — kim hangisi üzerinden karar verirse, diğeri güncel state'i yansıtır.

---

## H. Dashboard ve heuristic widget rename

### H.1 İki widget yan yana

- [ ] MyHome left column üst sırada **Bekleyen Onaylarım** (gerçek ActionItem) görünür.
- [ ] Hemen altında **Önerilen Aksiyonlar** (eski RUNA AI Önerileri heuristic) görünür.
- [ ] İki başlık görsel olarak farklı renkler/ikonlar; karışmıyor.

### H.2 Heuristic widget davranışı

- [ ] "Önerilen Aksiyonlar" panelin içeriği eskiden olduğu gibi (SLA <6h, follow-up vs.) çalışır.
- [ ] Apply/Dismiss butonları davranışı değişmemiş.

---

## I. Production safety / out-of-scope confirmation

- [ ] Customer communication queue / dispatch_manual_confirm ActionItem üretilmiyor (NotificationDispatch ayrı).
- [ ] SLA / mention / watcher / pattern / transfer / assign için ActionItem üretilmiyor.
- [ ] Bulk action UI YOK.
- [ ] Keyboard navigation YOK.
- [ ] Saved views YOK.
- [ ] Realtime push YOK (60s polling).
- [ ] AI scoring YOK.
- [ ] Full-page /action-center route YOK.
- [ ] NotificationDispatch davranışı değişmemiş (smoke: regression).

---

## Sonuç değerlendirmesi

- [ ] **A. Bell/drawer** — 2/2 alt-bölüm geçti
- [ ] **B. Happy path** — 6/6 adım geçti
- [ ] **C. Reject path** — 3/3 adım geçti
- [ ] **D. Snooze** — 2/2 adım geçti
- [ ] **E. Multi-approver expire** — 1/1 (atlanabilir)
- [ ] **F. Negatif kontroller** — 5/5 senaryo geçti
- [ ] **G. CaseDetail entegrasyonu** — 2/2 geçti
- [ ] **H. Dashboard widget** — 2/2 geçti
- [ ] **I. Out-of-scope** — 9/9 boundary korundu

**Total:** 32/32 → **Phase 1 operasyonel olarak doğrulandı.**

Bir alt-bölüm geçmiyorsa: hangi adımda kaldığını, beklenen vs gözlemlenen davranışı not edip ürün direktörüne escalate et.

---

## Ekler

### ActionItem state semantiği

| state | Anlam | Inbox tab |
|---|---|---|
| `Pending` | Yeni / üzerinde çalışılmamış | Eylem Bekleyen veya Bildirimler |
| `InProgress` | Vaka detayında açıldı | Aynı tab; "çalışıyor" rozeti |
| `Snoozed` | İleri tarihe ertelendi | Ertelenen |
| `Done` | Tamamlandı (manuel veya otomatik approve/reject) | Yapıldı |
| `Dismissed` | Yok sayıldı (closeNote opsiyonel) | Yapıldı |
| `Expired` | Başka biri karar verdiği için artık geçerli değil | Yapıldı; "geçersiz" rozeti |

### Phase 1 kind seti (yalnız 3)

| kind | actionRequired | Tetikleyici | Hedef |
|---|---|---|---|
| `approval_pending` | true | submitApproval | resolved approver(lar) |
| `approval_decided` | false (FYI) | approveApproval / rejectApproval | original submitter |
| `case_returned_to_assignee` | true | rejectApproval + behavior=ReturnToAssignee | original submitter |

Diğer kinds (mention/watcher/sla/dispatch...) Phase 2+ ile gelecek.

---

## Sırada ne var? (out-of-scope — bağlam)

- **Phase 2:** mention/watcher/dispatch_manual_confirm/dispatch_review_needed/sla_at_risk hook'ları + retention cron + 30-gün arşiv.
- **Phase 3:** Full-page `/action-center` route + saved views + bulk operations + keyboard navigation + search.
- **Phase 4:** Realtime push (Supabase Realtime / SSE) + system_alert kind + cross-tenant SystemAdmin aggregate dashboard + manual_task (supervisor → agent).
- **Phase 5+:** AI priority scoring (conditional).
- Active email provider hâlâ **Phase 4 / Level B (WR-D4/D3)** — Action Center ile ortogonal.
