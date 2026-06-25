// app_token degisti: getSessionKey artik gercek app_token kullanir.
import { getSessionKey } from '../server/integrations/alotech/session.js';
const r = await getSessionKey('ege.usluer@param.com.tr');
console.log('login HTTP', r.status, '| ok:', r.ok);
console.log('cevap:', r.text.slice(0, 300));
if (r.data?.session || r.data?.sessionkey || r.data?.session_key) {
  console.log('>>> SESSION KEY ALINDI');
}
