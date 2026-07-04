/**
 * mailSender — Ortak "gönderen adı" gösterim util'i (R9.1).
 *
 * Kural özeti (tek kaynak — MailThreadListPane + MailThreadReader
 * "ayrıntılar" bölümü aynısını kullanır):
 *
 *   - inbound: from.name?.trim() ?? from.address.local
 *   - outbound + source==='notification_dispatch' → 'Varuna · Otomatik'
 *   - outbound + sentByUserId === currentUserId    → 'Siz'   (Gmail 'ben' paritesi)
 *   - outbound + sentByName varsa                  → sentByName (agent adı düz)
 *   - outbound + legacy null                       → from.name?.trim() ?? 'Varuna'
 *
 * REUSE: Kod çatallaması yasak — her iki komponent BU util'i çağırır.
 */
import type { CaseEmailItem } from '@/services/caseEmailService';

export function computeSenderDisplay(
  email: CaseEmailItem,
  currentUserId: string | null,
): string {
  if (email.direction === 'inbound') {
    const name = email.from.name?.trim();
    if (name) return name;
    return email.from.address.split('@')[0] || email.from.address;
  }
  // Giden
  if (email.source === 'notification_dispatch') return 'Varuna · Otomatik';
  if (email.sentByUserId && currentUserId && email.sentByUserId === currentUserId) {
    return 'Siz';
  }
  const sentByName = email.sentByName?.trim();
  if (sentByName) return sentByName;
  // Legacy: sentByUserId varsa ama sentByName join'lenemedi (silinen user)
  // ya da hiç sentByUserId yoktu (eski kayıt) → alias fallback.
  const alias = email.from.name?.trim();
  return alias || 'Varuna';
}
