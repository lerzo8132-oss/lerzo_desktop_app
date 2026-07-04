import React from 'react';

type AppErrorBoundaryProps = {
  children: React.ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export default class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Renderer Error] render crash =', error.message, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="auth-error-page">
          <div className="auth-error-card">
            <h1>Something went wrong</h1>
            <p>{this.state.error.message || 'The desktop app hit an unexpected error.'}</p>
            <div className="auth-error-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  this.setState({ error: null });
                  window.location.hash = '#/auth-login';
                }}
              >
                Back to Login
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => window.location.reload()}
              >
                Reload App
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
