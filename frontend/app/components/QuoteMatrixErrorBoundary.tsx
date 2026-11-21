'use client';

import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

export interface QuoteMatrixErrorBoundaryProps {
  children: React.ReactNode;
  onBack: () => void;
}

export interface QuoteMatrixErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class QuoteMatrixErrorBoundary extends React.Component<
  QuoteMatrixErrorBoundaryProps,
  QuoteMatrixErrorBoundaryState
> {
  constructor(props: QuoteMatrixErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): QuoteMatrixErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('QuoteMatrix caught rendering error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 max-w-xl mx-auto my-12 text-center rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/30 space-y-4">
          <div className="w-12 h-12 mx-auto rounded-full bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400 flex items-center justify-center">
            <AlertCircle size={24} />
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Unable to display Quote Matrix</h2>
          <p className="text-xs text-slate-600 dark:text-gray-400">
            {this.state.error?.message || 'An unexpected rendering error occurred while loading the quote matrix.'}
          </p>
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: null })}
              className="btn btn-primary btn-sm font-semibold inline-flex items-center gap-1.5"
            >
              <RefreshCw size={13} /> Retry
            </button>
            <button
              type="button"
              onClick={this.props.onBack}
              className="btn btn-secondary btn-sm font-semibold"
            >
              Back to All RFQs
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default QuoteMatrixErrorBoundary;
