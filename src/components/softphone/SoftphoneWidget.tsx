// AloTech softphone widget'ı — sağ altta sabit floating panel.
// embedded: gerçek çağrı kontrolü (mute/hold/kapat, AJS event'leriyle). click2call: çaldırma.
// AJS Varuna içine UI render etmez; tüm UI Varuna'nındır, AJS yalnız event/ses sağlar.
import { useEffect, useState } from 'react';
import { Phone, PhoneOff, Pause, Play, Mic, MicOff, Loader2, X, Pencil, LogIn } from 'lucide-react';
import { useSoftphone } from '../../contexts/SoftphoneContext';
import { AGENT_STATUSES, type AgentStatusValue } from '../../services/softphoneService';

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

const STATUS_TR: Record<string, string> = {
  available: 'Müsait', backoffice: 'Backoffice', talking: 'Görüşmede', dialing: 'Aranıyor',
  ringing: 'Çalıyor', aftercallwork: 'ACW', shortbreak: 'Kısa mola', lunch: 'Yemek',
  meeting: 'Toplantı', training: 'Eğitim', notanswering: 'Cevapsız',
};

const CALL_STATE_TR: Record<string, string> = { active: 'Görüşmede', hold: 'Beklemede', ringing: 'Çalıyor' };

export function SoftphoneWidget() {
  const { mode, status, agentStatus, agentEmail, error, activeCall, muted, dialNumber, endCall, toggleMute, toggleHold, changeStatus, saveAgentEmail } = useSoftphone();
  const [open, setOpen] = useState(false);
  const [dialInput, setDialInput] = useState('');
  const [now, setNow] = useState(Date.now());
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailInput, setEmailInput] = useState('');

  useEffect(() => {
    if (!activeCall) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeCall]);

  // Yalnızca AloTech env'leri eksikse (backend configured:false → 'disabled')
  // widget gizlenir. Aksi halde her zaman görünür: e-posta yoksa giriş formu,
  // e-posta girilince 'connecting'→durum gösterir (telefon iconu kaybolmaz).
  // NOT: eski "idle && agentEmail → return null" kaldırıldı — e-posta girilince
  // saveAgentEmail status'u 'connecting' yaptığı için widget kaybolmaz.
  if (status === 'disabled') return null;

  const isEmbedded = mode === 'embedded';
  const needsEmail = !agentEmail || editingEmail;
  const submitEmail = () => {
    if (!emailInput.includes('@')) return;
    saveAgentEmail(emailInput);
    setEditingEmail(false);
  };
  const dotColor = needsEmail ? 'bg-slate-400' : status === 'ready' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-400' : 'bg-rose-500';
  const statusLabel = status === 'connecting' ? 'Bağlanıyor…'
    : status === 'error' ? (error ?? 'Hata')
    : agentStatus ? (STATUS_TR[agentStatus] ?? agentStatus) : 'Hazır';
  const callStateLabel = activeCall
    ? (isEmbedded ? (CALL_STATE_TR[activeCall.status] ?? activeCall.status) : 'Çaldırılıyor — telefonunuzu açın')
    : '';

  return (
    <>
      {/* AJS'in numarayı okuduğu gizli input (embedded dial) */}
      <input id="AwjsPhoneNumber" type="hidden" readOnly />

      <div className="fixed bottom-4 right-4 z-40">
        {open ? (
          <div className="w-72 rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${dotColor} ${status === 'connecting' ? 'animate-pulse' : ''}`} />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{needsEmail ? 'AloTech · Giriş' : (isEmbedded ? 'AloTech Softphone' : 'AloTech · Ara')}</span>
              </div>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Kapat">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-3">
              {needsEmail ? (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">AloTech e-postanız</label>
                  <input
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitEmail(); }}
                    placeholder="ad.soyad@param.com.tr"
                    type="email"
                    autoFocus
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                  />
                  <button
                    onClick={submitEmail}
                    disabled={!emailInput.includes('@')}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                  >
                    <LogIn className="h-4 w-4" /> Bağlan
                  </button>
                  {editingEmail && agentEmail && (
                    <button onClick={() => { setEditingEmail(false); setEmailInput(''); }} className="w-full text-center text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                      Vazgeç
                    </button>
                  )}
                  <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500">AloTech agent hesabınızın e-postası. Tarayıcınızda saklanır; tüm çağrı işlemleri bununla yapılır.</p>
                </div>
              ) : (
              <>
              <div className="mb-2 flex items-center gap-2">
                {status === 'ready' ? (
                  <select
                    value={agentStatus && (AGENT_STATUSES as readonly string[]).includes(agentStatus) ? agentStatus : ''}
                    onChange={(e) => { if (e.target.value) void changeStatus(e.target.value as AgentStatusValue); }}
                    className="flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-blue-400 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
                    title="AloTech durumunu değiştir"
                  >
                    {!agentStatus || !(AGENT_STATUSES as readonly string[]).includes(agentStatus) ? (
                      <option value="">{statusLabel}</option>
                    ) : null}
                    {AGENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_TR[s] ?? s}</option>)}
                  </select>
                ) : (
                  <span className="text-xs text-slate-500 dark:text-slate-400">{statusLabel}</span>
                )}
              </div>
              {agentEmail && (
                <button
                  onClick={() => { setEmailInput(agentEmail); setEditingEmail(true); }}
                  className="mb-2 flex w-full items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
                  title="AloTech e-postasını değiştir"
                >
                  <Pencil className="h-3 w-3 shrink-0" />
                  <span className="truncate">{agentEmail}</span>
                </button>
              )}

              {activeCall ? (
                <div className="space-y-3">
                  <div className="rounded-lg bg-slate-50 p-3 text-center dark:bg-slate-700/50">
                    <div className="text-xs uppercase tracking-wide text-slate-400">
                      {activeCall.direction === 'inbound' ? 'Gelen' : 'Giden'} · {callStateLabel}
                    </div>
                    <div className="mt-1 text-lg font-semibold text-slate-800 dark:text-slate-100">{activeCall.name || activeCall.number}</div>
                    {activeCall.name && <div className="text-sm text-slate-500">{activeCall.number}</div>}
                    <div className="mt-1 font-mono text-sm text-slate-600 dark:text-slate-300">{fmtDuration(now - activeCall.startedAt)}</div>
                  </div>

                  {isEmbedded ? (
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={toggleMute} className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200" title={muted ? 'Sesi aç' : 'Sustur'}>
                        {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                      </button>
                      <button onClick={toggleHold} className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200" title={activeCall.status === 'hold' ? 'Devam' : 'Beklet'}>
                        {activeCall.status === 'hold' ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
                      </button>
                      <button onClick={endCall} className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-500 text-white hover:bg-rose-600" title="Kapat">
                        <PhoneOff className="h-5 w-5" />
                      </button>
                    </div>
                  ) : (
                    <button onClick={endCall} className="flex w-full items-center justify-center gap-2 rounded-lg bg-rose-500 py-2 text-sm font-medium text-white hover:bg-rose-600">
                      <PhoneOff className="h-4 w-4" /> Kapat
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={dialInput}
                    onChange={(e) => setDialInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && dialInput) { void dialNumber(dialInput); setDialInput(''); } }}
                    placeholder="Numara…"
                    inputMode="tel"
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                  />
                  <button
                    onClick={() => { if (dialInput) { void dialNumber(dialInput); setDialInput(''); } }}
                    disabled={!dialInput || status !== 'ready'}
                    className="flex items-center justify-center rounded-lg bg-emerald-500 px-3 text-white hover:bg-emerald-600 disabled:opacity-40"
                    title="Ara"
                  >
                    <Phone className="h-5 w-5" />
                  </button>
                </div>
              )}
              </>
              )}
            </div>
          </div>
        ) : (
          <button
            onClick={() => setOpen(true)}
            className="relative flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700"
            title="AloTech Softphone"
          >
            {status === 'connecting' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Phone className="h-5 w-5" />}
            {activeCall && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 animate-pulse rounded-full bg-emerald-400 ring-2 ring-white dark:ring-slate-900" />}
          </button>
        )}
      </div>
    </>
  );
}
