/**
 * src/components/SessionCounter.tsx
 * ===================================
 * Displays the user's session usage as a compact pill + capacity bar.
 * Colour shifts from cyan → amber → red as capacity fills.
 */

import React from 'react';
import { useStore, selectSessionsRemaining } from '../lib/store';

export function SessionCounter() {
  const permitted  = useStore((s) => s.permittedSessions);
  const used       = useStore((s) => s.usedSessions);
  const remaining  = useStore(selectSessionsRemaining);

  if (permitted === 0) {
    return (
      <div style={wrapStyle}>
        <span style={{ color: 'var(--status-error)', fontSize: '11.5px' }}>
          No sessions allocated
        </span>
      </div>
    );
  }

  const pct = used / permitted;
  const fillColor =
    pct >= 1    ? 'var(--status-error)' :
    pct >= 0.75 ? 'var(--status-warn)'  :
                  'var(--accent)';

  return (
    <div style={wrapStyle}>
      <span style={{ color: 'var(--text-muted)', fontSize: '9px', letterSpacing: '0.08em', fontWeight: 600 }}>
        SESSIONS
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: fillColor, marginLeft: '6px' }}>
        {used}
        <span style={{ color: 'var(--text-muted)', margin: '0 2px' }}>/</span>
        {permitted}
      </span>
      <span style={{ color: 'var(--text-muted)', fontSize: '10px', marginLeft: '8px' }}>
        ({remaining} left)
      </span>
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '6px 9px',
  background: 'var(--bg-elevated)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--bg-border)',
};
