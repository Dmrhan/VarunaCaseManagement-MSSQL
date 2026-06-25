// v1 /agent/status format kesfi. Guvenli: backoffice (cagri almaz).
import { v1Fetch } from '../server/integrations/alotech/v1.js';
const email = 'ege.usluer@param.com.tr';

console.log('--- Format A: status = { backoffice: "" } ---');
let r = await v1Fetch('/agent/status', { method: 'POST', body: { user_name: email, status: { backoffice: '' } } });
console.log('HTTP', r.status, '|', r.text.slice(0, 250));

console.log('\n--- Format B: status = "backoffice" (string) ---');
let r2 = await v1Fetch('/agent/status', { method: 'POST', body: { user_name: email, status: 'backoffice' } });
console.log('HTTP', r2.status, '|', r2.text.slice(0, 250));
