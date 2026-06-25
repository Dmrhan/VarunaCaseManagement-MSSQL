// v1 app_token kesfi: secret_key / client_id adaylarini /system/ping ile dene.
// tenant'in iki varyantini da dene (full host + sadece subdomain).
const V1 = 'https://api.alo-tech.com/v1/system/ping';
const TENANT_FULL = process.env.ALOTECH_TENANT || '';
const TENANT_SUB = TENANT_FULL.replace(/\.alo-tech\.com$/, '');
const candidates = {
  secret_key: process.env.ALOTECH_SECRET_KEY,
  client_id: process.env.ALOTECH_CLIENT_ID,
  app_token: process.env.ALOTECH_APP_TOKEN,
};
for (const [name, val] of Object.entries(candidates)) {
  if (!val) { console.log(`(${name}: tanimsiz)`); continue; }
  for (const [tlabel, tenant] of [['full', TENANT_FULL], ['sub', TENANT_SUB]]) {
    try {
      const res = await fetch(V1, { headers: { Accept: 'application/json', app_token: val, tenant } });
      const text = await res.text();
      const ok = res.ok && /pong|success/i.test(text);
      console.log(`${ok ? '✓' : '·'} app_token=${name} tenant=${tlabel} → HTTP ${res.status} ${text.slice(0, 120)}`);
    } catch (e) { console.log(`✗ ${name}/${tlabel}: ${e.message}`); }
  }
}
