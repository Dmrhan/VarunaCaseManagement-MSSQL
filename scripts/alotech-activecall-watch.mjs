// Gelen cagri kesfi: agent durumu + aktif cagrilar, 2sn'de bir, ~60sn.
// Kullanim: node --env-file=.env scripts/alotech-activecall-watch.mjs
import { getSessionKey } from '../server/integrations/alotech/session.js';
import { v1Fetch } from '../server/integrations/alotech/v1.js';

const EMAIL = process.argv[2] || 'ege.usluer@param.com.tr';
const sess = await getSessionKey(EMAIL);
const session = sess.data?.session;
if (!session) { console.error('session yok:', sess.text); process.exit(1); }
console.log(`Izleniyor: ${EMAIL} (60sn). Simdi AloTech hattina GELEN arama yap...`);

let prev = '';
for (let i = 0; i < 30; i++) {
  const st = await v1Fetch('/agent/get_agents_status');
  const me = (st.data?.agents_status_list || []).find((a) => (a.email || '').toLowerCase() === EMAIL.toLowerCase());
  const ac = await v1Fetch(`/activecall/user?session=${encodeURIComponent(session)}`);
  const calls = ac.data?.MyActiveCalls || [];
  const snap = JSON.stringify({ status: me?.status, calls: calls.map((c) => ({ callerid: c.callerid, called: c.called_num, inbound: c.inbound, status: c.status })) });
  if (snap !== prev) {
    console.log(`[${new Date().toISOString().slice(11, 19)}] status=${me?.status} | calls=${calls.length}`);
    for (const c of calls) console.log(`    ${c.inbound ? 'GELEN' : 'GIDEN'} | arayan:${c.callerid} -> ${c.called_num} | ${c.status} | key:${c.key?.slice(-12)}`);
    prev = snap;
  }
  await new Promise((r) => setTimeout(r, 2000));
}
console.log('Bitti.');
