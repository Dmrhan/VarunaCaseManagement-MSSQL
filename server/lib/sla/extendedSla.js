/**
 * extendedSla.js — Uzatılmış SLA motoru (v1 Faz 1, 2026-07-14).
 *
 * İş kuralı (U-serisi kararlar): vaka, "uzatılmış çözüm süresi uygular"
 * bayraklı bir 3. parti tanımına devredildiğinde (ve tanım isterse vakada
 * DevOps kaydı varsa) çözüm hedefi, SLA kuralındaki uzatılmış TOPLAM
 * süreye (mesai dk, açılış anından itibaren) yeniden damgalanır.
 *
 * Tasarım sözleşmesi:
 *  - TEK YÖN: yalnız standart→uzatılmış. Geri daraltma YOK (U-E) —
 *    bakımdan dönen / DevOps kaydı silinen vakada hedef uzatılmış kalır,
 *    iz vaka geçmişinde. Bu yüzden helper idempotent: kaynak zaten
 *    'extended' ise null döner.
 *  - ATOMİK (kabul şartı 3): patch TEK update'e girer — due + ihlal
 *    yeniden değerlendirmesi + kaynak/hedef damgası + geçmiş kaydı aynı
 *    yazımda. "Hedef uzadı ama kırmızı kaldı" ara durumu sınıf olarak yok.
 *  - Hedef değeri TEK noktadan okunur (resolveExtendedTargetMinutes) —
 *    ileride tanım-başına farklı süre (çoklu rejim, şema notu) gerekirse
 *    yalnız bu fonksiyonun imzası genişler, çağıranlar değişmez.
 *  - Formül sıfırdan türetir (artımlı öteleme değil): birikmiş duraklama
 *    dakikaları hedefin üstüne eklenir → 3. parti/müşteri-bekleme
 *    ötelemeleriyle çifte sayım yapısal olarak imkânsız, tekrar koşum güvenli.
 *  - Takvim kapısı damga anına (createdAt) göre sorulur — vaka hangi
 *    rejimle damgalandıysa uzatma da o rejimle hesaplar (eski-kayıt paritesi).
 */
import { getEffectiveCalendar, addBusinessMinutes } from './businessTime.js';

/**
 * Uzatılmış hedef dakika — politika satırından okunduğu TEK nokta
 * (resolveTargetMinutes'un ikizi). null = satırda uzatma tanımsız
 * (fail-safe: tetik oluşsa bile davranış değişmez).
 */
export function resolveExtendedTargetMinutes(policyRow) {
  const v = policyRow?.extendedResolutionMin;
  return Number.isInteger(v) && v > 0 ? v : null;
}

/**
 * Tetik koşulu — tanım bazında iki parçalı (U-B):
 *  (1) tanımda triggersExtendedSla açık,
 *  (2) tanım isterse (extendedSlaRequiresDevopsLink) vakada DevOps kaydı var.
 * devopsCount'u çağıran sağlar (readDevopsArray tek doğruluk kaynağı).
 */
export function extendedSlaTriggerMet(tpRow, devopsCount) {
  if (!tpRow?.triggersExtendedSla) return false;
  if (tpRow.extendedSlaRequiresDevopsLink && !(devopsCount > 0)) return false;
  return true;
}

const TERMINAL = new Set(['Cozuldu', 'IptalEdildi']);

/**
 * Uzatma patch'i — koşullar sağlanıyorsa { data, historyEntry } döner,
 * aksi halde null (çağıran hiçbir şey yapmaz). data çağıranın TEK
 * update'ine yayılır; historyEntry aynı update'in history.create'ine girer.
 *
 * row: Case satırı (companyId, status, createdAt, slaResolutionDueAt,
 *      slaResolutionTargetMin, slaTargetSource, slaPausedDurationMin,
 *      slaViolation, resolvedAt) — transitionStatus'un tam-satır prev'i yeter.
 * extendedMin: resolveExtendedTargetMinutes çıktısı.
 * reason: geçmiş kaydına girecek tetik bağlamı (tanım adı + DevOps no).
 */
export async function buildExtendedSlaPatch(row, extendedMin, reason, nowMs = Date.now()) {
  if (!row || extendedMin == null) return null;
  if (row.slaTargetSource === 'extended') return null; // idempotent — tek yön
  if (TERMINAL.has(row.status)) return null;

  const createdMs = new Date(row.createdAt).getTime();
  const pausedMin = row.slaPausedDurationMin ?? 0;
  const cal = await getEffectiveCalendar(row.companyId, createdMs);
  const totalMin = extendedMin + pausedMin;
  const biz = cal ? addBusinessMinutes(createdMs, totalMin, cal) : null;
  const newDueMs = biz != null ? biz : createdMs + totalMin * 60000;

  // Eski hedef (geçmiş metni için) — damga varsa onu, yoksa due'dan geri türet.
  const oldTargetMin =
    row.slaResolutionTargetMin ??
    (row.slaResolutionDueAt
      ? Math.max(0, Math.round((new Date(row.slaResolutionDueAt).getTime() - createdMs) / 60000) - pausedMin)
      : null);

  const data = {
    slaResolutionDueAt: new Date(newDueMs),
    slaTargetSource: 'extended',
    slaResolutionTargetMin: extendedMin,
  };
  // U-F — ihlal, YENİ hedefe göre yeniden değerlendirilir: referans an
  // (açık vakada now) yeni due'yu aşmıyorsa bayrak geri çekilir. Aşıyorsa
  // (uzatılmış hedef bile geçilmişse) kırmızı haklı olarak kalır.
  if (row.slaViolation && nowMs <= newDueMs) data.slaViolation = false;

  // CaseActivity sözleşmesine kısmi kayıt — companyId/actor/actorUserId
  // çağıranın bağlamından eklenir (transitionStatus historyEntries deseni).
  const historyEntry = {
    action: `SLA hedefi uzatıldı — Yazılım Geliştirme devri (${reason})`,
    actionType: 'FieldUpdate',
    fieldName: 'slaResolutionTargetMin',
    fromValue: oldTargetMin != null ? `${oldTargetMin} dk` : null,
    toValue: `${extendedMin} dk`,
  };
  return { data, historyEntry };
}
