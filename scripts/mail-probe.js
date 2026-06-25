#!/usr/bin/env node
/**
 * Mail probe — M1 IT-bağımsız doğrulama.
 *
 * Kullanım:
 *   npm run mail:probe
 *
 * Davranış:
 *   - mailProvider.sendMail ile bir test maili gönderir.
 *   - Başarılı: messageId + Ethereal preview URL'i konsola net basar.
 *     Preview URL'i browser'da aç → gönderilen mesajı gör.
 *   - Hata: stderr'e mesaj + exit code 1.
 *
 * Spec: feature/mail-provider-ethereal-probe (M1 IT-bağımsız yarı).
 */

import { sendMail } from '../server/lib/mailProvider.js';

const TO = process.env.PROBE_TO || 'probe@example.com';
const SUBJECT = process.env.PROBE_SUBJECT || 'Varuna Mail Probe (M1)';
const TEXT = process.env.PROBE_TEXT
  || 'Bu Varuna Vaka Yönetimi mail provider katmanının ilk gönderim testidir (M1).';

console.log('[mail:probe] gönderim başlatılıyor...');
console.log(`  transport: ${process.env.MAIL_TRANSPORT || 'ethereal'}`);
console.log(`  to:        ${TO}`);
console.log(`  subject:   ${SUBJECT}`);
console.log('');

const result = await sendMail({
  to: TO,
  subject: SUBJECT,
  text: TEXT,
  html: `<p>${TEXT}</p><p><em>Bu otomatik bir test mesajıdır.</em></p>`,
});

if (!result.ok) {
  console.error('[mail:probe] HATA:');
  console.error(`  code:    ${result.error?.code}`);
  console.error(`  message: ${result.error?.message}`);
  console.error(`  status:  ${result.error?.status ?? '—'}`);
  process.exit(1);
}

console.log('[mail:probe] BAŞARILI ✓');
console.log(`  messageId:  ${result.messageId ?? '—'}`);
console.log(`  transport:  ${result.meta?.transport}`);
if (result.previewUrl) {
  console.log('');
  console.log('  Ethereal Preview URL:');
  console.log(`    ${result.previewUrl}`);
  console.log('');
  console.log('  Yukarıdaki URL\'i browser\'da aç → gönderilen mesajı gör.');
} else {
  console.log('  (gerçek SMTP transport — preview yok; mesaj alıcıya iletildi)');
}

process.exit(0);
