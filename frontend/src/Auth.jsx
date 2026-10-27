import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// Login / Register dialog with email verification support.
function Auth({ apiUrl, onSuccess, onClose }) {
  const resolvedApiUrl = apiUrl || API_URL;

  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // After registration, show "check email" screen
  const [pendingVerification, setPendingVerification] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');
  // Show success banner when redirected back after clicking email link
  const [justVerified, setJustVerified] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('verified') === 'true') {
      setJustVerified(true);
      setMode('login');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isRegister = mode === 'register';

  const switchMode = () => {
    setMode(isRegister ? 'login' : 'register');
    setError('');
    setPendingVerification(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;

    const cleanName = username.trim();
    if (!cleanName || !password) {
      setError('Please enter a username and password.');
      return;
    }
    if (isRegister && !email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    if (isRegister && password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      const body = isRegister
        ? { username: cleanName, password, email: email.trim() }
        : { username: cleanName, password };

      const response = await fetch(
        `${resolvedApiUrl}/api/auth/${isRegister ? 'register' : 'login'}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (data.requiresVerification) {
          setError('Your email is not verified yet. Please check your inbox.');
        } else {
          setError(data.error || 'Something went wrong. Please try again.');
        }
        return;
      }

      // Registration succeeded — waiting for email verification
      if (data.requiresVerification) {
        setPendingEmail(email.trim());
        setPendingVerification(true);
        return;
      }

      if (data.token) {
        onSuccess({ token: data.token, user: data.user });
      } else {
        setError('No token returned from server.');
      }
    } catch {
      setError('Could not reach the server. Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  // "Check your email" screen
  if (pendingVerification) {
    return (
      <div className="auth-backdrop">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <h2 className="auth-title">Check your email 📬</h2>
          <p className="auth-subtitle">
            We sent a verification link to <strong>{pendingEmail}</strong>.<br />
            Click it to activate your account, then come back and log in.
          </p>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0 0 20px' }}>
            The link expires in 24 hours.
          </p>
          <button
            className="auth-submit"
            onClick={() => { setPendingVerification(false); setMode('login'); }}
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="auth-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <form
        className="auth-card"
        onSubmit={handleSubmit}
        aria-label={isRegister ? 'Create account' : 'Log in'}
      >
        <h2 className="auth-title">
          {isRegister ? 'Create your account' : 'Welcome back'}
        </h2>
        <p className="auth-subtitle">
          {isRegister
            ? 'Get your own spending policy and order history.'
            : 'Log in to use your own spending policy and order history.'}
        </p>

        {justVerified && (
          <div className="auth-success">✅ Email verified! You can now log in.</div>
        )}

        {isRegister && (
          <>
            <label className="auth-label" htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              className="auth-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </>
        )}

        <label className="auth-label" htmlFor="auth-username">Username</label>
        <input
          id="auth-username"
          className="auth-input"
          type="text"
          autoComplete="username"
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />

        <label className="auth-label" htmlFor="auth-password">Password</label>
        <input
          id="auth-password"
          className="auth-input"
          type="password"
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <div className="auth-error" role="alert">{error}</div>}

        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : isRegister ? 'Sign up' : 'Log in'}
        </button>

        <button className="auth-switch" type="button" onClick={switchMode}>
          {isRegister ? 'Already have an account? Log in' : 'New here? Create an account'}
        </button>

        {onClose && (
          <button className="auth-guest" type="button" onClick={onClose}>
            Continue as guest
          </button>
        )}
      </form>
    </div>
  );
}

export default Auth;
