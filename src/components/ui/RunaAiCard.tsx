import type { CSSProperties } from 'react';

/**
 * RUNA AI design tokens — CSS variables ile, projede design system değişkeni
 * tanımlı değilse fallback'le güvenli. Vurgu mor (#4B0FAE) sol kenar olarak.
 */
const RUNA = {
  bg: 'var(--color-background-primary, #ffffff)',
  borderLeft: '3px solid #4B0FAE',
  borderOther: '0.5px solid var(--color-border-tertiary, #e2e8f0)',
  borderRadius: '0 8px 8px 0',
  brandText: '#4B0FAE',
  titleText: 'var(--color-text-primary, #1e293b)',
  bodyText: 'var(--color-text-secondary, #64748b)',
  badgeBg: '#F0EAFF',
  badgeText: '#4B0FAE',
  skeletonBg: 'var(--color-background-secondary, #f1f5f9)',
  btnPrimary: { background: '#4B0FAE', color: '#FFFFFF' },
  btnSecondary: {
    background: 'transparent',
    border: '1px solid var(--color-border-secondary, #cbd5e1)',
    color: 'var(--color-text-secondary, #64748b)',
  },
  btnDanger: { background: '#E24B4A', color: '#FFFFFF' },
};

const RunaAiIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="7" fill="#4B0FAE" />
    <text
      x="8"
      y="12"
      fontFamily="Arial"
      fontSize="9"
      fontWeight="700"
      fill="#00C8A0"
      textAnchor="middle"
    >
      R
    </text>
    <circle cx="12" cy="4" r="2" fill="#00C8A0" />
    <circle cx="12" cy="4" r="1" fill="#4B0FAE" />
  </svg>
);

interface RunaAiAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * RUNA AI Faz 3 — risk seviyesi rozet renkleri.
 * Düşük=slate, Orta=amber, Yüksek=orange, Kritik=red. Diğer ve null:
 * hiç render edilmez.
 */
type RiskLevel = 'Düşük' | 'Orta' | 'Yüksek' | 'Kritik';

const RISK_STYLE: Record<RiskLevel, { bg: string; text: string }> = {
  'Düşük':  { bg: '#F1F5F9', text: '#475569' },
  'Orta':   { bg: '#FEF3C7', text: '#92400E' },
  'Yüksek': { bg: '#FFEDD5', text: '#C2410C' },
  'Kritik': { bg: '#FEE2E2', text: '#B91C1C' },
};

interface RunaAiCardProps {
  title: string;
  body: string;
  badges?: string[];
  isLoading?: boolean;
  primaryAction?: RunaAiAction;
  secondaryAction?: RunaAiAction;
  dangerAction?: RunaAiAction;
  className?: string;
  /**
   * RUNA AI Faz 3 — supervisor-summary çıktısının persist edilen alanı.
   * Verilirse renkli rozet olarak gösterilir; null/boşsa hiç render edilmez.
   */
  riskLevel?: RiskLevel | null;
  /**
   * RUNA AI Faz 3 — supervisor-summary keyPoints listesi. Body'den ayrı,
   * ul/li olarak gösterilir. Boş array veya null → hiç render edilmez.
   */
  keyPoints?: string[] | null;
}

const cardStyle: CSSProperties = {
  background: RUNA.bg,
  borderLeft: RUNA.borderLeft,
  borderTop: RUNA.borderOther,
  borderRight: RUNA.borderOther,
  borderBottom: RUNA.borderOther,
  borderRadius: RUNA.borderRadius,
  padding: '12px 14px',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  marginBottom: 8,
};

const brandLabelStyle: CSSProperties = {
  color: RUNA.brandText,
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.05em',
};

const loadingTextStyle: CSSProperties = {
  color: RUNA.brandText,
  fontSize: 12,
  marginBottom: 8,
};

const titleStyle: CSSProperties = {
  color: RUNA.titleText,
  fontSize: 13,
  fontWeight: 500,
  marginBottom: 5,
};

const badgeStyle: CSSProperties = {
  background: RUNA.badgeBg,
  color: RUNA.badgeText,
  fontSize: 10,
  padding: '2px 8px',
  borderRadius: 4,
  fontWeight: 500,
};

const baseButtonStyle: CSSProperties = {
  fontSize: 11,
  padding: '5px 14px',
  borderRadius: 5,
  fontWeight: 500,
  cursor: 'pointer',
  border: 'none',
};

function SkeletonRow({ height }: { height: number }) {
  return (
    <div
      className="animate-pulse"
      style={{
        background: RUNA.skeletonBg,
        borderRadius: 4,
        height,
        marginBottom: 6,
      }}
    />
  );
}

export function RunaAiCard({
  title,
  body,
  badges,
  isLoading,
  primaryAction,
  secondaryAction,
  dangerAction,
  className,
  riskLevel,
  keyPoints,
}: RunaAiCardProps) {
  const hasActions = !!(primaryAction || secondaryAction || dangerAction);
  const safeRisk: RiskLevel | null =
    riskLevel && (riskLevel in RISK_STYLE) ? (riskLevel as RiskLevel) : null;
  const safeKeyPoints = Array.isArray(keyPoints)
    ? keyPoints.filter((k) => typeof k === 'string' && k.trim().length > 0)
    : [];

  return (
    <div style={cardStyle} className={className}>
      <div style={headerStyle}>
        <RunaAiIcon size={16} />
        <span style={brandLabelStyle}>RUNA AI</span>
      </div>

      {isLoading ? (
        <>
          <div style={loadingTextStyle}>✦ RUNA AI analiz ediyor...</div>
          <SkeletonRow height={12} />
          <SkeletonRow height={12} />
          <SkeletonRow height={8} />
        </>
      ) : (
        <>
          <div style={titleStyle}>{title}</div>
          <div
            style={{
              color: RUNA.bodyText,
              fontSize: 12,
              lineHeight: 1.6,
              marginBottom:
                safeRisk || safeKeyPoints.length > 0 || (badges && badges.length > 0) ? 8 : 0,
              whiteSpace: 'pre-wrap',
            }}
          >
            {body}
          </div>

          {/* RUNA AI Faz 3 — risk rozeti + anahtar noktalar */}
          {safeRisk && (
            <div style={{ marginBottom: safeKeyPoints.length > 0 || (badges && badges.length > 0) ? 8 : 0 }}>
              <span
                style={{
                  background: RISK_STYLE[safeRisk].bg,
                  color: RISK_STYLE[safeRisk].text,
                  fontSize: 10,
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                }}
              >
                Risk · {safeRisk}
              </span>
            </div>
          )}

          {safeKeyPoints.length > 0 && (
            <ul
              style={{
                margin: 0,
                marginBottom: badges && badges.length > 0 ? 10 : 0,
                paddingLeft: 16,
                color: RUNA.bodyText,
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              {safeKeyPoints.map((p, i) => (
                <li key={i} style={{ marginBottom: 2 }}>
                  {p}
                </li>
              ))}
            </ul>
          )}

          {badges && badges.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: 6,
                flexWrap: 'wrap',
                marginBottom: hasActions ? 0 : 0,
              }}
            >
              {badges.map((b, i) => (
                <span key={i} style={badgeStyle}>
                  {b}
                </span>
              ))}
            </div>
          )}

          {hasActions && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              {primaryAction && (
                <button
                  type="button"
                  style={{ ...baseButtonStyle, ...RUNA.btnPrimary, opacity: primaryAction.disabled ? 0.6 : 1 }}
                  onClick={primaryAction.onClick}
                  disabled={primaryAction.disabled}
                >
                  {primaryAction.label}
                </button>
              )}
              {dangerAction && (
                <button
                  type="button"
                  style={{ ...baseButtonStyle, ...RUNA.btnDanger, opacity: dangerAction.disabled ? 0.6 : 1 }}
                  onClick={dangerAction.onClick}
                  disabled={dangerAction.disabled}
                >
                  {dangerAction.label}
                </button>
              )}
              {secondaryAction && (
                <button
                  type="button"
                  style={{ ...baseButtonStyle, ...RUNA.btnSecondary, opacity: secondaryAction.disabled ? 0.6 : 1 }}
                  onClick={secondaryAction.onClick}
                  disabled={secondaryAction.disabled}
                >
                  {secondaryAction.label}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
