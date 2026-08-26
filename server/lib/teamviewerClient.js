/**
 * TeamViewer Web API — bağlantı raporu istemcisi (Option B / reconcile).
 *
 * Yalnız OKUMA: GET /api/v1/reports/connections (token yetkisi: "Connection
 * Reporting → View connection reports"). Uzak destek oturumlarının gerçek
 * start/end/deviceid'sini çeker; CaseRemoteSession reconcile bunu kullanır.
 *
 * Config: TEAMVIEWER_API_TOKEN (zorunlu), TEAMVIEWER_API_BASE (opsiyonel).
 * Yalnız Corporate/Tensor lisansında + bağlantı loglama açıkken veri döner.
 */
const BASE = process.env.TEAMVIEWER_API_BASE || 'https://webapi.teamviewer.com';

export function isTeamViewerConfigured() {
  return !!process.env.TEAMVIEWER_API_TOKEN;
}

const iso = (d) => new Date(d).toISOString().slice(0, 19) + 'Z';

/**
 * Verilen aralıktaki tüm bağlantı kayıtlarını (sayfalama dahil) döner.
 * @param {{ from: Date|string, to: Date|string }} range
 * @returns {Promise<{ ok: boolean, records?: Array, error?: {status?:number,message:string} }>}
 */
export async function fetchConnections({ from, to }) {
  const token = process.env.TEAMVIEWER_API_TOKEN;
  if (!token) {
    return { ok: false, error: { message: 'TEAMVIEWER_API_TOKEN tanımlı değil.' } };
  }
  const out = [];
  let offsetId = null;
  let page = 0;
  try {
    do {
      const qs = new URLSearchParams({ from_date: iso(from), to_date: iso(to) });
      if (offsetId) qs.set('offset_id', offsetId);
      const res = await fetch(`${BASE}/api/v1/reports/connections?${qs}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      const text = await res.text();
      if (!res.ok) {
        return { ok: false, error: { status: res.status, message: text.slice(0, 300) } };
      }
      const data = JSON.parse(text);
      const records = data.records || data.connections || [];
      out.push(...records);
      offsetId = data.next_offset || null;
      if (!offsetId) break;
      if (++page > 50) break; // güvenlik
    } while (offsetId);
    return { ok: true, records: out };
  } catch (err) {
    return { ok: false, error: { message: String(err?.message ?? err).slice(0, 200) } };
  }
}

/** Bağlantı kaydının süresini saniye olarak verir (end - start). */
export function connectionDurationSec(rec) {
  if (!rec?.start_date || !rec?.end_date) return null;
  const s = (new Date(rec.end_date) - new Date(rec.start_date)) / 1000;
  return Number.isFinite(s) ? Math.max(0, Math.round(s)) : null;
}
