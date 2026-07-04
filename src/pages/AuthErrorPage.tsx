import { AlertTriangle, LogIn } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function AuthErrorPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const message = params.get('message') || 'Login could not be completed. Please try again.';

  return (
    <div className="auth-error-page">
      <div className="auth-error-card">
        <div className="auth-error-icon">
          <AlertTriangle />
        </div>
        <h1>Login failed</h1>
        <p>{message}</p>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/auth-login', { replace: true })}>
          <LogIn />
          <span>Back to Login</span>
        </button>
      </div>
    </div>
  );
}
