import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: 'Segoe UI, sans-serif' }}>
          <h1 style={{ color: '#dc2626' }}>Application Error</h1>
          <p style={{ color: '#475569' }}>{this.state.error}</p>
          <p style={{ color: '#94a3b8', fontSize: 14, marginTop: 16 }}>
            Check DevTools console (F12) or restart with pnpm dev
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
