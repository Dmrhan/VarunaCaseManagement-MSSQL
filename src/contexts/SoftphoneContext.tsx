// SoftphoneContext — AloTech softphone, İKİ MOD:
//  • embedded : AloTech'in KENDİ hosted softphone'unu Varuna İÇİNE iframe olarak gömer
//               (softphone.alo-tech.com/<build>/). WebRTC/SIP/register/usephone'u
//               AloTech'in sayfası halleder — agent çağrıyı gömülü panelde cevaplar.
//               Varuna: screen-pop + agent durumu + outbound (click2call).
//  • click2call: sunucu-tetikli çaldırma + polling (screen pop). Softphone paneli açmaz.
// Mod: VITE_ALOTECH_SOFTPHONE_MODE — 'popup' (veya geri-uyumlu 'embedded') → softphone
//   popup; başka her şey (default) → 'click2call'.
import { createContext, useContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../services/AuthContext';
import { notify } from '../components/ui/Toast';
import {
  fetchAgentStatus, callViaClick2Call, hangupCall, fetchActiveCall, setAgentStatusApi,
  fetchSoftphoneSession, buildSoftphoneIframeUrl,
  getAlotechEmail, setAlotechEmail,
  isAlotechDisabled,
  type AgentStatusValue,
} from '../services/softphoneService';

// 'popup' (önerilen, net) veya geri-uyumlu 'embedded' → AloTech hosted softphone
// popup'ı. Diğer her şey (default dahil) → click2call.
const _SP_MODE = ((import.meta as any).env?.VITE_ALOTECH_SOFTPHONE_MODE as string) || 'click2call';
const MODE = _SP_MODE === 'popup' || _SP_MODE === 'embedded' ? 'embedded' : 'click2call';
const isEmbedded = MODE === 'embedded';

// 'disabled' — backend AloTech env'leri eksik (configured:false). Widget
// sessizce gizlenir, poll durur, toast spam'i bitmiş olur.
export type SoftphoneStatus = 'idle' | 'connecting' | 'ready' | 'error' | 'disabled';
export type CallStatus = 'ringing' | 'active' | 'hold';

export interface ActiveCall {
  number: string;
  name?: string;
  direction: 'inbound' | 'outbound';
  status: CallStatus;
  startedAt: number;
  caseId?: string;
}

export interface IncomingCall {
  number: string;
  queue?: string;
  key: string;
  status: string;
  matchedName?: string;
  /** Gelen (inbound) çağrı mı — otomatik screen-pop yalnız inbound'da tetiklenir. */
  inbound: boolean;
  // Faz 2 — /active-call enrichment: gelen çağrı webhook'unun şifresinden çözülen
  // müşteri (screen-pop'u callerId yerine buradan kesin açar) + link-call anahtarı.
  matchedAccountId?: string | null;
  matchedAccountName?: string | null;
  matchedProjectId?: string | null;
  matchedProjectName?: string | null;
  callLogKey?: string | null;
}

interface SoftphoneState {
  mode: 'embedded' | 'click2call';
  status: SoftphoneStatus;
  agentEmail: string | null;
  agentStatus: string | null;
  error: string | null;
  activeCall: ActiveCall | null;
  incomingCall: IncomingCall | null;
  muted: boolean;
  connect: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  dialNumber: (number: string, opts?: { caseId?: string; name?: string }) => Promise<void>;
  answerCall: () => void;
  /** Gömülü softphone iframe'inin src URL'i (embedded mod, hazır olunca dolu). */
  iframeUrl: string | null;
  /** Sağ-dock panel gizli mi (kullanıcı küçülttü). */
  panelCollapsed: boolean;
  setPanelCollapsed: (v: boolean) => void;
  /** Softphone bir kez açıldı mı — açıldıysa iframe mount kalır (küçültünce register düşmesin). */
  activated: boolean;
  /** Softphone panelini aç (header'daki launcher'dan) — activated=true + panelCollapsed=false. */
  openPanel: () => void;
  /** Embedded panel AÇIK → ana layout sağdan panel genişliği (300px) kadar boşluk
   *  ayırır → içerik panelin ALTINA girmez, arkasındaki butonlar tıklanabilir kalır. */
  dockReserved: boolean;
  endCall: () => void;
  toggleMute: () => void;
  toggleHold: () => void;
  dismissIncoming: () => void;
  changeStatus: (status: AgentStatusValue) => Promise<void>;
  saveAgentEmail: (email: string) => void;
}

const SoftphoneContext = createContext<SoftphoneState | null>(null);
export const SOFTPHONE_INCOMING_EVENT = 'varuna:softphone-incoming';
// Çağrı yanıtlandığında (talking/_Accept) — screen pop: callerId ile Akıllı Ticket aç.
export const SOFTPHONE_ANSWERED_EVENT = 'varuna:softphone-answered';

export function SoftphoneProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<SoftphoneStatus>('idle');
  const [agentEmail, setAgentEmail] = useState<string | null>(() => getAlotechEmail());
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [muted, setMuted] = useState(false);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  // Softphone paneli VARSAYILAN KAPALI gelir (ekran temiz) — sağ-altta "Softphone"
  // butonu görünür, tıklanınca panel + iframe açılır. (İstenirse env/kullanıcı tercihiyle
  // açık başlatılabilir; şimdilik kapalı.) Panel açılınca iframe mount olup register olur.
  const [panelCollapsed, setPanelCollapsed] = useState(true);
  // Softphone bir kez açıldı mı — açıldıysa iframe HEP mount kalır (küçültünce
  // register/oturum düşmesin, çağrı gelmeye devam etsin). Header launcher'ı açar.
  const [activated, setActivated] = useState(false);
  const startedRef = useRef(false);
  const lastIncomingKey = useRef<string | null>(null);
  const dismissedKey = useRef<string | null>(null);
  const lastInbound = useRef<{ callerId: string; queue: string; key: string; matchedAccountId?: string | null; matchedAccountName?: string | null; matchedProjectId?: string | null; matchedProjectName?: string | null; callLogKey?: string | null } | null>(null);
  const lastAnsweredKey = useRef<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await fetchAgentStatus();
      // Backend env eksik → softphone'u kalıcı 'disabled' moduna al; poll
      // useEffect'leri status !== 'ready' guard'ı ile zaten devre dışı kalır.
      if (isAlotechDisabled(s)) { setStatus('disabled'); return; }
      if (s) { setAgentEmail(s.agentEmail); setAgentStatus(s.status); }
    } catch { /* sessiz */ }
  }, []);

  const connect = useCallback(async () => {
    if (startedRef.current) return;
    // 'disabled' = backend env eksik → tekrar deneme.
    if (status === 'disabled') return;
    // click2call e-posta ister (agent-status için). Embedded (iframe) gerektirmez —
    // agent iframe'de login olur; backend session'ı ALOTECH_DEV_AGENT_EMAIL fallback'i
    // ile alır.
    if (!isEmbedded && !getAlotechEmail()) { setStatus('idle'); return; }
    startedRef.current = true;
    setStatus('connecting');
    setError(null);
    try {
      if (isEmbedded) {
        const sess = await fetchSoftphoneSession();
        if (isAlotechDisabled(sess)) {
          startedRef.current = false;
          setStatus('disabled');
          return;
        }
        setAgentEmail(sess.agentEmail);
        // Gömülü softphone iframe URL'ini kur (session ile otomatik login denenir).
        // Çağrı cevaplama + ses kontrolü gömülü panelde yapılır.
        setIframeUrl(buildSoftphoneIframeUrl(sess));
        setStatus('ready');
      } else {
        const s = await fetchAgentStatus();
        // Backend env eksik → sessiz disabled (toast YOK).
        if (isAlotechDisabled(s)) {
          startedRef.current = false;
          setStatus('disabled');
          return;
        }
        if (!s) throw new Error('AloTech agent bilgisi alınamadı');
        setAgentEmail(s.agentEmail);
        setAgentStatus(s.status);
        setStatus('ready');
      }
    } catch (err: any) {
      startedRef.current = false;
      setStatus('error');
      setError(err?.message ?? 'AloTech bağlantısı kurulamadı');
    }
  }, [status]);

  useEffect(() => {
    // Embedded e-posta gerektirmez (iframe + dev-agent fallback); click2call ister.
    if (user && status === 'idle' && (isEmbedded || getAlotechEmail())) void connect();
  }, [user, status, connect]);

  // Agent softphone'da AloTech e-postasını girer/değiştirir → kalıcı (localStorage)
  // + yeniden bağlan. Tüm AloTech çağrıları bu e-postayı header ile gönderir.
  const saveAgentEmail = useCallback((email: string) => {
    const clean = email.trim().toLowerCase();
    if (!clean.includes('@')) return;
    setAlotechEmail(clean);
    setAgentEmail(clean);
    startedRef.current = false;
    setStatus('connecting'); // email girilir girilmez bağlanıyor göster (widget kaybolmasın)
    void connect();
  }, [connect]);

  // NOT: Eski AWJS jQuery event aboneliği kaldırıldı — softphone artık ayrı bir
  // AloTech penceresinde (popup) çalışıyor; Varuna penceresinde AJS/AWJS yok.
  // Çağrı durumu HER İKİ modda aşağıdaki polling ile yakalanır.

  // ── POLLING: gelen çağrı + gerçek durum (HER İKİ MOD — IP gerektirmez).
  // Embedded modda da çalışır: gelen çağrı sunucu tarafından (callerId ile) yakalanır,
  // banner/screen pop gösterilir; ses/cevaplama AJS üzerindendir (sabit IP).
  useEffect(() => {
    if (status !== 'ready') return;
    let alive = true;
    const poll = async () => {
      // WR-PERF — sekme gizliyken (arka planda) sunucuyu polling'le yorma.
      if (typeof document !== 'undefined' && document.hidden) return;
      const r = await fetchActiveCall().catch(() => undefined);
      if (!alive) return;
      // Backend env eksik → disabled'a düş + sonraki poll'leri durdur.
      // (alive=false; useEffect cleanup interval'ı temizler.)
      if (isAlotechDisabled(r)) {
        alive = false;
        setStatus('disabled');
        return;
      }
      if (r && 'agentStatus' in r) {
        // Çağrı yanıtlandığında (talking) → screen pop event, çağrı başına BİR KEZ.
        // Dedup STABİL çağrı key'i ile (dev fix: 2sn'de bir re-dispatch etmesin).
        // Detail'e Faz 2 enrichment (şifreden çözülen müşteri + link anahtarı) eklenir.
        if (r.agentStatus === 'talking' && lastInbound.current && lastAnsweredKey.current !== lastInbound.current.key) {
          lastAnsweredKey.current = lastInbound.current.key;
          window.dispatchEvent(new CustomEvent(SOFTPHONE_ANSWERED_EVENT, { detail: { number: lastInbound.current.callerId, key: lastInbound.current.key, matchedAccountId: lastInbound.current.matchedAccountId, matchedAccountName: lastInbound.current.matchedAccountName, matchedProjectId: lastInbound.current.matchedProjectId, matchedProjectName: lastInbound.current.matchedProjectName, callLogKey: lastInbound.current.callLogKey } }));
        } else if (r.agentStatus !== 'talking' && r.agentStatus !== 'ringing' && r.agentStatus !== 'dialing') {
          lastAnsweredKey.current = null;
        }
        setAgentStatus(r.agentStatus);
      }
      const inbound = (r?.calls || []).find((c) => c.inbound);
      if (inbound) lastInbound.current = { callerId: inbound.callerId, queue: inbound.queue, key: inbound.key, matchedAccountId: inbound.matchedAccountId ?? null, matchedAccountName: inbound.matchedAccountName ?? null, matchedProjectId: inbound.matchedProjectId ?? null, matchedProjectName: inbound.matchedProjectName ?? null, callLogKey: inbound.callLogKey ?? null };
      // Çağrı CEVAPLANDIYSA (talking) artık "gelen çağrı" DEĞİL → banner düşsün, ticket
      // bir daha açılmasın (dev fix: aktif çağrı MyActiveCalls'ta hâlâ inbound göründüğünden
      // eski `|| !!inbound` koşulu banner'ı asılı bırakıp screen-pop'u tekrar tetikliyordu).
      // lastInbound KORUNUR (ANSWERED dispatch/pop onu kullanır). Faz 2 enrichment src'ye taşınır.
      const answered = r?.agentStatus === 'talking';
      const ringing = r?.agentStatus === 'ringing' || r?.agentStatus === 'dialing' || !!inbound;
      if (answered) {
        setIncomingCall(null);
      } else if (ringing) {
        const src = inbound
          ? { callerId: inbound.callerId, queue: inbound.queue, key: inbound.key, matchedAccountId: inbound.matchedAccountId ?? null, matchedAccountName: inbound.matchedAccountName ?? null, matchedProjectId: inbound.matchedProjectId ?? null, matchedProjectName: inbound.matchedProjectName ?? null, callLogKey: inbound.callLogKey ?? null }
          : lastInbound.current;
        const key = src?.key || 'ringing';
        if (key !== dismissedKey.current && key !== lastIncomingKey.current) {
          lastIncomingKey.current = key;
          const call: IncomingCall = { number: src?.callerId || 'Bilinmeyen', queue: src?.queue, key, status: 'ringing', inbound: !!inbound, matchedAccountId: src?.matchedAccountId ?? null, matchedAccountName: src?.matchedAccountName ?? null, matchedProjectId: src?.matchedProjectId ?? null, matchedProjectName: src?.matchedProjectName ?? null, callLogKey: src?.callLogKey ?? null, matchedName: src?.matchedAccountName ?? undefined };
          setIncomingCall(call);
          window.dispatchEvent(new CustomEvent(SOFTPHONE_INCOMING_EVENT, { detail: call }));
        }
      } else {
        lastIncomingKey.current = null;
        dismissedKey.current = null;
        lastInbound.current = null;
        setIncomingCall(null);
      }
    };
    void poll();
    // WR-PERF — 2sn → 8sn. Yük altında her kullanıcının 2sn'de bir aktif-çağrı
    // polling'i DB (verifyJwt + enrichment) ve AloTech'i selliyordu → 502.
    const t = setInterval(() => { void poll(); }, 8000);
    // Sekme tekrar görünür olunca hemen bir kez yokla (gelen çağrıyı kaçırmamak için).
    const onVisible = () => { if (typeof document !== 'undefined' && !document.hidden) void poll(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(t);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [status]);

  // NOT: Varuna içi gelen-çağrı "bip" zili KALDIRILDI (kullanıcı isteği) — AloTech
  // softphone'unun kendi zili yeterli; Varuna sadece görsel bildirim (banner) gösterir.

  const dialNumber = useCallback(async (number: string, opts?: { caseId?: string; name?: string }) => {
    if (status !== 'ready') { notify({ type: 'error', title: 'AloTech hazır değil', message: 'Bağlantı bekleniyor.' }); return; }
    setActiveCall({ number, name: opts?.name, direction: 'outbound', status: 'ringing', startedAt: Date.now(), caseId: opts?.caseId });
    // Outbound her iki modda click2call ile: agent'ın kayıtlı cihazı (popup modda
    // AloTech softphone penceresi) çalar, açınca numara bağlanır.
    try {
      await callViaClick2Call(number, { caseId: opts?.caseId });
      notify({ type: 'success', title: 'Arama başlatıldı', message: `Telefonunuz çalacak, açınca ${opts?.name || number} bağlanır.` });
    } catch (err: any) {
      setActiveCall(null);
      notify({ type: 'error', title: 'Arama başarısız', message: err?.message ?? 'Çağrı başlatılamadı.' });
    }
  }, [status]);

  // Gömülü modda cevaplama softphone panelinde (iframe) yapılır → no-op.
  const answerCall = useCallback(() => {}, []);

  const endCall = useCallback(() => {
    setActiveCall(null);
    setIncomingCall(null);
    setMuted(false);
    // Sunucu tarafı reddet/kapat — REST (v1 click2hang). Popup modda agent
    // pencereden de kapatabilir; bu REST her iki modda çalışır.
    void hangupCall().catch(() => {
      notify({ type: 'error', title: 'Kapatma başarısız', message: 'Çağrı AloTech tarafında sonlandırılamadı.' });
    });
  }, []);

  // Popup modda sustur/beklet AloTech penceresinde yapılır (Varuna no-op).
  const toggleMute = useCallback(() => {}, []);
  const toggleHold = useCallback(() => {}, []);

  const dismissIncoming = useCallback(() => {
    dismissedKey.current = lastIncomingKey.current;
    setIncomingCall(null);
  }, []);

  const changeStatus = useCallback(async (next: AgentStatusValue) => {
    const prev = agentStatus;
    setAgentStatus(next);
    try {
      const r = await setAgentStatusApi(next);
      if (!r?.ok) { setAgentStatus(prev); notify({ type: 'error', title: 'Durum değişmedi', message: 'AloTech durumu güncellenemedi.' }); }
    } catch {
      setAgentStatus(prev);
      notify({ type: 'error', title: 'Durum değişmedi', message: 'AloTech durumu güncellenemedi.' });
    }
  }, [agentStatus]);

  // Softphone panelini aç — header'daki launcher'dan çağrılır. İlk açılışta iframe
  // mount olup register olur; sonra küçültülse de mount kalır (activated true kalır).
  const openPanel = useCallback(() => { setActivated(true); setPanelCollapsed(false); }, []);

  const value: SoftphoneState = {
    mode: MODE,
    status, agentEmail, agentStatus, error, activeCall, incomingCall, muted,
    connect, refreshStatus, dialNumber, answerCall, iframeUrl, endCall, toggleMute, toggleHold, dismissIncoming, changeStatus, saveAgentEmail,
    panelCollapsed, setPanelCollapsed, activated, openPanel,
    // Yalnız panel gerçekten görünürken (embedded + açıldı + küçültülmedi) yer ayır.
    dockReserved: isEmbedded && status !== 'disabled' && activated && !panelCollapsed,
  };
  return <SoftphoneContext.Provider value={value}>{children}</SoftphoneContext.Provider>;
}

export function useSoftphone(): SoftphoneState {
  const ctx = useContext(SoftphoneContext);
  if (!ctx) throw new Error('useSoftphone must be used within SoftphoneProvider');
  return ctx;
}
