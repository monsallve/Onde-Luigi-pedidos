import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message || 'Ocurrió un error inesperado.',
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('App ErrorBoundary:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#141418] border border-white/10 rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-red-400 mb-3">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h1 className="text-xl font-bold font-poster tracking-wide uppercase text-white">
                Se interrumpió la sesión — O'nde Luigi
              </h1>
            </div>
            <p className="text-sm text-neutral-400 mb-4 leading-relaxed">
              Detectamos un inconveniente al sincronizar los datos. Puedes recargar la aplicación para continuar.
            </p>
            <div className="bg-[#0A0A0A] border border-white/10 rounded-xl p-3 text-xs font-mono text-neutral-300 break-all mb-4 max-h-32 overflow-y-auto">
              {this.state.errorMessage}
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-amber-500 text-neutral-950 text-sm font-bold hover:bg-amber-400 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Recargar aplicación
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
