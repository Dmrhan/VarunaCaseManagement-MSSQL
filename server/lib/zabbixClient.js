/**
 * zabbixClient.js — 2026-07-10 (Sistem Sağlığı Faz 1)
 *
 * Zabbix JSON-RPC API istemcisi. UniCP (Univera Connect Portal) ZabbixService
 * deseninin Node portu — kaynak: kullanıcı tarafından verilen entegrasyon
 * dokümanı. Yön: Varuna ← Zabbix (makine metrikleri; CPU/RAM/disk/gecikme).
 * Faz 2'deki Sistem Sağlığı panosu tüketir; Faz 1'de keşif/debug için hazır.
 *
 * Tasarım kararları (doküman + Varuna kısıtları):
 *  - Login token TEK SEFER alınır ve cache'lenir; paralel çağrılarda tek
 *    login garantisi login-PROMISE cache'i ile (SemaphoreSlim'in JS muadili:
 *    ilk çağrı promise'i yaratır, eşzamanlılar aynı promise'i await eder).
 *  - Auth hatasında token düşürülür + BİR kez yeniden login denenir
 *    (token süre dolumu senaryosu).
 *  - Zabbix ≥6.4: login parametresi `username` (eski sürümlerde `user` —
 *    UniCP `username` kullanıyor → Univera sunucusu 6.4+).
 *  - Sayılar JSON'da STRING döner ("42.5") — parseFloat ile çevrilir.
 *  - `history.get`'te history tipi item'ın value_type'ı ile eşleşmeli
 *    (0=float, 3=unsigned) yoksa BOŞ döner — çağıran value_type'ı geçirmeli.
 *  - Env yoksa istemci "yapılandırılmamış" moddadır: isConfigured()=false,
 *    çağrılar anlaşılır hata fırlatır. Health endpoint'i bu modu görüp
 *    "zabbix: not_configured" raporlar — hiçbir akış Zabbix'e BAĞIMLI değildir.
 *  - Tüm istekler AbortController ile 5 sn timeout — sağlık uçları asılı kalmaz.
 *  - Loglarda şifre asla yazılmaz.
 *
 * Env:
 *   ZABBIX_API_URL   örn. http://<host>/zabbix/api_jsonrpc.php
 *   ZABBIX_USERNAME  read-only kullanıcı (yalnız ilgili host grubuna erişim)
 *   ZABBIX_PASSWORD
 */

const REQUEST_TIMEOUT_MS = 5000;

let authToken = null;
let loginPromise = null; // in-flight login (tek-login garantisi)
let rpcId = 0;

function cfg() {
  return {
    apiUrl: process.env.ZABBIX_API_URL ?? '',
    username: process.env.ZABBIX_USERNAME ?? '',
    password: process.env.ZABBIX_PASSWORD ?? '',
  };
}

export function isConfigured() {
  const c = cfg();
  return Boolean(c.apiUrl && c.username && c.password);
}

/** Ham JSON-RPC çağrısı. Şifre loglanmaz; error alanı exception'a çevrilir. */
async function rpc(method, params, { auth = null } = {}) {
  const { apiUrl } = cfg();
  if (!isConfigured()) {
    throw new Error('Zabbix yapılandırılmamış (ZABBIX_API_URL/USERNAME/PASSWORD env eksik).');
  }
  const payload = { jsonrpc: '2.0', method, params, id: ++rpcId };
  if (auth) payload.auth = auth;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
  } catch (err) {
    throw new Error(`Zabbix erişilemedi (${method}): ${err?.name === 'AbortError' ? `timeout ${REQUEST_TIMEOUT_MS}ms` : err?.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Zabbix HTTP ${res.status} (${method})`);
  const body = await res.json();
  if (body?.error) {
    throw new Error(`Zabbix API ${body.error.code}: ${body.error.message} | ${body.error.data ?? ''}`);
  }
  return body?.result;
}

/** Token yoksa login olur; eşzamanlı çağrılar tek login'i paylaşır. */
async function ensureAuthenticated() {
  if (authToken) return authToken;
  if (!loginPromise) {
    const { username, password } = cfg();
    loginPromise = rpc('user.login', { username, password })
      .then((token) => {
        authToken = token;
        return token;
      })
      .finally(() => { loginPromise = null; });
  }
  return loginPromise;
}

/** Auth'lu çağrı + token süre dolumunda tek retry. */
async function authedRpc(method, params) {
  const token = await ensureAuthenticated();
  try {
    return await rpc(method, params, { auth: token });
  } catch (err) {
    const msg = String(err?.message ?? '');
    // -32602 "Not authorised" / session terminate → token düşür, bir kez yeniden dene
    if (/not authori[sz]ed|session term|re-?login/i.test(msg)) {
      authToken = null;
      const fresh = await ensureAuthenticated();
      return rpc(method, params, { auth: fresh });
    }
    throw err;
  }
}

export const zabbixClient = {
  isConfigured,

  /**
   * Host'un item'larını getirir. keySearch boş → tümü (keşif/debug için;
   * yeni ortamda doğru key'leri bulmanın yolu budur — doküman 7.8).
   * @returns {Promise<Array<{itemid,name,key_,lastvalue,units,value_type}>>}
   */
  async getItems(hostId, keySearch = '') {
    const params = {
      output: ['itemid', 'name', 'key_', 'lastvalue', 'units', 'value_type'],
      hostids: String(hostId),
      sortfield: 'name',
    };
    if (keySearch) {
      params.search = { key_: keySearch };
      params.searchWildcardsEnabled = true; // key içinde * desteği
    }
    const result = await authedRpc('item.get', params);
    return Array.isArray(result) ? result : [];
  },

  /**
   * İlk eşleşen item'ın son sayısal değeri (yoksa null).
   * Zabbix değeri string döndürür → parseFloat.
   */
  async getLatestValue(hostId, keySearch) {
    const items = await this.getItems(hostId, keySearch);
    const item = items[0];
    if (!item) return null;
    const v = Number.parseFloat(item.lastvalue);
    return Number.isFinite(v) ? v : null;
  },

  /**
   * Zaman serisi geçmişi. historyType, item'ın value_type'ı ile EŞLEŞMELİ
   * (0=float, 3=unsigned) — eşleşmezse Zabbix boş döner (hata değil).
   * @returns {Promise<Array<{clock:number, value:number}>>} epoch sn + sayı
   */
  async getHistory(itemId, historyType, timeFromEpochSec, timeTillEpochSec) {
    const result = await authedRpc('history.get', {
      output: 'extend',
      history: historyType,
      itemids: String(itemId),
      sortfield: 'clock',
      sortorder: 'ASC',
      time_from: Math.floor(timeFromEpochSec),
      time_till: Math.floor(timeTillEpochSec),
    });
    return (Array.isArray(result) ? result : []).map((r) => ({
      clock: Number.parseInt(r.clock, 10) || 0,
      value: Number.parseFloat(r.value) || 0,
    }));
  },

  /** Bağlantı sağlığı: login + apiinfo. Sağlıksa {ok:true, ms} döner. */
  async ping() {
    const t0 = Date.now();
    await ensureAuthenticated();
    // apiinfo.version auth istemez ama login'in çalıştığını zaten kanıtladık;
    // hafif bir authed çağrıyla uçtan uca doğrula (kendi kullanıcı bilgisi).
    await authedRpc('host.get', { output: ['hostid'], limit: 1 });
    return { ok: true, ms: Date.now() - t0 };
  },

  /** Test yardımcıları (smoke) — üretim akışında kullanılmaz. */
  _resetForTests() { authToken = null; loginPromise = null; },
};
