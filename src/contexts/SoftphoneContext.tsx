// SoftphoneContext — AloTech softphone, İKİ MOD:
//  • embedded : AloTech'in KENDİ hosted softphone'unu POPUP olarak açar
//               (softphone.alo-tech.com/<build>/). WebRTC/SIP/register/usephone'u
//               AloTech'in sayfası halleder — next4biz ile aynı yöntem. Agent çağrıyı
//               popup'ta cevaplar; Varuna screen-pop + agent durumu + outbound (click2call) yapar.
//  • click2call: sunucu-tetikli çaldırma + polling (screen pop). Softphone penceresi açmaz.
// Mod: import.meta.env.VITE_ALOTECH_SOFTPHONE_MODE ('embedded' | 'click2call', default click2call).
import { createContext, useContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../services/AuthContext';
import { notify } from '../components/ui/Toast';
import {
  fetchAgentStatus, callViaClick2Call, hangupCall, fetchActiveCall, setAgentStatusApi,
  fetchSoftphoneSession, openSoftphonePopup, focusSoftphonePopup,
  getAlotechEmail, setAlotechEmail,
  isAlotechDisabled,
  type AgentStatusValue,
} from '../services/softphoneService';

const MODE = (((import.meta as any).env?.VITE_ALOTECH_SOFTPHONE_MODE as string) || 'click2call') === 'embedded'
  ? 'embedded' : 'click2call';
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
  /** AloTech hosted softphone popup'ını açar/öne getirir (embedded/popup mod). */
  openSoftphone: () => void;
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
  const startedRef = useRef(false);
  const lastIncomingKey = useRef<string | null>(null);
  const dismissedKey = useRef<string | null>(null);
  const lastInbound = useRef<{ callerId: string; queue: string; key: string } | null>(null);
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
    // Agent AloTech e-postası girilmemişse bağlanma — widget'tan girilmesi beklenir.
    if (!getAlotechEmail()) { setStatus('idle'); return; }
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
        // AloTech'in hosted softphone'unu popup olarak aç (session ile otomatik login
        // denenir). Çağrı cevaplama + ses kontrolü bu pencerede yapılır.
        openSoftphonePopup(sess);
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
    if (user && status === 'idle' && getAlotechEmail()) void connect();
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
        // Çağrı yanıtlandığında (talking) → screen pop event (callerId ile, bir kez).
        if (r.agentStatus === 'talking' && lastAnsweredKey.current !== (lastInbound.current?.key ?? null)) {
          lastAnsweredKey.current = lastInbound.current?.key ?? 'answered';
          window.dispatchEvent(new CustomEvent(SOFTPHONE_ANSWERED_EVENT, { detail: { number: lastInbound.current?.callerId } }));
        } else if (r.agentStatus !== 'talking' && r.agentStatus !== 'ringing' && r.agentStatus !== 'dialing') {
          lastAnsweredKey.current = null;
        }
        setAgentStatus(r.agentStatus);
      }
      const inbound = (r?.calls || []).find((c) => c.inbound);
      if (inbound) lastInbound.current = { callerId: inbound.callerId, queue: inbound.queue, key: inbound.key };
      // Gelen çağrı banner'ı: agent "ringing"/"dialing" olduğu sürece (telefon çaldığı
      // süre) göster. callerId /activecall/user'dan yakalanınca saklanır (kısa görünür).
      const ringing = r?.agentStatus === 'ringing' || r?.agentStatus === 'dialing' || !!inbound;
      if (ringing) {
        const src = inbound ? { callerId: inbound.callerId, queue: inbound.queue, key: inbound.key } : lastInbound.current;
        const key = src?.key || 'ringing';
        if (key !== dismissedKey.current && key !== lastIncomingKey.current) {
          lastIncomingKey.current = key;
          const call: IncomingCall = { number: src?.callerId || 'Bilinmeyen', queue: src?.queue, key, status: 'ringing' };
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
    const t = setInterval(() => { void poll(); }, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [status]);

  // Gelen çağrı zili — Web Audio ile programatik (dosyasız, on-prem dostu).
  // Çağrı çalarken periyodik bip; cevaplanınca/reddedilince (incomingCall değişince) durur.
  useEffect(() => {
    if (!incomingCall || incomingCall.status !== 'ringing') return;
    let stopped = false;
    let ctx: AudioContext | null = null;
    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch { return; }
    const beep = () => {
      if (stopped || !ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 480;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t0 = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.85);
      osc.start(t0);
      osc.stop(t0 + 0.9);
    };
    beep();
    const iv = setInterval(beep, 2000);
    return () => { stopped = true; clearInterval(iv); void ctx?.close().catch(() => {}); };
  }, [incomingCall]);

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

  // Popup modda cevaplama AloTech penceresinde yapılır — pencereyi öne getir.
  const answerCall = useCallback(() => { if (isEmbedded) focusSoftphonePopup(); }, []);

  // Softphone popup'ını aç/öne getir (kapanmışsa session ile yeniden aç).
  const openSoftphone = useCallback(() => {
    void (async () => {
      if (focusSoftphonePopup()) return;
      try {
        const sess = await fetchSoftphoneSession();
        openSoftphonePopup(isAlotechDisabled(sess) ? null : sess);
      } catch {
        openSoftphonePopup();
      }
    })();
  }, []);

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

  const value: SoftphoneState = {
    mode: MODE,
    status, agentEmail, agentStatus, error, activeCall, incomingCall, muted,
    connect, refreshStatus, dialNumber, answerCall, openSoftphone, endCall, toggleMute, toggleHold, dismissIncoming, changeStatus, saveAgentEmail,
  };
  return <SoftphoneContext.Provider value={value}>{children}</SoftphoneContext.Provider>;
}

export function useSoftphone(): SoftphoneState {
  const ctx = useContext(SoftphoneContext);
  if (!ctx) throw new Error('useSoftphone must be used within SoftphoneProvider');
  return ctx;
}
