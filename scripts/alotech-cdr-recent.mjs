// Bugunun GELEN cagrilari + durumlari (agent'a dustu mu, abandon mu, queue ne).
import { v1Fetch } from '../server/integrations/alotech/v1.js';
const r = await v1Fetch('/report/CDR', { method: 'POST', body: {
  startdate: '2026-06-18 00:00:00', finishdate: '2026-06-18 23:59:59', inbound: 'true',
} });
const calls = (r.data?.CallList || []);
console.log('HTTP', r.status, '| gelen cagri:', calls.length);
for (const c of calls.slice(-12)) {
  console.log(`${c.calldate} | ara:${c.callerid} -> ${c.called_num} | queue:${c.queue} | status:${c.status} | answered:${c.answered} | abandon:${c.abandon} | agent:${c.agent || '-'} | hangupcause:${c.hangupcause}`);
}
