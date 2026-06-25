// Faz 1 — GERCEK click-to-call testi. DIKKAT: gercek cagri baslatir!
// Kullanim: node --env-file=.env scripts/alotech-call-test.mjs <agent_email> <phone_number>
import { click2Call } from '../server/integrations/alotech/click2.js';
const [, , email, phone] = process.argv;
if (!email || !phone) { console.log('Kullanim: node --env-file=.env scripts/alotech-call-test.mjs <agent_email> <phone_number>'); process.exit(0); }
console.log(`Cagri baslatiliyor: ${email} -> ${phone} (transaction_id ile)`);
try {
  const r = await click2Call({ userEmail: email, phoneNumber: phone, transactionId: 'TEST-' + Date.now(), customVariables: { source: 'varuna-faz1-test' } });
  console.log('\n✓ Click2Call cevabi:', JSON.stringify(r));
} catch (e) { console.error('\n✗ HATA:', e.message); process.exit(1); }
