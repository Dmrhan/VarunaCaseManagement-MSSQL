/**
 * mailProvider.sendMail() — geçici ağ hatalarında otomatik retry (Adım 2).
 *
 * Üretimde görülen hata: vaka ekranından mail gönderirken
 * "connect ETIMEDOUT 142.251.127.108:587" (smtp.gmail.com'a bağlanırken
 * geçici ağ takılması) — tek denemede pes edilip kullanıcıya 502 olarak
 * yansıyordu. Artık SADECE ağ-kaynaklı hatalarda (ETIMEDOUT, ECONNRESET
 * vb.) kısa bir bekleme ile 2 kez daha denenir (toplam 3 deneme); kimlik
 * doğrulama (EAUTH) gibi kalıcı hatalarda retry YAPILMAZ.
 *
 * Fonksiyonel smoke: gerçek SMTP'ye bağlanmaz — nodemailer.createTransport
 * mock'lanır, sendMail() ilk N çağrıda kontrollü şekilde hata fırlatır,
 * retry davranışı uçtan uca doğrulanır (DB/env bağımlılığı yok — 'env'
 * transport yolu, opts.companyId verilmeden çağrılır).
 *
 * Çalıştır: node scripts/smoke-mail-send-retry.js
 */
process.env.MAIL_TRANSPORT = 'smtp';
process.env.SMTP_HOST = 'smtp.invalid.test';
process.env.SMTP_PORT = '587';
process.env.SMTP_SECURE = 'false';
process.env.SMTP_USER = 'test-user';
process.env.SMTP_PASS = 'test-pass';

import nodemailer from 'nodemailer';

let pass = 0;
let fail = 0;
function check(label, ok) {
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}

function mockCreateTransport(behavior) {
  let callCount = 0;
  nodemailer.createTransport = () => ({
    sendMail: async () => {
      callCount += 1;
      const outcome = behavior(callCount);
      if (outcome.throw) throw outcome.throw;
      return outcome.resolve ?? { messageId: 'mock-id' };
    },
  });
  return () => callCount;
}

async function main() {
  const { sendMail } = await import('../server/lib/mailProvider.js');
  const baseArgs = { to: 'test@example.com', subject: 'Test', text: 'merhaba' };

  // Senaryo 1 — ETIMEDOUT, ETIMEDOUT, başarı → 3. denemede ok:true, attempts:3
  {
    const getCalls = mockCreateTransport((n) =>
      n < 3
        ? { throw: Object.assign(new Error('connect ETIMEDOUT 142.251.127.108:587'), { code: 'ETIMEDOUT' }) }
        : { resolve: { messageId: 'ok-after-retry' } },
    );
    const res = await sendMail(baseArgs);
    check('Senaryo 1 — 2x ETIMEDOUT sonrası 3. denemede başarılı (ok:true)', res.ok === true);
    check('Senaryo 1 — meta.attempts === 3', res.meta?.attempts === 3);
    check('Senaryo 1 — transport tam olarak 3 kez çağrıldı', getCalls() === 3);
  }

  // Senaryo 2 — kalıcı ETIMEDOUT (3 denemede de başarısız) → ok:false, attempts:3, 3 çağrı
  {
    const getCalls = mockCreateTransport(() => ({
      throw: Object.assign(new Error('connect ETIMEDOUT 142.251.127.108:587'), { code: 'ETIMEDOUT' }),
    }));
    const res = await sendMail(baseArgs);
    check('Senaryo 2 — 3 denemede de ETIMEDOUT sonrası ok:false', res.ok === false);
    check('Senaryo 2 — error.status 502', res.error?.status === 502);
    check('Senaryo 2 — meta.attempts === 3 (retry tükendi)', res.meta?.attempts === 3);
    check('Senaryo 2 — transport tam olarak 3 kez çağrıldı (max deneme sınırına uyuldu)', getCalls() === 3);
  }

  // Senaryo 3 — EAUTH (kalıcı/retry-dışı hata) → İLK denemede pes edilir, retry YAPILMAZ
  {
    const getCalls = mockCreateTransport(() => ({
      throw: Object.assign(new Error('Invalid login'), { code: 'EAUTH' }),
    }));
    const res = await sendMail(baseArgs);
    check('Senaryo 3 — EAUTH sonrası ok:false', res.ok === false);
    check('Senaryo 3 — EAUTH retry YAPILMADI, transport tam 1 kez çağrıldı', getCalls() === 1);
  }

  // Senaryo 4 — ilk denemede başarı → hiç retry yok, meta.attempts set edilmez
  {
    const getCalls = mockCreateTransport(() => ({ resolve: { messageId: 'first-try-ok' } }));
    const res = await sendMail(baseArgs);
    check('Senaryo 4 — ilk denemede başarı (ok:true)', res.ok === true);
    check('Senaryo 4 — meta.attempts set edilmedi (retry olmadı → regresyonsuz)', res.meta?.attempts === undefined);
    check('Senaryo 4 — transport tam 1 kez çağrıldı', getCalls() === 1);
  }

  console.log(`\n${pass} geçti, ${fail} başarısız.`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
