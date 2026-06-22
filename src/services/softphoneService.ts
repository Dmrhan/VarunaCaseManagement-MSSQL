// AloTech SoftphoneJS (AWJS) ince sarmalayıcı.
// AWJS WebRTC+JSSIP tabanlı; jQuery event trigger kullanır. Script'ler runtime
// yüklenir (on-prem'de internet yoksa app bloklanmaz, softphone sessizce kapalı kalır).
import { apiFetch } from './caseService';

declare global {
  interface Window {
    AJS?: any;
    jQuery?: any;
    $?: any;
    BoranChannel?: any;
  }
}

// AloTech softphone reçetesi — AloTech'in KENDİ softphone'unun yüklediği script'ler:
// jQuery 1.11.2 → boran.min.js (opsiyonel; AloTech'in kendisinde de 404, ama çalışıyor) → ajs.js (AJS).
// NOT: AloTech softphone'u ajs.js kullanıyor (webrtc.js/JsSIP DEĞİL).
const JQUERY_SRC = 'https://ajax.googleapis.com/ajax/libs/jquery/1.11.2/jquery.min.js';
const AJS_SRC = 'https://softphone.alo-tech.com/static/ajs/v1/ajs.js';
// boran.min.js tenant'a özel: https://{hostname}/v2/tr/js/boran.min.js

let scriptsLoaded = false;
let loadingPromise: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.async = false; // sıra önemli
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Script yüklenemedi: ${src}`));
    document.head.appendChild(s);
  });
}

/** AloTech softphone (AJS) bağımlılıklarını yükler (jQuery → boran(opsiyonel) → ajs.js). */
export async function ensureAjsLoaded(hostname: string): Promise<void> {
  if (scriptsLoaded && window.AJS) return;
  if (loadingPromise) return loadingPromise;
  const boranSrc = `https://${hostname}/v2/tr/js/boran.min.js`;
  loadingPromise = (async () => {
    if (!window.jQuery) await loadScript(JQUERY_SRC);
    // boran.min.js opsiyonel — AloTech'in kendi softphone'unda da 404 ama çalışıyor.
    // Yüklenemezse AJS'in createBoranChannel() çağrısı "BoranChannel is not defined"
    // ReferenceError vermesin diye no-op stub atanır (boran sadece ek veri kanalı).
    if (!window.BoranChannel) {
      await loadScript(boranSrc).catch((e) => {
        console.warn('[softphone] boran.min.js yok (opsiyonel, AloTech kendisinde de 404):', e.message);
        window.BoranChannel = function BoranChannelStub() {
          return { onMessage() {}, send() {}, close() {}, connect() {}, subscribe() {} };
        } as any;
      });
    }
    if (!window.AJS) await loadScript(AJS_SRC);
    scriptsLoaded = true;
  })();
  return loadingPromise;
}

export interface SoftphoneSession {
  session: string;
  hostname: string;
  tenant: string;
  expiresIn: number;
  agentEmail: string;
}

// ── Click2Call modu (sunucu-tetikli çaldırma; statik IP / WebRTC gerektirmez) ──
export interface AgentStatus {
  agentEmail: string;
  status: string | null;
  agentName: string | null;
}

/** Giriş yapan agent'ın AloTech müsaitlik durumu. */
export async function fetchAgentStatus(): Promise<AgentStatus | undefined> {
  return apiFetch<AgentStatus>('/api/integrations/alotech/agent-status', {}, 'Agent durumu');
}

/** Geçerli agent durumları (AloTech v1). */
export const AGENT_STATUSES = ['available', 'backoffice', 'aftercallwork', 'shortbreak', 'lunch', 'training', 'meeting'] as const;
export type AgentStatusValue = typeof AGENT_STATUSES[number];

/** Agent müsaitlik durumunu değiştir (v1 /agent/status). */
export async function setAgentStatusApi(status: AgentStatusValue): Promise<{ ok: boolean; status: string } | undefined> {
  return apiFetch('/api/integrations/alotech/set-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  }, 'Durum değiştirme');
}

/** Click2Call — agent telefonu çalar, açınca numara bağlanır. caseId vakaya bağlar. */
export async function callViaClick2Call(phoneNumber: string, opts?: { caseId?: string }): Promise<{ ok: boolean } | undefined> {
  return apiFetch('/api/integrations/alotech/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber, caseId: opts?.caseId }),
  }, 'Arama');
}

export interface ActiveCallInfo {
  callId: string;
  callerId: string;
  calledNum: string;
  queue: string;
  inbound: boolean;
  status: string; // ringing | talking | ...
  callDate: string;
  key: string;
}

/** Agent'ın o anki aktif/çalan çağrıları + gerçek müsaitlik durumu (polling). */
export async function fetchActiveCall(): Promise<{ calls: ActiveCallInfo[]; agentStatus: string | null } | undefined> {
  return apiFetch('/api/integrations/alotech/active-call', {}, 'Aktif çağrı');
}

/** Aktif çağrıyı/çaldırmayı sonlandırır (v1 click2hang). */
export async function hangupCall(): Promise<{ ok: boolean } | undefined> {
  return apiFetch('/api/integrations/alotech/hangup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }, 'Çağrıyı kapatma');
}

/** Backend'den giriş yapan kullanıcının AloTech session key'ini alır. */
export async function fetchSoftphoneSession(): Promise<SoftphoneSession> {
  const data = await apiFetch<SoftphoneSession>(
    '/api/integrations/alotech/session',
    {},
    'Softphone oturumu',
  );
  if (!data?.session) throw new Error('AloTech session alınamadı');
  return data;
}

interface InitOptions {
  onLogout?: (resp: any) => void;
  onMediaFailed?: (resp: any) => void;
}

/** AWJS.init + start. Script'lerin yüklü olması gerekir. */
export async function startSoftphone(sess: SoftphoneSession, opts: InitOptions = {}): Promise<void> {
  await ensureAjsLoaded(sess.hostname);
  const AJS = window.AJS;
  if (!AJS) throw new Error('AJS (ajs.js) yüklenemedi');
  // AloTech'in kendi softphone demo'sundaki init imzası (user + session + hostname).
  AJS.init({
    user: sess.agentEmail,
    session: sess.session,
    hostname: sess.hostname,
    inputPhoneNumber: '#AwjsPhoneNumber',
    onLogout: opts.onLogout,
  });
  AJS.start();
}

// ── Çağrı kontrolleri (AJS click handler'ları) ───────────────────────
export function dial(number: string): void {
  const input = document.querySelector<HTMLInputElement>('#AwjsPhoneNumber');
  if (input) input.value = number;
  window.AJS?.dial_click?.();
}
export function answer(): void { window.AJS?.answer_click?.(); }
export function hangup(): void { window.AJS?.hangup_click?.(); }
export function hold(): void { window.AJS?.hold_click?.(); }
export function unhold(): void { window.AJS?.unhold_click?.(); }
export function toggleMute(): void { window.AJS?.MuteMicToggle?.(); }
export function setAgentStatus(status: string): void { window.AJS?.setAgentStatus?.(status); }

// ── Event dinleme (jQuery trigger) ───────────────────────────────────
export type AwjsHandler = (eventData: any, message?: any) => void;

/** AWJS jQuery event'ine abone olur. Cleanup fonksiyonu döner. */
export function onAwjsEvent(type: string, cb: AwjsHandler): () => void {
  const $ = window.jQuery;
  if (!$) return () => {};
  const handler = (e: any) => cb(e?.eventData, e?.message);
  $(document).on(type, handler);
  return () => $(document).off(type, handler);
}

export const AWJS_EVENTS = {
  IncomingCall: '_IncomingCall',
  Accept: '_Accept',
  ShowRinging: '_ShowRinging',
  Hangup: '_Hangup',
  Hold: '_Hold',
  Connected: '_Connected',
  Disconnected: '_Disconnected',
  Registered: '_Registered',
  Unregistered: '_Unregistered',
  RegistrationFailed: '_RegistrationFailed',
  AgentStatus: '_AgentStatus',
} as const;
