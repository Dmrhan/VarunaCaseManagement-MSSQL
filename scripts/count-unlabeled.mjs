// Etiketsiz (kapanış etiketi eksik) VK vakalarını sayar.
import { prisma } from '../server/db/client.js';

const cases = await prisma.case.findMany({
  where: { caseNumber: { startsWith: 'VK-' }, customFields: { not: null } },
  select: { caseNumber: true, status: true, customFields: true },
});
let smart = 0;
let labeled = 0;
const miss = {};
for (const c of cases) {
  let cf;
  try {
    cf = typeof c.customFields === 'string' ? JSON.parse(c.customFields) : c.customFields;
  } catch {
    continue;
  }
  if (!cf?.smartTicket) continue;
  smart += 1;
  const cl = cf.smartTicket.closure || {};
  if (cl.rootCauseGroupLabel && cl.resolutionTypeLabel) labeled += 1;
  else miss[c.status] = (miss[c.status] || 0) + 1;
}
console.log(`VK+smartTicket: ${smart} | kapanis-etiketli: ${labeled} | ETIKETSIZ: ${smart - labeled}`);
console.log(`etiketsiz status bazli: ${JSON.stringify(miss)}`);
console.log(`>>> etiketsiz Cozuldu: ${miss.Cozuldu || 0}`);
process.exit(0);
