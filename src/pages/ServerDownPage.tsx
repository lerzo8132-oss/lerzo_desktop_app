import { AlertTriangle, RotateCcw, LogIn } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function ServerDownPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const rawFrom = params.get('from') || '/auth-login';
  const from = rawFrom.startsWith('/server-down') ? '/dashboard' : rawFrom.split('?')[0] || '/dashboard';

  const retry = () => {
    if (from === '/server-down') {
      console.warn('[ROUTE GUARD] preventing server-down loop');
      navigate('/dashboard', { replace: true });
      return;
    }
    navigate(from, { replace: true });
  };

  const backToLogin = () => {
    navigate('/auth-login', { replace: true });
  };

  return (
    <div className="server-down-page">
      <div className="server-down-card">
        <div className="server-down-icon">
          <AlertTriangle />
        </div>
        <h1>Server is currently unavailable</h1>
        <p>Our server may be down or temporarily unreachable.</p>
        <p>Please try again after some time. If the issue continues, try again after 1–2 hours.</p>
        <div className="server-down-actions">
          <button type="button" className="btn btn-primary" onClick={retry}>
            <RotateCcw />
            <span>Retry</span>
          </button>
          <button type="button" className="btn btn-secondary" onClick={backToLogin}>
            <LogIn />
            <span>Back to Login</span>
          </button>
        </div>
      </div>
    </div>
  );
}
