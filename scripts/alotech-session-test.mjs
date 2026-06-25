// SoftphoneJS Session Key testi: secret_key, app_token olarak calisir mi?
// Kullanim: node --env-file=.env scripts/alotech-session-test.mjs <agent_email>
import { getSessionKey } from '../server/integrations/alotech/session.js';
const email = process.argv[2] || 'ege.usluer@param.com.tr';
console.log(`Session key isteniyor: ${email} (app_token = secret_key)`);
const r = await getSessionKey(email);
console.log('HTTP:', r.status, '| ok:', r.ok);
console.log('Cevap:', r.text.slice(0, 400));
