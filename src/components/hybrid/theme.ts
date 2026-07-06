// src/components/hybrid/theme.ts — hybrid viewer palette.
// Values are pulled straight from the app-wide tokens in src/index.css so this
// viewer reads as the same product as the Schematic and Layout (DSPF) homes:
// same dark neutrals + Sora/Space-Mono type, same blue accent (--accent),
// yellow selection (--sel) and violet "connected" (--conn) highlight language.
// (This viewer renders via inline styles / SVG attributes rather than the CSS
// classes, so the shared hexes are mirrored here instead of read from :root.)
export const T = {
  // Surfaces & neutrals — --bg / --panel / --panel-2 / --txt / --txt-dim / --line
  bg: '#0e1116', panel: '#151a21', panel2: '#1b212b', card: '#1b212b',
  text: '#dbe3ee', muted: '#7d8a9c', faint: '#566073', border: '#262e3a',
  // edge was --line (#262e3a) — invisible against the canvas at context
  // opacity; the layer-to-layer connection lines must read clearly, so the
  // whole edge system is bright slate. `spine` is the open-chain descent
  // line — brighter still, drawn full-strength above the context fans.
  rail: '#38485c', edge: '#64809f', spine: '#8aa5c4',
  // Interactive accent — --accent / --accent-soft. `blue` is kept as the name
  // the components already use for accent-colored controls.
  accent: '#4f9dff', accentSoft: '#1d3756', blue: '#4f9dff',
  // Highlight language shared with the other viewers:
  sel: '#ffd23f',       // selected block ring — --sel (yellow)
  conn: '#c084fc',      // cross-hierarchy "connected" trace — --conn (violet)
  path: '#2dd4bf',      // pin-to-pin path overlay — --port (teal)
  coupling: '#9b7fe0',  // coupling capacitance — --c (capacitor lavender)
  danger: '#ff5c7a',    // errors / no-path — --net-pwr
  unclass: '#8b95a7',   // unclassified zone — --net-gnd (neutral gray)
  dim: 0.15,
  // Functional zones drawn from the app's own device hues: analog=green
  // (--pin-i/--m), digital=blue (--accent), mixed=orange (--pin-o).
  groupColors: { A: '#5fd0a0', D: '#4f9dff', AMS: '#ff9d5c' } as Record<string, string>,
  // App-wide type roles: Sora for UI labels (body default), Space Mono for
  // every technical identifier and value — same split as the other viewers.
  mono: "'Space Mono', monospace",
  radius: 10, // --radius
};
