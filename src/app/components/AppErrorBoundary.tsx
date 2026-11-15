import React from 'react';
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react';

interface State {
  hasError: boolean;
  error?: Error;
  resetKey: number;
}

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (import.meta.env.DEV) console.error('MANAGER STOCK render error:', error, info.componentStack);
  }

  retry = () => this.setState(state => ({ hasError: false, error: undefined, resetKey: state.resetKey + 1 }));

  goBack = () => {
    const path = localStorage.getItem('manager_stock_auth_token') ? '/dashboard' : '/login';
    window.location.assign(path);
  };

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-[var(--background)] p-6 text-[var(--foreground)]">
          <section className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 shadow-xl">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-rose-50 text-rose-700">
              <AlertTriangle size={24} />
            </div>
            <p className="text-xs font-semibold uppercase tracking-[.18em] text-rose-700">Error inesperado</p>
            <h1 className="mt-2 text-2xl font-bold">No se pudo mostrar esta pantalla</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
              La aplicación encontró un problema al cargar el contenido. Puedes volver a intentarlo o regresar al panel.
            </p>
            {import.meta.env.DEV && this.state.error && (
              <pre className="mt-4 max-h-36 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">
                {this.state.error.name}: {this.state.error.message}
              </pre>
            )}
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={this.retry}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-3 text-sm font-semibold text-white"
              >
                <RefreshCw size={16} /> Intentar nuevamente
              </button>
              <button
                onClick={this.goBack}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-semibold"
              >
                <ArrowLeft size={16} /> Volver al panel
              </button>
            </div>
          </section>
        </main>
      );
    }
    return <div key={this.state.resetKey}>{this.props.children}</div>;
  }
}
