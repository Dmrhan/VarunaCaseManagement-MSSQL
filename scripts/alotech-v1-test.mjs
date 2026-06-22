// v1 canli test: agent durumu + bugunun CDR'i (ege.usluer test aramalari).
import { v1Fetch } from '../server/integrations/alotech/v1.js';

// 1) Agent durumlari — ege.usluer'i bul
const st = await v1Fetch('/agent/get_agents_status');
console.log('=== /agent/get_agents_status ===', 'HTTP', st.status);
const list = st.data?.agents_status_list || [];
console.log('Toplam agent:', list.length);
const ege = list.filter((a) => /ege/i.test(a.email || '') || /ege/i.test(a.agentname || ''));
console.log('ege.* :', JSON.stringify(ege));

// 2) Bugunun CDR'i — ege.usluer
const cdr = await v1Fetch('/report/CDR', { method: 'POST', body: {
  startdate: '2026-06-18 00:00:00', finishdate: '2026-06-18 23:59:59',
  agent_username: 'ege.usluer@param.com.tr',
} });
console.log('\n=== /report/CDR (bugun, ege.usluer) ===', 'HTTP', cdr.status);
const calls = cdr.data?.CallList || [];
console.log('Cagri sayisi:', calls.length);
for (const c of calls.slice(0, 8)) {
  console.log(`  ${c.calldate} | ${c.inbound ? 'IN ' : 'OUT'} | ara:${c.callerid}->${c.called_num} | ${c.status} | sure:${c.duration ?? '-'} | c2c:${c.click2call} | rec:${c.recordingurl ? 'VAR' : 'yok'}`);
}
