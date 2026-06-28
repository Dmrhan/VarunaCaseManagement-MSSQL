#!/usr/bin/env node
/**
 * M4.1 follow-up — buildTemplateVars render bugs smoke.
 *
 * Memory pin:
 *   1) resolution.customerMessage YANLIŞ alandan (yalnız approval cycle)
 *   2) case.status + case.priority ham enum ("ThirdPartyWaiting", "Medium")
 *
 * Fix:
 *   1) approval?.customerMessageDraft ?? caseRow?.resolutionNote ?? ''
 *   2) STATUS_LABELS / PRIORITY_LABELS reuse (formatters.js)
 *
 * Kontrat: notification/customer-facing render değişti; mevcut 27/27 +
 * 19/19 regression korunur (case_closed/case_reopened/resolution_* event
 * pipeline'ı etkilenmedi).
 *
 * Smoke buildTemplateVars'ı doğrudan çağırır; DB seed yok.
 */

import { buildTemplateVars } from '../server/db/notificationRepository.js';

let pass = 0; let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
}

(async () => {
  try {
    console.log('\n=== (1) STATUS Türkçe etiket — formatters.js reuse ===');
    const cases = [
      { status: 'Acik', expected: 'Açık' },
      { status: 'Incelemede', expected: 'İncelemede' },
      { status: 'ThirdPartyWaiting', expected: '3. Parti Bekleniyor' },
      { status: 'Eskalasyon', expected: 'Eskalasyon' },
      { status: 'Cozuldu', expected: 'Çözüldü' },
      { status: 'YenidenAcildi', expected: 'Yeniden Açıldı' },
      { status: 'IptalEdildi', expected: 'İptal Edildi' },
    ];
    for (const c of cases) {
      const vars = buildTemplateVars({ caseRow: { status: c.status }, approval: null });
      expect(`status: ${c.status} → ${c.expected}`, vars['case.status'], c.expected);
    }
    // Bilinmeyen status → ham fallback (placeholder boş marker'a düşmesin)
    const unknownStatus = buildTemplateVars({ caseRow: { status: 'UnknownEnum' }, approval: null });
    expect('bilinmeyen status → ham fallback', unknownStatus['case.status'], 'UnknownEnum');

    console.log('\n=== (2) PRIORITY Türkçe etiket ===');
    const priorities = [
      { priority: 'Low', expected: 'Düşük' },
      { priority: 'Medium', expected: 'Orta' },
      { priority: 'High', expected: 'Yüksek' },
      { priority: 'Critical', expected: 'Kritik' },
    ];
    for (const p of priorities) {
      const vars = buildTemplateVars({ caseRow: { priority: p.priority }, approval: null });
      expect(`priority: ${p.priority} → ${p.expected}`, vars['case.priority'], p.expected);
    }
    const unknownPrio = buildTemplateVars({ caseRow: { priority: 'XYZ' }, approval: null });
    expect('bilinmeyen priority → ham fallback', unknownPrio['case.priority'], 'XYZ');

    console.log('\n=== (3) resolution.customerMessage fallback chain ===');
    // (3a) approval.customerMessageDraft VAR → onu kullan (eski davranış)
    const v3a = buildTemplateVars({
      caseRow: { resolutionNote: 'NOTE-X' },
      approval: { customerMessageDraft: 'APPROVAL-MSG' },
    });
    expect('approval VAR → approval kullan', v3a['resolution.customerMessage'], 'APPROVAL-MSG');

    // (3b) approval YOK, resolutionNote VAR → fallback (M4.1 fix)
    const v3b = buildTemplateVars({
      caseRow: { resolutionNote: 'Sayın müşterimiz, sorununuz çözüldü.' },
      approval: null,
    });
    expect('approval YOK → resolutionNote fallback (M4.1 fix)',
      v3b['resolution.customerMessage'], 'Sayın müşterimiz, sorununuz çözüldü.');

    // (3c) İkisi de YOK → boş string (eski + yeni davranış)
    const v3c = buildTemplateVars({ caseRow: {}, approval: null });
    expect('ikisi de YOK → boş string', v3c['resolution.customerMessage'], '');

    // (3d) approval.customerMessageDraft boş ama resolutionNote dolu
    //      → fallback resolutionNote (boş string truthy değil; ?? semantiği)
    //      DİKKAT: ?? null/undefined için fallback yapar; boş string '' truthy
    //      sayılır → boş string returns. Bu kasıtlı (approval'da kasıtlı
    //      boş bırakıldıysa fallback yapma).
    const v3d = buildTemplateVars({
      caseRow: { resolutionNote: 'NOTE-Y' },
      approval: { customerMessageDraft: '' },
    });
    expect('approval boş string → boş string return (kasıtlı)',
      v3d['resolution.customerMessage'], '');

    console.log('\n=== (4) Tüm placeholder geri uyumlu ===');
    const full = buildTemplateVars({
      caseRow: {
        caseNumber: 'VK-1',
        title: 'Title',
        description: 'desc',
        status: 'Acik',
        priority: 'High',
        category: 'Yazılım',
        subCategory: 'Hata',
        accountName: 'Acme',
        companyName: 'Univera',
        assignedPersonName: 'Demirhan',
        assignedTeamName: 'Destek',
        customerContactName: 'Ali',
        customerContactEmail: 'ali@x.com',
        resolutionNote: 'note',
      },
      approval: {
        resolutionSummary: 'summary',
        customerMessageDraft: 'cust',
        rejectionReason: 'rej',
        approverName: 'lead',
      },
    });
    expect('case.number', full['case.number'], 'VK-1');
    expect('case.status TR', full['case.status'], 'Açık');
    expect('case.priority TR', full['case.priority'], 'Yüksek');
    expect('case.category (free text)', full['case.category'], 'Yazılım');
    expect('account.name', full['account.name'], 'Acme');
    expect('assignee.name', full['assignee.name'], 'Demirhan');
    expect('requester.name', full['requester.name'], 'Ali');
    expect('requester.email', full['requester.email'], 'ali@x.com');
    expect('resolution.customerMessage (approval öncelikli)', full['resolution.customerMessage'], 'cust');
  } catch (err) {
    console.error('\n[test] HATA:', err.message);
    console.error(err.stack);
    fail++;
  } finally {
    console.log('\n────────────────────────────────────────────────────────');
    console.log(`PASS=${pass}  FAIL=${fail}`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
