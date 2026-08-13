import React, { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by App ErrorBoundary:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: undefined });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 selection:bg-amber-500/20">
          <div className="max-w-md w-full rounded-2xl border border-red-500/30 bg-slate-900/90 p-6 shadow-2xl space-y-4 text-center backdrop-blur-md">
            <div className="inline-flex p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400">
              <AlertTriangle size={32} />
            </div>
            
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-slate-100">Something went wrong</h2>
              <p className="text-xs text-slate-400">
                The Council Chamber encountered an unexpected error. You can refresh to restore state.
              </p>
            </div>

            {this.state.error && (
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 font-mono text-[11px] text-red-300 text-left overflow-x-auto max-h-32">
                {this.state.error.message || 'Unknown error'}
              </div>
            )}

            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-600 to-cyan-600 hover:from-amber-500 hover:to-cyan-500 text-white font-semibold text-xs transition-all shadow-md hover:shadow-amber-500/20 cursor-pointer"
            >
              <RefreshCw size={14} />
              <span>Reload Application</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
