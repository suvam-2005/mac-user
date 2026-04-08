/**
 * src/pages/Login.tsx
 * ====================
 * Login screen.
 *
 * Flow:
 *   1. User submits username + password
 *   2. Renderer calls main process IPC with credentials
 *   3. Main process authenticates with FastAPI /auth/login and stores JWT in-memory
 *   4. Main process fetches /users/me and returns profile to renderer
 *   5. Store is hydrated with username + session counts
 *   6. onLoginSuccess() triggers App to switch to Dashboard
 *
 * The renderer NEVER stores the JWT.
 */

import React, { useState, useRef, useEffect } from 'react';
import { BACKEND_BASE_URL } from '../lib/api';
import { useStore } from '../lib/store';
import { hasPermittedSession } from '../lib/session-config';

interface LoginProps {
  onLoginSuccess: () => void;
}

export function Login({ onLoginSuccess }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  const login = useStore((s) => s.login);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError(null);

    try {
      // Always clear any stale main-process auth before a new attempt.
      await window.electronAPI.logout();

      // Authenticate and fetch profile through the main process so desktop
      // login does not depend on renderer/browser fetch behavior.
      const { user: me } = await window.electronAPI.loginWithCredentials(
        username.trim(),
        password,
        BACKEND_BASE_URL,
      );

      // ── Hydrate store (no token here — store is safe) ───────────────
      login({
        userId:            me.id,
        username:          me.username,
        permittedSessions: me.permitted_sessions,
        usedSessions:      me.used_sessions,
        sessionLaunchAllowed: hasPermittedSession(me.custom_prompt),
      });

      onLoginSuccess();

    } catch (err: any) {
      // Ensure failures never leave main-process auth in a half state.
      try { await window.electronAPI.logout(); } catch {}
      setError(err?.message ?? 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fade-up"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 28px',
        gap: '28px',
      }}
    >
      {/* ── Logo mark ─────────────────────────────────────────────────── */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: '40px', height: '40px', borderRadius: '10px',
          background: 'var(--accent-muted)',
          border: '1px solid rgba(0,229,204,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 14px',
        }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M10 2L17 6v8l-7 4L3 14V6l7-4z"
              stroke="var(--accent)" strokeWidth="1.2"
              fill="none" strokeLinejoin="round"
            />
            <circle cx="10" cy="10" r="2.5" fill="var(--accent)" opacity="0.7" />
          </svg>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '12px', letterSpacing: '0.1em', fontWeight: 500 }}>
          NEONEXUS COPILOT
        </p>
      </div>

      {/* ── Form ──────────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <label style={{ color: 'var(--text-muted)', fontSize: '11px', letterSpacing: '0.08em', fontWeight: 500 }}>
            USERNAME
          </label>
          <input
            ref={usernameRef}
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={loading}
            style={inputStyle}
            placeholder="your_username"
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <label style={{ color: 'var(--text-muted)', fontSize: '11px', letterSpacing: '0.08em', fontWeight: 500 }}>
            PASSWORD
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={loading}
            style={inputStyle}
            placeholder="••••••••"
          />
        </div>

        {/* ── Error banner ────────────────────────────────────────────── */}
        {error && (
          <div style={{
            padding: '8px 10px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(224,82,82,0.08)',
            border: '1px solid rgba(224,82,82,0.2)',
            color: 'var(--status-error)',
            fontSize: '12.5px',
            lineHeight: 1.4,
          }}>
            {error}
          </div>
        )}

        {/* ── Submit ──────────────────────────────────────────────────── */}
        <button
          type="submit"
          disabled={loading || !username.trim() || !password}
          style={{
            ...buttonStyle,
            marginTop: '4px',
            opacity: (loading || !username.trim() || !password) ? 0.45 : 1,
            cursor: (loading || !username.trim() || !password) ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: '7px', justifyContent: 'center' }}>
              <Spinner /> Signing in…
            </span>
          ) : 'Sign in'}
        </button>
      </form>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <p style={{ color: 'var(--text-muted)', fontSize: '11px', textAlign: 'center' }}>
        Contact your administrator for access.
      </p>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 0.8s linear infinite' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.25"/>
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

// ── Shared style objects ──────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--bg-border)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-mono)',
  fontSize: '13.5px',
  outline: 'none',
  userSelect: 'text',
  WebkitUserSelect: 'text',
  transition: 'border-color 0.15s',
};

const buttonStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px',
  borderRadius: 'var(--radius-md)',
  background: 'var(--accent)',
  border: 'none',
  color: '#0d1210',
  fontFamily: 'var(--font-ui)',
  fontSize: '13.5px',
  fontWeight: 600,
  letterSpacing: '0.04em',
  cursor: 'pointer',
  transition: 'opacity 0.15s',
};
