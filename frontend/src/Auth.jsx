import { useState, useEffect } from 'react';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

function Auth({ onAuthSuccess }) {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  // After registration, show "check your email" screen
  const [pendingVerification, setPendingVerification] = useState(false);
  // Show "verified" banner if redirected back after clicking email link
  const [justVerified, setJustVerified] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('verified') === 'true') {
      setJustVerified(true);
      // Clean the URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const toggle = () => {
    setIsRegister((prev) => !prev);
    setError(null);
    setPendingVerification(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
      const body = isRegister
        ? { username, password, email }
        : { username, password };
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();

      if (!response.ok) {
        // Special case: email not yet verified
        if (data.requiresVerification) {
          setError('Your email is not verified yet. Please check your inbox.');
        } else {
          throw new Error(data.error || 'Authentication failed');
        }
        return;
      }

      if (data.requiresVerification) {
        // Registration succeeded — waiting for email verification
        setPendingVerification(true);
        return;
      }

      if (data.token) {
        onAuthSuccess(data.token);
      } else {
        throw new Error('No token returned from server');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // "Check your email" screen
  if (pendingVerification) {
    return (
      <div className="auth-page">
        <div className="auth-container">
          <h2 className="auth-title">Check your email 📬</h2>
          <p style={{ textAlign: 'center', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            We've sent a verification link to <strong>{email}</strong>.
            Click it to activate your account, then come back and log in.
          </p>
          <p style={{ textAlign: 'center', marginTop: 8, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            The link expires in 24 hours.
          </p>
          <button
            className="auth-button"
            style={{ marginTop: 24 }}
            onClick={() => { setPendingVerification(false); setIsRegister(false); }}
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-container">
        <h2 className="auth-title">{isRegister ? 'Create Account' : 'Welcome Back'}</h2>

        {justVerified && (
          <div className="auth-success">
            ✅ Email verified! You can now log in.
          </div>
        )}

        {error && <div className="auth-error">{error}</div>}

        <form className="auth-form" onSubmit={handleSubmit}>
          {isRegister && (
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          )}
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button type="submit" className="auth-button" disabled={loading}>
            {loading ? 'Processing…' : isRegister ? 'Register' : 'Log In'}
          </button>
        </form>

        <div className="auth-toggle">
          {isRegister ? (
            <span>
              Already have an account?{' '}
              <button className="auth-switch" onClick={toggle}>Log in</button>
            </span>
          ) : (
            <span>
              New here?{' '}
              <button className="auth-switch" onClick={toggle}>Register</button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default Auth;
