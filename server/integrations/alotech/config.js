/**
 * AloTech entegrasyon — TEK YER konfigürasyon guard'ı.
 *
 * Tüm AloTech route'ları (server/routes/alotech.js) bu guard'ı kullanır:
 *   - isAlotechConfigured() false ise endpoint 200 { configured: false }
 *     döner; 500 ATMAZ → frontend softphone widget'ı sessizce devre dışı
 *     kalır (toast spam yok).
 *   - true ise route normal akışına devam eder (regresyon yok).
 *
 * REUSE: client.js zaten assertConfig() ile aynı env'leri (ALOTECH_TENANT
 * + ALOTECH_CLIENT_ID + ALOTECH_SECRET_KEY) kontrol ediyor; biz throw
 * etmeyen sürümünü tek yerde tanımlayıp HEM route HEM client tarafında
 * kullanıyoruz. session.js de aynı kontrolü kullanır.
 *
 * Boot anında BİR KEZ debug log (errror değil, info); .env değeri ASLA
 * loglanmaz, sadece eksik anahtar adları.
 */

// Click2Call ve session login için zorunlu env'ler:
//   ALOTECH_TENANT     — tenant hostname (param-univera.alo-tech.com)
//   ALOTECH_APP_TOKEN  — v1 login (yoksa SECRET_KEY fallback — session.js davranışı)
// click2Call (v3) için ayrıca ALOTECH_CLIENT_ID + ALOTECH_SECRET_KEY.
//
// Guard "softphone genel devre dışı" semantik taşır → TENANT + (APP_TOKEN
// VEYA SECRET_KEY) yeterli. Eksik CLIENT_ID v3 click2Call route'una çakılır
// (orada zaten assertConfig throw eder); softphone widget'ının "configured"
// kararı ise bu iki temel env üzerinden verilir.
export function missingAlotechEnvKeys() {
  const miss = [];
  if (!process.env.ALOTECH_TENANT) miss.push('ALOTECH_TENANT');
  if (!process.env.ALOTECH_APP_TOKEN && !process.env.ALOTECH_SECRET_KEY) {
    miss.push('ALOTECH_APP_TOKEN | ALOTECH_SECRET_KEY');
  }
  return miss;
}

export function isAlotechConfigured() {
  return missingAlotechEnvKeys().length === 0;
}

let bootLogged = false;
/** Boot anında bir kez log; route'lardan her istekte spam etmez. */
export function logAlotechConfigOnce() {
  if (bootLogged) return;
  bootLogged = true;
  const miss = missingAlotechEnvKeys();
  if (miss.length) {
    console.log(`[alotech] entegrasyon devre dışı (eksik env: ${miss.join(', ')})`);
  } else {
    console.log('[alotech] entegrasyon aktif');
  }
}
