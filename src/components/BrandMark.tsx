import { useId } from 'react';

// App logo: a MOSFET — the one symbol every user of this tool draws daily —
// on the brand gradient. Used in the landing header and the viewer TopBar.
export function BrandMark({ size = 22 }: { size?: number }) {
  const grad = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--port)" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="23" height="23" rx="6.5" fill={`url(#${grad})`} />
      {/* NMOS: gate lead + gate bar, channel bar, drain up / source down */}
      <g stroke="#0b1016" strokeWidth="1.9" strokeLinecap="round" fill="none">
        <path d="M4.5 12h4" />
        <path d="M9.5 7.5v9" />
        <path d="M13 6.5v11" />
        <path d="M13 8.5h5v-3" />
        <path d="M13 15.5h5v3" />
      </g>
    </svg>
  );
}
