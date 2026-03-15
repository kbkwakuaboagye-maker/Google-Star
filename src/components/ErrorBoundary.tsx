import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-black text-white p-6">
          <div className="max-w-md w-full border border-white/20 rounded-2xl p-8 backdrop-blur-xl bg-white/5">
            <h2 className="text-2xl font-light mb-4 tracking-tight">Something went wrong</h2>
            <p className="text-white/60 text-sm mb-6 leading-relaxed">
              We encountered an unexpected error. Please try refreshing the page.
            </p>
            <pre className="bg-black/40 p-4 rounded-lg text-xs overflow-auto max-h-40 mb-6 text-emerald-400/80">
              {this.state.error?.message}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 rounded-full border border-white/20 hover:bg-white hover:text-black transition-all duration-300 text-sm tracking-widest uppercase"
            >
              Refresh App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
