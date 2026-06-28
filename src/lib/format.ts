export function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** Gelecekteki bir deadline için "N gün kaldı" / "N sa kaldı" / "N dk kaldı" döner. */
export function formatRemaining(iso?: string): string {
  if (!iso) return '—';
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return 'süre doldu';
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `${minutes} dk kaldı`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} sa kaldı`;
  return `${Math.round(hours / 24)} gün kaldı`;
}

export function formatRelative(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = d - now;
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);
  const sign = diffMs >= 0 ? 'sonra' : 'önce';
  if (minutes < 1) return 'şimdi';
  if (minutes < 60) return `${minutes} dk ${sign}`;
  if (hours < 24) return `${hours} sa ${sign}`;
  return `${days} gün ${sign}`;
}

/**
 * Aksiyonlarım row meta — gun-bazli okunabilir zaman.
 *
 *   <1 dakika    : "az önce"
 *   <60 dakika   : "12 dk önce"
 *   bugun        : "Bugün 14:32"
 *   dun          : "Dün 14:32"
 *   ayni yil     : "26 Mayıs"
 *   farkli yil   : "26 Mayıs 2025"
 */
export function formatRowTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return '—';

  const now = new Date();
  const diffMs = now.getTime() - ms;
  const absMin = Math.abs(diffMs) / 60_000;

  if (absMin < 1) return 'az önce';
  if (absMin < 60) return `${Math.floor(absMin)} dk önce`;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const dDay = new Date(d);
  dDay.setHours(0, 0, 0, 0);

  const timeStr = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

  if (dDay.getTime() === today.getTime()) return `Bugün ${timeStr}`;
  if (dDay.getTime() === yesterday.getTime()) return `Dün ${timeStr}`;

  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
