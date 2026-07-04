import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function DashboardLoadErrorPage() {
  return (
    <div className="auth-error-page">
      <div className="auth-error-card">
        <div className="auth-error-icon">
          <AlertTriangle />
        </div>
        <h1>Dashboard Load Error</h1>
        <p>The dashboard could not be opened. Reload the app or sign in again.</p>
        <div className="auth-error-actions">
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            <RefreshCw />
            <span>Reload App</span>
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => { window.location.hash = '#/auth-login'; }}>
            Back to Login
          </button>
        </div>
      </div>
    </div>
  );
}
