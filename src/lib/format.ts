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

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
