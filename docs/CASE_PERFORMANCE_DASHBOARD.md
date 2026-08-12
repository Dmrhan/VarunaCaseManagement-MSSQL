# Performans Panosu — Spec

> Ekip ve kişi performansını **koçluk** merceğiyle ölçen pano. Sıralama tahtası değil; "nerede destek gerekiyor, yük adil mi, kim neyde uzman" sorularına cevap. Maket: 2 ekran (takım koçluk görünümü + kişi uzmanlık profili), 2026-07-07 kullanıcı onayı.

## Tasarım ilkeleri (değişmez)

1. **Koçluk, sıralama değil.** Her hız metriği bir kalite metriğiyle eşlenir; çıplak "en yavaş kim" kolonu YOK.
2. **Yöneticinin dili.** Ekran iş dilinde konuşur ("Tipik çözüm süresi", "Yeniden açılma oranı", "Elindeki açık iş"); istatistik terimi (medyan, P90, SLA) ⓘ içinde.
3. **Her metrik birimini + hesabını taşır.** `{ value, unit, formula, sampleSize }` sözleşmesi — birim/formül UI'da uydurulmaz, **tek kaynak backend.**
4. **Guardrail — az örneklem gizli.** Oran/medyan metrikleri `MIN_SAMPLE.agentPerformance` (=20) altında `value:null, insufficient:true`.
5. **Medyan, ortalama değil.** Tek uzun vaka ortalamayı bozar; medyan (ortadaki) + yavaş uç (P90).
6. **Bağlam, çıplak sayı değil.** Her metrik ekip ortancasına (`teamBenchmark`) göre konumlanır.
7. **Adil süre.** Çözüm süresi müşteri beklemesi hariç (duraklamalı) okunur.
8. **Rol-duyarlı görünürlük.** Kişi kendi kartını + anonim ekip ortancasını görür; Supervisor tüm kişileri; SystemAdmin hepsi.
9. **Arşivli vakalar sayılmaz** (baseWhere `isArchived=0`).

## Metrik kataloğu (yöneticinin dili → birim → hesap → kaynak)

| Metrik (ekran dili) | Birim | Hesap | Kaynak alan | Guardrail |
|---|---|---|---|---|
| Çözülen iş | vaka | dönemde çözüme ulaşan | `resolvedAt` | — |
| Tipik çözüm süresi | saat | ortadaki vaka (medyan), açılış→çözüm | `resolvedAt − createdAt` | <20 → gizli |
| Yavaş uç | saat | en yavaş %10 eşiği (P90) | aynı | <20 → gizli |
| Yeniden açılma oranı | % | yeniden açılan ÷ çözülen | `status=YenidenAcildi` | <20 → gizli |
| Zamanında çözüm | % | 100 − SLA ihlal oranı | `slaViolation` | <20 → gizli |
| Eskalasyon oranı | % | üst kademeye çıkan ÷ çözülen | `escalationLevel<>'Yok'` | <20 → gizli |
| Devir oranı | % | en az bir kez devredilen ÷ çözülen | `transferCount>0` | <20 → gizli |
| Elindeki açık iş (WIP) | vaka | anlık açık durumda taşıdığı | `COUNT(OPEN_STATUSES)` | — |

Payda birliği: tüm oranlar **dönemde çözülen iş** üzerinden (kişinin bitirdiği iş); WIP anlık.

## Fazlar

- **FAZ 1a — Metrik motoru (BU PR):** `queryByPerson` + `computePeoplePerformanceOverview` (operationsAggregator.js) + `POST /api/analytics/people-performance` (Supervisor+). Sözleşme + guardrail + ekip benchmark. Yapısal smoke 14/14; canlı doğrulama VPN gelince.
- **FAZ 1b — Takım koçluk ekranı:** takım özeti şeridi + kişi kartları (vs-ekip çipleri, sağlık renkleri, ⓘ tam tanım) + rol-duyarlı görünürlük + kişi-kendi görünümü. UI → **local görsel onay kapısı.**
- **FAZ 2 — Kişi uzmanlık profili (drill-down):** uzmanlık parmak izi (category/subCategory + konu-içi hız) · en uzun işler (`resolvedAt−createdAt`) · en çok karşılaştığı sorunlar · çözüm imzası (`rootCauseGroup/resolutionType/permanentPrevention`) · günlük çözüm-süresi trendi · **Etkinlik & Katkı** (gizlenme tespiti — beş sinyal birlikte, sonuçla eşli).
- **FAZ 3 — Boşluklar (ayrı karar):** CSAT toplama (çözüm mailine tek-tık anket) · `qaScoredBy`.

## Etik omurga — Etkinlik & Katkı (FAZ 2, hassas)

"Gerçekten çalışıyor mu, gizlenmiş mi" sorusu **tek skora indirgenmez** (anında oyunlanır, sessiz uzmanı haksız yakalar). Beş davranış sinyali **birlikte** + sonuçla eşli okunur: aktif dokunuş/gün (`CaseActivity`), havuzdan üstlenme, dokunulmayan iş (top sende; müşteri/3.taraf/snooze beklemesi HARİÇ), zor iş payı, hızlı devretme. Gizlenme = hepsi birlikte düşük + çözülmüş sonuç yok. Pozitif çerçeve: "yük adil mi", "kim tembel" tahtası değil.

## Doğal ev

Ops Panosu v2 FAZ 3 "agent workload" kaleminin kişi-mercekli derinleşmesi. Formüller/medyan-P90/delta/MIN_SAMPLE `metricFormulas.js`'te hazır (%80 reuse); yeni tek büyük parça `queryByPerson` (bu PR).
