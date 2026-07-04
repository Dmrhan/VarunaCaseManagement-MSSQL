/**
 * Mail M6.2c — Lazy chunk error boundary (Codex review fix).
 *
 * Sorun: React.lazy + Suspense pending durumda iken yakalar, ANCAK
 * lazy import REJECTED olursa (network fail / stale index.js → kaldırılmış
 * chunk request'i) error yukarıdaki en yakın boundary'ye fırlatılır.
 * Mevcut CaseDetailPage'in error boundary'ı YOK → İletişim sekmesine
 * tıklamak vaka sayfasını çökertirdi.
 *
 * Bu boundary lazy tab içeriğini izole eder: hata olursa sadece tab
 * alanında localized "Yükleme başarısız + Yeniden dene" gösterir; sayfa
 * sağlam kalır.
 *
 * SCOPE: küçük + reusable. Class component zorunlu (Hooks lifecycle bu
 * iki API'yi sağlamaz: componentDidCatch + getDerivedStateFromError).
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { AlertTriangle, RotateCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Boundary tetiklendiğinde gösterilecek özel label. */
  label?: string;
  /**
   * R14.1 HOTFIX (2026-07-04) — Sınıfsız <div key=...> wrapper flex zincirini
   * kırıyordu (E2E: İletişim'de min-h-0/flex-1 taşımayan wrapper içerik
   * boyutuna büyüyüp ana MAIN overflow-hidden'da kesiliyordu → gövde alt
   * kısmı erişilemez). İletişim tüketicisi 'flex min-h-0 flex-1 flex-col'
   * zincirini geçirir; diğer tüketiciler prop'suz → mevcut davranış birebir.
   */
  className?: string;
}

interface State {
  hasError: boolean;
  resetKey: number;
}

export class LazyTabBoundary extends Component<Props, State> {
  state: State = { hasError: false, resetKey: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[LazyTabBoundary] caught', error, info?.componentStack);
  }

  handleRetry = (): void => {
    this.setState((s) => ({ hasError: false, resetKey: s.resetKey + 1 }));
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-rose-200 bg-rose-50 px-4 py-10 text-center dark:border-rose-900/40 dark:bg-rose-950/30">
          <AlertTriangle size={22} className="text-rose-500" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-rose-700 dark:text-rose-300">
              {this.props.label ?? 'Sekme yüklenemedi.'}
            </p>
            <p className="mt-1 text-xs text-rose-600/80 dark:text-rose-300/70">
              Sunucu güncellendiyse sayfayı yenilemek de gerekebilir.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            leftIcon={<RotateCw size={13} />}
            onClick={this.handleRetry}
          >
            Yeniden dene
          </Button>
        </div>
      );
    }

    // resetKey değişince children re-mount (lazy chunk yeniden tetiklenir).
    // R14.1 — className opsiyonel: verilirse flex zincirini taşır (İletişim
    // viewport-sabit yerleşimi için); verilmezse eski davranış (sınıfsız div).
    return <div key={this.state.resetKey} className={this.props.className}>{this.props.children}</div>;
  }
}
