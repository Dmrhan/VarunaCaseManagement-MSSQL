import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronRight,
  Inbox,
  Loader2,
  Lock,
  PauseCircle,
  RotateCw,
  Search as SearchIcon,
  Sparkles,
  TrendingUp,
  Wand2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { VoiceNoteButton } from '@/components/ui/VoiceNoteButton';
import { RunaAiCard } from '@/components/ui/RunaAiCard';
import {
  caseService,
  lookupService,
  type SmartTicketTaxonomyResponse,
  type SmartTicketTaxonomyItem,
  type SuggestClosureResponse,
} from '@/services/caseService';
import { useAuth } from '@/services/AuthContext';
import { CustomerMatchSuggestionsPanel } from './components/CustomerMatchSuggestionsPanel';
import { AccountSearchPicker } from '@/features/accounts/AccountSearchPicker';
import { aiService, aiErrorMessage } from '@/services/aiService';
import { externalKbService } from '@/services/externalKbService';
import {
  buildClosureSuggestionTelemetry,
  type AppliedClosureSelection,
} from '@/services/closureTelemetry';
import { MentionTextarea } from './components/MentionTextarea';

// Mention regex — `@[Name](userId)` formatı. Bir text bunu içeriyorsa BE'nin
// CaseMention parse'ı tetiklensin diye yan-not (addNote) ekleriz.
const MENTION_RE = /@\[[^\]]+\]\([^)]+\)/;
import {
  CASE_STATUSES,
  ESCALATION_LEVELS,
  ESCALATION_LEVEL_LABELS,
  STATUS_TRANSITIONS,
  type Case,
  type CaseStatus,
  type EscalationLevel,
} from './types';

interface StatusTransitionPanelProps {
  item: Case;
  onApplied: (updated: Case) => void;
  /**
   * Compact Status Stepper'dan modal içinde preselect ile açılınca kullanılır.
   * Verilirse mount/değişiminde `pending` bu değere set edilir; akış aynı
   * panel ve aynı reason/closure mantığı ile devam eder.
   */
  initialPending?: CaseStatus | null;
  /**
   * Modal içinde reuse edilirken: panel header'ı ("Statü Geçişi" başlığı +
   * "Şu an" badge) ve 7 kartlık geçiş grid'i gizlenir. Hedef zaten Compact
   * Status Stepper'da seçilmiş; modal sadece zorunlu alanlar + Uygula/Vazgeç
   * gösterir. Reason/closure/KB/checklist logic'i AYNI dosyada, parçalanmaz.
   */
  compactMode?: boolean;
  /**
   * Vazgeç click'inde caller'a haber ver (Codex P2 — compactMode modal'ında
   * Vazgeç sadece pending'i temizliyordu; parent reasonTarget açık kalıp
   * boş modal görüntüsü oluşuyordu). compactMode için zorunlu pattern.
   */
  onCancel?: () => void;
}

// Spec 11.1 renk paletiyle uyumlu kart tonları
const STATUS_META: Record<CaseStatus, {
  icon: ReactNode;
  description: string;
  requirement?: string;
  ring: string;
  bg: string;
  text: string;
  selectedRing: string;
}> = {
  'Açık': {
    icon: <Inbox size={18} />,
    description: 'Yeni oluşturuldu, atama bekliyor.',
    ring: 'ring-blue-200',
    bg: 'bg-blue-50/40',
    text: 'text-blue-700',
    selectedRing: 'ring-blue-500',
  },
  'İncelemede': {
    icon: <SearchIcon size={18} />,
    description: 'Aktif olarak işleniyor.',
    ring: 'ring-amber-200',
    bg: 'bg-amber-50/40',
    text: 'text-amber-700',
    selectedRing: 'ring-amber-500',
  },
  '3rdPartyBekleniyor': {
    icon: <PauseCircle size={18} />,
    description: '3. partiden cevap bekleniyor; SLA durur.',
    requirement: '3. parti seçimi',
    ring: 'ring-slate-200',
    bg: 'bg-slate-50/60',
    text: 'text-slate-700',
    selectedRing: 'ring-slate-500',
  },
  'Eskalasyon': {
    icon: <TrendingUp size={18} />,
    description: 'Üst yönetime yükseltildi.',
    requirement: 'Seviye + gerekçe',
    ring: 'ring-rose-200',
    bg: 'bg-rose-50/40',
    text: 'text-rose-700',
    selectedRing: 'ring-rose-500',
  },
  'Çözüldü': {
    icon: <CheckCircle2 size={18} />,
    description: 'Sorun çözümlendi.',
    requirement: 'Çözüm notu zorunlu',
    ring: 'ring-emerald-200',
    bg: 'bg-emerald-50/40',
    text: 'text-emerald-700',
    selectedRing: 'ring-emerald-500',
  },
  'YenidenAcildi': {
    icon: <RotateCw size={18} />,
    description: 'Müşteri çözümden memnun değil.',
    ring: 'ring-violet-200',
    bg: 'bg-violet-50/40',
    text: 'text-violet-700',
    selectedRing: 'ring-violet-500',
  },
  'İptalEdildi': {
    icon: <Ban size={18} />,
    description: 'Talep geri çekildi (terminal).',
    requirement: 'Gerekçe zorunlu',
    ring: 'ring-slate-200',
    bg: 'bg-slate-100',
    text: 'text-slate-600',
    selectedRing: 'ring-slate-500',
  },
};

const STATUS_LABELS: Record<CaseStatus, string> = {
  'Açık':                'Açık',
  'İncelemede':          'İncelemede',
  '3rdPartyBekleniyor':  '3. Parti Bekleniyor',
  // LBD A9 — display rename (enum identifier 'Eskalasyon' korunur)
  'Eskalasyon':          'Eskale Edildi',
  'Çözüldü':             'Çözüldü',
  'YenidenAcildi':       'Yeniden Açıldı',
  'İptalEdildi':         'İptal Edildi',
};

export function StatusTransitionPanel({ item, onApplied, initialPending, compactMode = false, onCancel }: StatusTransitionPanelProps) {
  const allowedTransitions = useMemo(() => STATUS_TRANSITIONS[item.status], [item.status]);

  const [pending, setPending] = useState<CaseStatus | null>(initialPending ?? null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  // 2026-07-06 — Kapanış müşteri kapısı. Müşterisiz vaka Çözüldü'ye geçemez;
  // SystemAdmin istisna (backend guard ile aynı kural). linkAccount DB'ye
  // yazar → local linkedCustomer un-gate eder (item prop bu turda tazelenmez
  // ama transitionStatus taze DB okur, guard geçer).
  const { user } = useAuth();
  const [linkedCustomer, setLinkedCustomer] = useState<{ id: string; name: string } | null>(null);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const customerGateActive =
    pending === 'Çözüldü' &&
    !item.accountId &&
    !linkedCustomer &&
    user?.role !== 'SystemAdmin';
  async function handleLinkCustomer(accountId: string, accountName: string) {
    const updated = await caseService.linkAccount(item.id, accountId);
    if (updated) setLinkedCustomer({ id: accountId, name: accountName });
  }
  // Ürün Grubu kapısı — kapanışta veri kesinliği için zorunlu. Müşteri
  // kapısıyla aynı desen: SystemAdmin istisna, local override state
  // (productGroupSet) item prop'u bu turda tazelenmese bile ekranı
  // un-gate eder (backend transitionStatus taze DB okur, guard geçer).
  const [productGroupSet, setProductGroupSet] = useState<string | null>(null);
  const [productGroupDraft, setProductGroupDraft] = useState('');
  const [productGroupSaving, setProductGroupSaving] = useState(false);
  const productGroupGateActive =
    pending === 'Çözüldü' &&
    !item.productGroup &&
    !productGroupSet &&
    user?.role !== 'SystemAdmin';
  async function handleSaveProductGroup() {
    if (!productGroupDraft) return;
    setProductGroupSaving(true);
    try {
      const updated = await caseService.update(item.id, { productGroup: productGroupDraft });
      if (updated) setProductGroupSet(productGroupDraft);
    } finally {
      setProductGroupSaving(false);
    }
  }
  const [thirdPartyId, setThirdPartyId] = useState('');
  const [escalationLevel, setEscalationLevel] = useState<EscalationLevel | ''>('');
  const [escalationReason, setEscalationReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const { toast } = useToast();

  // WR-Smart-Ticket Phase 1e — yapılandırılmış kapanış metadata'sı.
  // Vaka Smart Ticket intake'inden açıldıysa Çözüldü kararında ek
  // dropdown'lar gösterilir. Diğer vakalarda görünmez.
  const isSmartTicket = !!(item.customFields as { smartTicket?: unknown } | undefined)?.smartTicket;
  const [closureRcg, setClosureRcg] = useState('');
  const [closureRcd, setClosureRcd] = useState('');
  const [closureRt, setClosureRt] = useState('');
  const [closurePp, setClosurePp] = useState('');
  const [closureTax, setClosureTax] = useState<SmartTicketTaxonomyResponse['taxonomies'] | null>(null);
  const [closureTaxLoading, setClosureTaxLoading] = useState(false);

  // PR-8 — Business review Madde 7. Case Detail close akışında KB
  // kapanış önerisi. Auto-fetch YOK; explicit buton. Klasik vakalarda
  // info-only kart (persist YOK); Smart Ticket vakalarda dropdown
  // pre-fill (kullanıcı onayıyla, mevcut Stage 3 closure pattern'i).
  // Approval / checklist / ResolutionApprovalPolicy guard'ları bypass
  // edilmez.
  // L2-Smart-Flow FAZ 1.1 — TENANT KAPISI: KB entegrasyonu kapalı şirkette
  // (örn. PARAM) KB önerisi + kapanış etiket bölümü GİZLENİR ve "KB analizi
  // zorunlu" kuralı UYGULANMAZ (taxonomy verisi olmayan kiracıda vaka
  // kapatılamaz hale geliyordu). null = yükleniyor (zorunluluk aktif kalır
  // — UNIVERA default'u güvenli taraf).
  const [kbEnabled, setKbEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    if (!item.companyId) return;
    void externalKbService
      .settingsStatus(item.companyId)
      .then((st) => { if (alive) setKbEnabled(st?.enabled === true); })
      .catch(() => { if (alive) setKbEnabled(null); });
    return () => { alive = false; };
  }, [item.companyId]);

  const [kbSuggesting, setKbSuggesting] = useState(false);
  const [kbSuggestion, setKbSuggestion] = useState<SuggestClosureResponse | null>(null);
  const [kbSuggestionError, setKbSuggestionError] = useState<string | null>(null);
  // Telemetry — AI önerisinin client'a ulaştığı an (ISO). Kapanış submit'inde
  // closureSuggestion.aiSuggested.suggestedAt'e yazılır.
  const kbSuggestedAtRef = useRef<string | null>(null);

  const thirdParties = useMemo(
    () => lookupService.thirdParties().filter((tp) => !tp.companyId || tp.companyId === item.companyId),
    [item.companyId],
  );

  // Vaka değişince akış sıfırlanır.
  // Codex PR-1e review P2 fix — Panel reuse (örn. L1WorkbenchPanel başka
  // case gönderdiğinde) önceki tenant'ın closure taxonomy cache'i ekrana
  // sızıp yanlış code/label persist edilebiliyordu. closureTax'i de
  // sıfırlıyoruz; yeni item için aşağıdaki fetch effect tetiklenir.
  useEffect(() => {
    setPending(initialPending ?? null);
    setResolutionNote('');
    setCancelReason('');
    setThirdPartyId('');
    setEscalationLevel('');
    setEscalationReason('');
    setError(null);
    setClosureRcg('');
    setClosureRcd('');
    setClosureRt('');
    setClosurePp('');
    setClosureTax(null);
    setKbSuggesting(false);
    setKbSuggestion(null);
    setKbSuggestionError(null);
    kbSuggestedAtRef.current = null;
    setLinkedCustomer(null); // 2026-07-06 — vaka değişince müşteri-bağla state'i sıfırla
    setCustomerPickerOpen(false);
    // initialPending kasıtlı olarak dep değil — panel mount'unda Compact
    // Stepper'dan gelen preselect bir kez uygulanır. Sonraki kullanıcı
    // tıklamaları normal akışla pending'i değiştirir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // Çözüldü kararı seçildiğinde taxonomy listelerini çek. Kapanış-tüm-vakalar
  // genişletmesi: klasik (mail/telefon) vakalarda da kapanış etiketi yazılır;
  // dropdown'lar herkese görünür. Endpoint per-tenant; companyId Case'de var.
  useEffect(() => {
    let alive = true;
    if (pending !== 'Çözüldü' || closureTax) return;
    setClosureTaxLoading(true);
    void lookupService
      .smartTicketTaxonomies(item.companyId)
      .then((res: SmartTicketTaxonomyResponse) => {
        if (!alive) return;
        setClosureTax(res.taxonomies);
      })
      .catch(() => {
        if (!alive) return;
        // Sessiz fallback: taxonomy çekilemezse alanlar disabled kalır,
        // case close bloke olmaz (spec).
        setClosureTax(null);
      })
      .finally(() => {
        if (alive) setClosureTaxLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [isSmartTicket, pending, item.companyId, closureTax]);

  // Kapanış decouple — rootCauseDetail rootCauseGroup'tan bağımsızdır; grup
  // değişiminde detayı sıfırlamaya gerek yok (tüm detaylar her zaman geçerli).
  // Eski "grup değişince detayı temizle" effect'i + suppress ref kaldırıldı.
  const closureRcgList: SmartTicketTaxonomyItem[] = closureTax?.rootCauseGroup ?? [];
  const closureRcdList: SmartTicketTaxonomyItem[] = closureTax?.rootCauseDetail ?? [];
  const closureRtList: SmartTicketTaxonomyItem[] = closureTax?.resolutionType ?? [];
  const closurePpList: SmartTicketTaxonomyItem[] = closureTax?.permanentPrevention ?? [];

  /**
   * PR-8 — KB ile kapanış önerisi.
   *
   * Smart Ticket vakası: caseId tabanlı body → backend opening context'i
   * okur (customFields.smartTicket). Dönen suggestions 4 closure alanına
   * pre-fill edilir (yalnız boş alanlar; mevcut Stage 3 pattern'i).
   *
   * Klasik vaka: legacy body shape → { companyId, description,
   * resolution: resolutionNote }. Dönen suggestions UI'da info-only
   * kart olarak gösterilir; persist YOK. Kullanıcı "Çözüm Notuna Ekle"
   * buton'u ile resolutionNote'a metin olarak ekleyebilir.
   *
   * Approval / checklist / ResolutionApprovalPolicy guard'ları bypass
   * edilmez — bu yalnız öneri katmanı, kapanış akışına dokunmaz.
   */
  // Codex P2 (PR #469 review) — Stale promise guard. Panel L1Workbench
  // gibi yerlerde reuse oluyor; kullanıcı KB önerisi istediği sırada
  // başka vakaya geçerse eski response yeni case'e pre-fill / display
  // yapıyordu. reqId + caseId snapshot guard ile geç gelen response'u
  // atlatıyoruz.
  const kbSuggestReqIdRef = useRef(0);

  async function handleKbSuggest(clarifyingAnswers?: string) {
    if (kbSuggesting) return;
    if (resolutionNote.trim().length < 5) {
      setKbSuggestionError('En az 5 karakter çözüm notu yazın.');
      return;
    }
    const reqId = ++kbSuggestReqIdRef.current;
    const targetCaseId = item.id;
    setKbSuggesting(true);
    setKbSuggestionError(null);
    setKbSuggestion(null);
    try {
      // Smart Ticket: caseId ile server-side opening context fetch + operatörün
      // YAZDIĞI çözüm notunu resolutionOverride olarak gönder. Eski hâlde yalnız
      // { caseId } gidiyordu → backend resolution'ı solution-step'lerden compose
      // ediyordu; operatörün gerçek çözüm metni AI'ya ulaşmıyor, yanlış bağlamla
      // sınıflandırılıyordu (production accuracy bug'ı). resolutionNote zaten
      // ≥5 char guard'ından geçti → boş override gönderilmez.
      const res = isSmartTicket
        ? await lookupService.suggestSmartTicketClosure({
            caseId: targetCaseId,
            resolutionOverride: resolutionNote.trim(),
            ...(clarifyingAnswers ? { clarifyingAnswers } : {}),
          })
        : await lookupService.suggestSmartTicketClosure({
            companyId: item.companyId,
            description: item.description,
            resolution: resolutionNote.trim(),
            ...(clarifyingAnswers ? { clarifyingAnswers } : {}),
          });
      // Stale response guard — case değişti veya yeni request başlatıldı.
      if (reqId !== kbSuggestReqIdRef.current || item.id !== targetCaseId) {
        return;
      }
      if (!res) {
        setKbSuggestionError('Öneri alınamadı.');
        return;
      }
      setKbSuggestion(res);
      kbSuggestedAtRef.current = new Date().toISOString();
      // Dropdown'lara pre-fill (yalnız boş alanlar) — kapanış-tüm-vakalar
      // genişletmesiyle klasik vakalarda da (dropdown'lar artık herkese açık).
      // P1.2 — AI emin değilse (needsClarification) pre-fill ETME; operatör
      // soruları cevaplayınca gelen zenginleşmiş öneri pre-fill eder.
      if (!res.needsClarification) {
        const s = res.suggestions;
        if (s.rootCauseGroup && !closureRcg) {
          setClosureRcg(s.rootCauseGroup.code);
        }
        if (s.rootCauseDetail && !closureRcd) setClosureRcd(s.rootCauseDetail.code);
        if (s.resolutionType && !closureRt) setClosureRt(s.resolutionType.code);
        if (s.permanentPrevention && !closurePp) setClosurePp(s.permanentPrevention.code);
      }
    } catch (e) {
      if (reqId === kbSuggestReqIdRef.current && item.id === targetCaseId) {
        setKbSuggestionError((e as Error)?.message ?? 'Öneri alınamadı.');
      }
    } finally {
      if (reqId === kbSuggestReqIdRef.current) {
        setKbSuggesting(false);
      }
    }
  }

  async function handleDraftResolution() {
    setDrafting(true);
    const r = await aiService.draftResolution({
      caseSubject: item.title,
      description: item.description,
      caseType: item.caseType,
      category: item.category,
      history: item.history,
      notes: item.notes,
    });
    setDrafting(false);
    if (r.ok) {
      setResolutionNote(r.data.draft);
      toast({ type: 'success', message: 'Çözüm taslağı oluşturuldu.', duration: 1800 });
    } else {
      toast({ type: 'warn', message: aiErrorMessage(r.error), duration: 2500 });
    }
  }

  const requiresSupervisor =
    pending === 'Çözüldü' &&
    (item.priority === 'Critical' ||
      item.slaViolation ||
      item.escalationLevel === 'Direktör' ||
      item.escalationLevel === 'ÜstYönetim');

  function isCardDisabled(target: CaseStatus): boolean {
    if (target === item.status) return true;
    return !allowedTransitions.includes(target);
  }

  function selectCard(target: CaseStatus) {
    if (isCardDisabled(target)) return;
    if (pending === target) {
      setPending(null);
      return;
    }
    setPending(target);
    setError(null);
    setResolutionNote('');
    setCancelReason('');
    setThirdPartyId('');
    setEscalationLevel('');
    setEscalationReason('');
  }

  // FAZ 4 — Çözüldü transition için zorunlu kontrol listesi maddelerinin
  // tamamlanmış olması gerekir. Eksik varsa transition bloklanır.
  const requiredChecklistPending =
    item.checklistItems?.filter((it) => it.required && !it.checked) ?? [];

  // Kapanış ETİKET zorunluluğu — backend'deki smart_ticket_closure_required
  // guard'ının aynası. Vaka (açılış kanalı fark etmeksizin) Çözüldü'ye geçerken
  // 4 sınıftan (kök neden grubu / detay / çözüm tipi / kalıcı önleme) EN AZ BİRİ
  // SEÇİLMİŞ olmalı. "KB ile Analiz Et"e basmak TEK BAŞINA YETMEZ (butona basılıp
  // etiket boş kalırsa kapatılamaz); ama KB analizi etiketleri otomatik doldurup
  // bu şartı sağlayabilir. 4 alanın hepsi dolu olmak zorunda değil. Daha önce
  // ETİKETLENMİŞ vaka muaf (bare KB analizi muafiyet saymaz).
  const prevClosureCf = (
    item.customFields as {
      smartTicket?: {
        closure?: {
          rootCauseGroup?: string; rootCauseGroupLabel?: string;
          rootCauseDetail?: string; resolutionType?: string; permanentPrevention?: string;
          closureSuggestion?: unknown;
        };
      };
    } | undefined
  )?.smartTicket?.closure;
  // Muafiyet, zorunlulukla HİZALI: 4 sınıftan herhangi biri daha önce set edilmişse muaf.
  const closureAlreadyAnalyzed = !!(
    prevClosureCf?.rootCauseGroup || prevClosureCf?.rootCauseGroupLabel ||
    prevClosureCf?.rootCauseDetail || prevClosureCf?.resolutionType || prevClosureCf?.permanentPrevention
  );
  // KB analizine basmak (kbSuggestion) YETMEZ — en az bir kapanış etiketi SEÇİLMİŞ olmalı.
  const closureLabelsPending =
    kbEnabled !== false &&
    !closureAlreadyAnalyzed &&
    !(closureRcg || closureRcd || closureRt || closurePp);

  function applyDisabled(): boolean {
    if (!pending) return true;
    if (customerGateActive) return true; // müşterisiz Çözüldü engeli (SystemAdmin muaf)
    if (productGroupGateActive) return true; // ürün grubu boşken Çözüldü engeli (SystemAdmin muaf)
    if (pending === 'Çözüldü' && !resolutionNote.trim()) return true;
    if (pending === 'Çözüldü' && requiredChecklistPending.length > 0) return true;
    if (pending === 'Çözüldü' && closureLabelsPending) return true;
    if (pending === 'İptalEdildi' && !cancelReason.trim()) return true;
    if (pending === '3rdPartyBekleniyor' && !thirdPartyId) return true;
    if (pending === 'Eskalasyon' && (!escalationLevel || !escalationReason.trim())) return true;
    return false;
  }

  async function handleApply() {
    if (!pending || submitting) return;
    setSubmitting(true);
    setError(null);
    const tp = thirdParties.find((t) => t.id === thirdPartyId);

    // Yapılandırılmış kapanış payload'u — yalnız Smart Ticket Case'i +
    // Çözüldü kararı + en az bir alan dolu durumunda. Backend
    // customFields.smartTicket.closure altına deep-merge eder; opening
    // alanları + diğer dinamik customFields aynen korunur.
    const closureLabels = (() => {
      const rcg = closureRcgList.find((g) => g.code === closureRcg);
      const rcd = closureRcdList.find((d) => d.code === closureRcd);
      const rt = closureRtList.find((r) => r.code === closureRt);
      const pp = closurePpList.find((p) => p.code === closurePp);
      return {
        rootCauseGroup: closureRcg || undefined,
        rootCauseGroupLabel: rcg?.label,
        rootCauseDetail: closureRcd || undefined,
        rootCauseDetailLabel: rcd?.label,
        resolutionType: closureRt || undefined,
        resolutionTypeLabel: rt?.label,
        permanentPrevention: closurePp || undefined,
        permanentPreventionLabel: pp?.label,
      };
    })();
    // Payload, en az bir alan seçiliyse VEYA KB analizi yapıldıysa gönderilir
    // (kapanış-tüm-vakalar: klasik vakalarda da). KB analizi tüm alanları boş
    // bıraksa bile closureSuggestion telemetrisi persist edilir — backend
    // guard'ı "analiz yapıldı" kanıtı olarak bunu arar; boş alanlar bilinçli
    // boş kalır (model gelişim verisi).
    const closureHasAnyField =
      pending === 'Çözüldü' &&
      (closureRcg || closureRcd || closureRt || closurePp || kbSuggestion);

    // Telemetry — Smart Ticket kapanışında AI önerisi alındıysa ai_suggested /
    // human_applied attribution'ı persist et (prompt'a beslenmez; yalnız
    // hata-tipi ayrımı için). Öneri yoksa eski davranış: sadece label'lar.
    let smartTicketClosurePayload: Record<string, unknown> | undefined;
    if (closureHasAnyField) {
      smartTicketClosurePayload = { ...closureLabels };
      if (kbSuggestion) {
        const applied: AppliedClosureSelection = {
          rootCauseGroup: { code: closureRcg || undefined, label: closureLabels.rootCauseGroupLabel },
          rootCauseDetail: { code: closureRcd || undefined, label: closureLabels.rootCauseDetailLabel },
          resolutionType: { code: closureRt || undefined, label: closureLabels.resolutionTypeLabel },
          permanentPrevention: { code: closurePp || undefined, label: closureLabels.permanentPreventionLabel },
        };
        smartTicketClosurePayload.closureSuggestion = buildClosureSuggestionTelemetry({
          suggestion: kbSuggestion,
          suggestedAt: kbSuggestedAtRef.current,
          applied,
        });
      }
    }

    const updated = await caseService.transitionStatus(item.id, pending, {
      resolutionNote: pending === 'Çözüldü' ? resolutionNote.trim() : undefined,
      cancellationReason: pending === 'İptalEdildi' ? cancelReason.trim() : undefined,
      thirdPartyId: pending === '3rdPartyBekleniyor' ? tp?.id : undefined,
      thirdPartyName: pending === '3rdPartyBekleniyor' ? tp?.name : undefined,
      escalationLevel: pending === 'Eskalasyon' && escalationLevel ? (escalationLevel as EscalationLevel) : undefined,
      escalationReason: pending === 'Eskalasyon' ? escalationReason.trim() : undefined,
      smartTicketClosure: smartTicketClosurePayload,
    });
    setSubmitting(false);
    if (updated) {
      toast({
        type: pending === 'Çözüldü' ? 'success' : pending === 'İptalEdildi' ? 'warn' : 'info',
        title: 'Statü güncellendi',
        message: `${updated.caseNumber} → ${STATUS_LABELS[pending]}`,
      });

      // Mention mirror — reason/note metni @[Name](userId) içeriyorsa BE'nin
      // CaseMention parse'ı yan-bir Internal not aracılığıyla tetiklenir.
      // (transitionStatus endpoint'i mention parse etmiyor; addNote ediyor.)
      // Actor identity hardening: authorName backend req.user üzerinden yazılır;
      // FE'den göndermiyoruz.
      if (pending === 'Eskalasyon' && MENTION_RE.test(escalationReason)) {
        const levelLabel = escalationLevel ? ` (${escalationLevel})` : '';
        await caseService.addNote(item.id, {
          content: `Eskalasyon başlatıldı${levelLabel}. Gerekçe: ${escalationReason.trim()}`,
          visibility: 'Internal',
        });
      } else if (pending === 'Çözüldü' && MENTION_RE.test(resolutionNote)) {
        await caseService.addNote(item.id, {
          content: `Vaka çözüldü. Çözüm notu: ${resolutionNote.trim()}`,
          visibility: 'Internal',
        });
      } else if (pending === 'İptalEdildi' && MENTION_RE.test(cancelReason)) {
        await caseService.addNote(item.id, {
          content: `Vaka iptal edildi. Gerekçe: ${cancelReason.trim()}`,
          visibility: 'Internal',
        });
      }

      setPending(null);
      onApplied(updated);
    } else {
      setError('Statü değiştirilemedi.');
    }
  }

  return (
    <section className={compactMode ? '' : 'rounded-xl bg-white p-4 ring-1 ring-slate-200'}>
      {/* Header + grid: compactMode'da gizli — hedef zaten Compact Status Stepper'da seçildi. */}
      {!compactMode && (
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Statü Geçişi</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Mevcut statüden geçilebilen kartlar aktif. Diğerleri pasiftir.
            </p>
          </div>
          <Badge tint="slate">
            Şu an: <strong className="ml-1">{STATUS_LABELS[item.status]}</strong>
          </Badge>
        </div>
      )}

      {/* Status kart grid — compactMode'da render edilmez */}
      {!compactMode && (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7">
        {CASE_STATUSES.map((status) => {
          const meta = STATUS_META[status];
          const isCurrent = status === item.status;
          const disabled = isCardDisabled(status);
          const selected = pending === status;
          return (
            <button
              key={status}
              type="button"
              onClick={() => selectCard(status)}
              disabled={disabled}
              className={`group relative flex flex-col items-start gap-1.5 rounded-lg p-3 text-left ring-1 ring-inset transition ${
                disabled
                  ? 'cursor-not-allowed bg-slate-50/40 opacity-50 ring-slate-200'
                  : `${meta.bg} ${meta.ring} hover:scale-[1.02] hover:shadow-sm`
              } ${
                selected
                  ? `ring-2 ring-offset-1 ${meta.selectedRing} shadow-md`
                  : ''
              }`}
              title={
                disabled && !isCurrent
                  ? `${item.status} → ${status} geçişi yok`
                  : isCurrent
                    ? 'Şu an bu statüdesin'
                    : `${status} statüsüne geç`
              }
            >
              <div className="flex w-full items-center justify-between">
                <span className={`flex h-7 w-7 items-center justify-center rounded-md ${meta.bg} ${meta.text}`}>
                  {meta.icon}
                </span>
                {disabled && !isCurrent && <Lock size={11} className="text-slate-400" />}
                {isCurrent && (
                  <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-700">
                    Şu an
                  </span>
                )}
                {selected && !isCurrent && (
                  <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
                    Seçildi
                  </span>
                )}
              </div>
              <div className={`text-sm font-semibold ${meta.text}`}>{STATUS_LABELS[status]}</div>
              <div className="text-[11px] leading-tight text-slate-600">{meta.description}</div>
              {meta.requirement && !disabled && (
                <span className="mt-auto rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                  ⚠ {meta.requirement}
                </span>
              )}
              {disabled && !isCurrent && (
                <span className="mt-auto text-[10px] text-slate-400">Geçilemez</span>
              )}
            </button>
          );
        })}
      </div>
      )}

      {/* Koşullu alanlar */}
      {pending && (
        <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex items-center gap-2">
            <ChevronRight size={14} className="text-slate-400" />
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {STATUS_LABELS[pending]} için zorunlu alanlar
            </span>
          </div>

          {pending === 'Çözüldü' && requiredChecklistPending.length > 0 && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
              <div className="mb-1 font-semibold">
                Vaka çözülmeden önce {requiredChecklistPending.length} zorunlu kontrol maddesi
                tamamlanmalı:
              </div>
              <ul className="ml-4 list-disc space-y-0.5">
                {requiredChecklistPending.map((it) => (
                  <li key={it.id}>{it.label}</li>
                ))}
              </ul>
              <div className="mt-1.5 text-[11px] text-rose-700 dark:text-rose-300">
                Detay sekmesindeki <strong>Kontrol Listesi</strong> bölümünden işaretleyebilirsiniz.
              </div>
            </div>
          )}

          {pending === 'Çözüldü' && (
            <>
              {/* 2026-07-06 — Müşteri kapısı: müşterisiz vaka çözülemez.
                  Öneriler (deterministik) + manuel ara; bağlanınca "Çöz"
                  butonu açılır. SystemAdmin bu bloğu görmez (istisna). */}
              {customerGateActive && (
                <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 dark:border-amber-900/50 dark:bg-amber-950/40">
                  <div className="flex items-start gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
                    <span>⚠️</span>
                    <span>Müşteri seçilmedi — bu vaka müşteri eşleştirilmeden çözülemez. Aşağıdan önerilen müşterilerden seç ya da elle ara.</span>
                  </div>
                  <CustomerMatchSuggestionsPanel
                    caseId={item.id}
                    onConfirmLink={async (s) => {
                      await handleLinkCustomer(s.accountId, s.accountName);
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCustomerPickerOpen(true)}
                    className="w-full justify-center"
                  >
                    Müşteri Ara (elle)
                  </Button>
                </div>
              )}
              {linkedCustomer && (
                <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
                  ✓ Müşteri bağlandı: <strong>{linkedCustomer.name}</strong> — artık çözebilirsin.
                </div>
              )}
              {/* Ürün Grubu kapısı — kayıtlarda bu bilginin kesin olması için
                  Çözüldü'ye geçişte zorunlu. Maille otomatik açılan vakalar da
                  buradan geçer (oluşturma anında etkilenmezler, sadece
                  kapanışta). SystemAdmin bu bloğu görmez (istisna). */}
              {productGroupGateActive && (
                <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 dark:border-amber-900/50 dark:bg-amber-950/40">
                  <div className="flex items-start gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
                    <span>⚠️</span>
                    <span>Ürün grubu seçilmedi — bu vaka ürün grubu belirtilmeden çözülemez.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={productGroupDraft}
                      onChange={(e) => setProductGroupDraft(e.target.value)}
                      className="flex-1"
                    >
                      <option value="">— Seçin —</option>
                      {lookupService.productGroups().map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleSaveProductGroup()}
                      disabled={!productGroupDraft || productGroupSaving}
                      leftIcon={productGroupSaving ? <Loader2 size={12} className="animate-spin" /> : undefined}
                    >
                      Kaydet
                    </Button>
                  </div>
                </div>
              )}
              {productGroupSet && (
                <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
                  ✓ Ürün grubu kaydedildi: <strong>{productGroupSet}</strong> — artık çözebilirsin.
                </div>
              )}
              <RunaAiCard
                title="Çözüm Notu Taslağı"
                body={
                  resolutionNote
                    ? 'Taslak alana yazıldı; düzenleyebilirsiniz veya yeni bir taslak üretebilirsiniz.'
                    : 'Vaka geçmişine ve notlara bakarak ekip içi bir çözüm özeti (iç kayıt) önerilir.'
                }
                isLoading={drafting}
                primaryAction={{
                  label: resolutionNote ? '✦ Yeniden Üret' : '✦ Taslak Üret',
                  onClick: () => void handleDraftResolution(),
                  disabled: drafting,
                }}
              />
              <Field
                label="Çözüm Notu"
                required
                hint="İç kayıt amaçlıdır, müşteriye gönderilmez. @ ile yardım eden kişi veya QA'yı etiketleyebilirsin."
                actions={
                  <VoiceNoteButton
                    onTranscript={(chunk) =>
                      setResolutionNote((t) => (t ? `${t} ${chunk}` : chunk))
                    }
                  />
                }
              >
                <MentionTextarea
                  caseId={item.id}
                  value={resolutionNote}
                  onChange={setResolutionNote}
                  placeholder="Sorunun nasıl çözüldüğünü açıklayın… (@yardım eden)"
                  rows={3}
                />
              </Field>

              {/* PR-8 — Business review Madde 7. KB ile kapanış önerisi.
                  Klasik vakada info-only kart; Smart Ticket vakada
                  dropdown pre-fill (kullanıcı onayıyla). Approval /
                  checklist guard'ları bypass edilmez. */}
              {kbEnabled !== false && (
                <KbClosureSuggestionPanel
                  resolutionNote={resolutionNote}
                  kbSuggesting={kbSuggesting}
                  kbSuggestion={kbSuggestion}
                  kbSuggestionError={kbSuggestionError}
                  onSuggest={() => void handleKbSuggest()}
                  onClarifyAnswer={(answer) => void handleKbSuggest(answer)}
                />
              )}

              {/* WR-Smart-Ticket Phase 1e + kapanış-tüm-vakalar genişletmesi —
                  yapılandırılmış kapanış alanları TÜM vakalarda gösterilir
                  (mail/telefon dahil; klasik vakada smartTicket dalı
                  closure-only oluşur). Kapanış analizi zorunluluğu: "KB ile
                  Analiz Et" bir kez çalıştırılmadan (veya elle etiket
                  seçilmeden) Çözüldü uygulanamaz — backend
                  smart_ticket_closure_required guard'ı ile aynı kural. AI'ın
                  boş bıraktığı alanlar boş kalabilir (bilinçli; gelişim
                  verisi). Submit'te smartTicketClosure payload backend
                  deep-merge ile customFields.smartTicket.closure'a yazar. */}
              {kbEnabled !== false && (
              <div className="rounded-md border border-brand-100 bg-brand-50/40 p-3 dark:border-brand-900/30 dark:bg-brand-950/20">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-brand-700 dark:text-brand-200">
                    Kapanış Bilgileri (Kök Neden){closureAlreadyAnalyzed ? '' : ' — etiket seçimi zorunlu'}
                  </span>
                    {closureTaxLoading && (
                      <span className="text-[11px] text-slate-500">yükleniyor…</span>
                    )}
                  </div>
                  {closureLabelsPending && (
                    <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                      Vakayı çözmeden önce <strong>en az bir kapanış etiketi</strong> seçin (kök
                      neden grubu / detay / çözüm tipi / kalıcı önleme). İpucu: çözüm notunu yazıp{' '}
                      <strong>KB ile Analiz Et</strong> ile etiketleri otomatik doldurabilirsiniz.
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Field label="Kök Neden Grubu">
                      <Select
                        value={closureRcg}
                        onChange={(e) => setClosureRcg(e.target.value)}
                        disabled={closureTaxLoading || closureRcgList.length === 0}
                      >
                        <option value="">— Seçim yok —</option>
                        {closureRcgList.map((g) => (
                          <option key={g.code} value={g.code}>
                            {g.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Kök Neden Detayı">
                      <Select
                        value={closureRcd}
                        onChange={(e) => setClosureRcd(e.target.value)}
                        disabled={closureTaxLoading || closureRcdList.length === 0}
                      >
                        <option value="">— Seçim yok —</option>
                        {closureRcdList.map((d) => (
                          <option key={d.code} value={d.code}>
                            {d.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Çözüm Tipi">
                      <Select
                        value={closureRt}
                        onChange={(e) => setClosureRt(e.target.value)}
                        disabled={closureTaxLoading || closureRtList.length === 0}
                      >
                        <option value="">— Seçim yok —</option>
                        {closureRtList.map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Kalıcı Önlem">
                      <Select
                        value={closurePp}
                        onChange={(e) => setClosurePp(e.target.value)}
                        disabled={closureTaxLoading || closurePpList.length === 0}
                      >
                        <option value="">— Seçim yok —</option>
                        {closurePpList.map((p) => (
                          <option key={p.code} value={p.code}>
                            {p.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500 dark:text-ndark-muted">
                    {closureAlreadyAnalyzed
                      ? 'Bu vaka daha önce analiz edilmiş; alanlar boş bırakılırsa mevcut etiketler korunur.'
                      : 'Vaka kapatmadan önce en az bir kapanış etiketi seçilmelidir; KB analizi etiketleri otomatik doldurabilir.'}{' '}
                    Kapanışla aynı transaction içinde
                    <code className="ml-1 font-mono">customFields.smartTicket.closure</code> alanına
                    yazılır; mevcut Smart Ticket açılış bilgileri korunur.
                  </p>
                </div>
              )}
            </>
          )}

          {pending === 'İptalEdildi' && (
            <Field
              label="İptal Gerekçesi"
              required
              hint="@ ile onaylayan yöneticiyi veya CSM'yi etiketleyebilirsin."
              actions={
                <VoiceNoteButton
                  onTranscript={(chunk) =>
                    setCancelReason((t) => (t ? `${t} ${chunk}` : chunk))
                  }
                />
              }
            >
              <MentionTextarea
                caseId={item.id}
                value={cancelReason}
                onChange={setCancelReason}
                placeholder="İptal sebebini yazın… (@yönetici / @CSM)"
                rows={2}
              />
            </Field>
          )}

          {pending === '3rdPartyBekleniyor' && (
            <Field
              label="Beklenen 3. Parti"
              required
              hint={
                thirdPartyId
                  ? (thirdParties.find((tp) => tp.id === thirdPartyId)?.pausesSla !== false
                    ? 'Bu 3. parti beklenirken SLA durur.'
                    : 'Bu 3. parti beklenirken SLA işlemeye devam eder.')
                  : 'Seçim yapıldığında SLA davranışı gösterilir.'
              }
            >
              <Select value={thirdPartyId} onChange={(e) => setThirdPartyId(e.target.value)}>
                <option value="">Seçin…</option>
                {thirdParties.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {pending === 'Eskalasyon' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Eskalasyon Seviyesi" required>
                <Select
                  value={escalationLevel}
                  onChange={(e) => setEscalationLevel(e.target.value as EscalationLevel | '')}
                >
                  <option value="">Seçin…</option>
                  {ESCALATION_LEVELS.filter((l) => l !== 'Yok').map((l) => (
                    <option key={l} value={l}>
                      {ESCALATION_LEVEL_LABELS[l]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Gerekçe"
                required
                hint="@ ile yöneticiyi etiketle — anında bildirim alır."
                className="sm:row-span-1"
                actions={
                  <VoiceNoteButton
                    onTranscript={(chunk) =>
                      setEscalationReason((t) => (t ? `${t} ${chunk}` : chunk))
                    }
                  />
                }
              >
                <MentionTextarea
                  caseId={item.id}
                  value={escalationReason}
                  onChange={setEscalationReason}
                  placeholder="Eskalasyon sebebini açıklayın… (@yönetici)"
                  rows={2}
                />
              </Field>
            </div>
          )}

          {requiresSupervisor && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                Çözüldü geçişi <strong>Supervisor onayı</strong> gerektiriyor (Kritik / SLA ihlali /
                yüksek eskalasyon). FAZ 0'da onay simülasyonludur — geçiş yine de uygulanır.
              </span>
            </div>
          )}

          {/* WR-D4 Phase 1 — Çözüm Onayı politikası eşleşiyorsa kullanıcıyı kart'a yönlendir.
              Tam blok yukarıdaki ResolutionApprovalCard tarafından yapılır; burada sadece
              operatör "Uygula"ya basmaya çalışırken hatırlatma çıkıyor. */}
          {pending === 'Çözüldü' && item.approvalState && item.approvalState !== 'Approved' && (
            <div className="flex items-start gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-200">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                Bu vaka için <strong>çözüm onayı zorunlu</strong>. Üstteki "Çözüm Onayı"
                kartından önce onayı tamamla; sonra Çözüldü'ye geç.
              </span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPending(null);
                // Codex P2 — compactMode modal'ında parent reasonTarget'ı
                // temizle ki Vazgeç sonrası boş modal kalmasın. Standalone
                // (non-compact) caller'da onCancel verilmediği için no-op.
                onCancel?.();
              }}
              disabled={submitting}
            >
              Vazgeç
            </Button>
            <Button
              size="sm"
              disabled={applyDisabled() || submitting}
              onClick={handleApply}
              rightIcon={<ChevronRight size={14} />}
            >
              {submitting ? 'Uygulanıyor…' : 'Uygula'}
            </Button>
          </div>
        </div>
      )}

      {/* Kapanış müşteri kapısı — manuel arama modalı (öneri yetmezse). */}
      <AccountSearchPicker
        open={customerPickerOpen}
        companyId={item.companyId}
        onClose={() => setCustomerPickerOpen(false)}
        onSelect={(account) => {
          setCustomerPickerOpen(false);
          if (account) void handleLinkCustomer(account.id, account.name);
        }}
      />
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// KbClosureSuggestionPanel — PR-8 (Business review Madde 7)
//
// Çözüm Notu'nun altında yer alır; "Cozuldu" pending iken render edilir.
// Davranış (kapanış-tüm-vakalar genişletmesi sonrası TÜM vakalarda aynı):
//   - Buton: "KB ile Kapanış Önerisi Sor". resolutionNote >= 5 char
//     iken aktif; aksi halde disabled + hint.
//   - Suggestion alındıktan sonra parent component dropdown'lara pre-fill
//     yapar (yalnız boş alanlar). Panel başarı bildirimi gösterir.
// ─────────────────────────────────────────────────────────────────

function KbClosureSuggestionPanel({
  resolutionNote,
  kbSuggesting,
  kbSuggestion,
  kbSuggestionError,
  onSuggest,
  onClarifyAnswer,
}: {
  resolutionNote: string;
  kbSuggesting: boolean;
  kbSuggestion: SuggestClosureResponse | null;
  kbSuggestionError: string | null;
  onSuggest: () => void;
  /** P1.2 — operatör clarifying sorularını cevaplayınca (zenginleşmiş re-run tetikler). */
  onClarifyAnswer: (answer: string) => void;
}) {
  // P1.2 — clarifying cevap metni (AI emin değilse sorulan 3 soruya).
  const [clarifyAnswer, setClarifyAnswer] = useState('');
  const noteOk = resolutionNote.trim().length >= 5;
  const suggestionCount = kbSuggestion ? Object.keys(kbSuggestion.suggestions).length : 0;

  return (
    <div className="rounded-md border border-violet-200 bg-violet-50/40 px-3 py-2 dark:border-violet-900/40 dark:bg-violet-950/20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-violet-800 dark:text-violet-200">
          <Sparkles size={11} />
          KB önerisi: kapanış alanlarına pre-fill
        </div>
        <Button
          size="sm"
          variant="outline"
          leftIcon={
            kbSuggesting ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Wand2 size={11} />
            )
          }
          disabled={kbSuggesting || !noteOk}
          onClick={onSuggest}
          title={!noteOk ? 'En az 5 karakter çözüm notu yazın' : 'KB önerisini iste'}
        >
          {kbSuggesting ? 'Soruluyor…' : kbSuggestion ? 'Yeniden Sor' : 'Bilgi Bankası Önerisi Sor'}
        </Button>
      </div>
      {!noteOk && !kbSuggestion && !kbSuggesting && (
        <p className="mt-1 text-[11px] text-slate-500 dark:text-ndark-muted">
          Çözüm notunu yazdıkça KB önerisi daha isabetli olur.
        </p>
      )}
      {kbSuggestionError && (
        <p className="mt-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          {kbSuggestionError}
        </p>
      )}
      {kbSuggestion?.needsClarification && kbSuggestion.clarifyingQuestions && (
        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 dark:border-amber-900/40 dark:bg-amber-950/30">
          <p className="text-[11px] font-semibold text-amber-900 dark:text-amber-200">
            AI bu vakada emin değil — doğru etiketi seçebilmek için kısaca yanıtlayın:
          </p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] leading-snug text-amber-800 dark:text-amber-300">
            {kbSuggestion.clarifyingQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
          <textarea
            className="mt-1.5 w-full rounded border border-amber-300 bg-white px-2 py-1 text-[12px] text-slate-800 outline-none focus:border-amber-400 dark:border-amber-900/40 dark:bg-slate-900 dark:text-slate-100"
            rows={3}
            value={clarifyAnswer}
            onChange={(e) => setClarifyAnswer(e.target.value)}
            placeholder="Kök neden, çözüm ve önlem hakkında birkaç cümle…"
          />
          <div className="mt-1.5 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={kbSuggesting || clarifyAnswer.trim().length < 3}
              leftIcon={kbSuggesting ? <Loader2 size={11} className="animate-spin" /> : undefined}
              onClick={() => onClarifyAnswer(clarifyAnswer.trim())}
            >
              {kbSuggesting ? 'Gönderiliyor…' : 'Yanıtla ve etiketleri öner'}
            </Button>
          </div>
        </div>
      )}
      {kbSuggestion && !kbSuggestion.needsClarification && (
        <div className="mt-2 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-violet-700 dark:text-violet-300">
            <span>
              {suggestionCount > 0
                ? `${suggestionCount} alan önerisi geldi`
                : 'KB cevabı boş — eşleşme yok'}
            </span>
            {kbSuggestion.unmatched.length > 0 && (
              <span className="text-amber-700 dark:text-amber-300">
                · {kbSuggestion.unmatched.length} eşleşmedi
              </span>
            )}
            {kbSuggestion.meta?.confidence != null && (
              <span>· güven %{Math.round(kbSuggestion.meta.confidence * 100)}</span>
            )}
          </div>
          {suggestionCount > 0 && (
            <ul className="space-y-0.5 text-[11px]">
              {kbSuggestion.suggestions.rootCauseGroup && (
                <li>
                  <span className="text-slate-500 dark:text-ndark-muted">Kök Neden:</span>{' '}
                  <span className="font-medium text-slate-800 dark:text-ndark-text">
                    {kbSuggestion.suggestions.rootCauseGroup.label}
                  </span>
                </li>
              )}
              {kbSuggestion.suggestions.rootCauseDetail && (
                <li>
                  <span className="text-slate-500 dark:text-ndark-muted">Detay:</span>{' '}
                  <span className="font-medium text-slate-800 dark:text-ndark-text">
                    {kbSuggestion.suggestions.rootCauseDetail.label}
                  </span>
                </li>
              )}
              {kbSuggestion.suggestions.resolutionType && (
                <li>
                  <span className="text-slate-500 dark:text-ndark-muted">Çözüm Tipi:</span>{' '}
                  <span className="font-medium text-slate-800 dark:text-ndark-text">
                    {kbSuggestion.suggestions.resolutionType.label}
                  </span>
                </li>
              )}
              {kbSuggestion.suggestions.permanentPrevention && (
                <li>
                  <span className="text-slate-500 dark:text-ndark-muted">Kalıcı Önlem:</span>{' '}
                  <span className="font-medium text-slate-800 dark:text-ndark-text">
                    {kbSuggestion.suggestions.permanentPrevention.label}
                  </span>
                </li>
              )}
            </ul>
          )}
          {suggestionCount > 0 && (
            <p className="text-[10px] text-violet-600 dark:text-violet-400">
              Aşağıdaki Kapanış Bilgileri alanları boşsa öneri otomatik dolduruldu — gözden geçirip değiştirebilirsiniz.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
