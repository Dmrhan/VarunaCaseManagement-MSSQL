/**
 * Bağımsız KB servisi — VarunaCM ile AYNI kodu/bundle'ı (kbCore.js) kullanır
 * ama AYRI bir Node process'te çalışır.
 *
 * AMAÇ: KB'nin yaşam döngüsünü Varuna'dan ayırmak. VarunaCM (3101) durdurulsa /
 * deploy edilse / restart olsa bile bu servis (KB) ayakta kalır. Aynı makine,
 * farklı port. Kod tarafında BAŞKA değişiklik yok — kbV1 router zaten
 * self-contained (yalnız kbCore + env.API_KEYS'e bağlı, app'in verifyJwt/
 * prisma'sına DEĞİL).
 *
 * ÇALIŞTIRMA (cwd = repo kökü olmalı — kbCore data/embeddings.sqlite ve
 * data/cc-taxonomy-v2.json'ı process.cwd()'den okur):
 *   node --env-file-if-exists=.env server/kb-standalone.js
 *
 * nssm servisi (Windows, prod):
 *   Application       = <node.exe yolu>
 *   Arguments         = --env-file-if-exists=.env server/kb-standalone.js
 *   AppDirectory      = C:\apps\VarunaCaseManagement-MSSQL   (repo kökü)
 *   Servis adı        = VarunaKB
 *
 * BAĞLAMA: Varuna'nın ExternalKbSetting.baseUrl'i http://127.0.0.1:3101 yerine
 * http://127.0.0.1:3200'e çevrilir (DB config / admin panel) — kod değişmez.
 */
import express from 'express';
import kbV1Router from './routes/kbV1.js';

const app = express();
app.disable('x-powered-by');
// kbV1 route'ları req.body kullanıyor ama kendi parser'ını EKLEMIYOR (app.js'te
// global jsonParser var). Standalone'da burada eklenir. analyze payload'ları
// büyük olabildiği için cömert limit.
app.use(express.json({ limit: '10mb' }));
app.use('/api/v1', kbV1Router);

const PORT = Number(process.env.KB_PORT) || 3200;
const HOST = process.env.KB_HOST || '127.0.0.1'; // yalnız loopback (aynı makine). Dış erişim için IIS/binding ayrı.
app.listen(PORT, HOST, () => {
  console.log(`[kb-standalone] Bağımsız KB servisi http://${HOST}:${PORT} dinliyor (VarunaCM'den ayrı process)`);
});
