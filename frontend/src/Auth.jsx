import { useState, useEffect } from 'react';

// Simple username + password login / sign-up dialog.
// Talks to the existing backend routes: POST /api/auth/login and /api/auth/register.
function Auth({ apiUrl, onSuccess, onClose }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isRegister = mode === 'register';

  const switchMode = () => {
    setMode(isRegister ? 'login' : 'register');
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;

    const cleanName = username.trim();
    if (!cleanName || !password) {
      setError('Please enter a username and password.');
      return;
    }
    if (isRegister && password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      const response = await fetch(`${apiUrl}/api/auth/${isRegister ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanName, password }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.token) {
        setError(data.error || 'Something went wrong. Please try again.');
        return;
      }

      onSuccess({ token: data.token, user: data.user });
    } catch {
      setError('Could not reach the server. Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="auth-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form className="auth-card" onSubmit={handleSubmit} aria-label={isRegister ? 'Create account' : 'Log in'}>
        <h2 className="auth-title">{isRegister ? 'Create your account' : 'Welcome back'}</h2>
        <p className="auth-subtitle">
          {isRegister
            ? 'Get your own spending policy and order history.'
            : 'Log in to use your own spending policy and order history.'}
        </p>

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
          {isRegister ? 'Already have an account? Log in' : "New here? Create an account"}
        </button>

        <button className="auth-guest" type="button" onClick={onClose}>
          Continue as guest
        </button>
      </form>
    </div>
  );
}

export default Auth;
