// @jsxRuntime automatic
// @jsxImportSource react
//
// The browser build uses the automatic JSX runtime (tsconfig.app.json's
// `jsx: react-jsx`), but the headless layout path (server/subcircuit_visualize
// → elk → deviceFootprint → deviceSymbol) is transpiled by `tsx`, which ignores
// that tsconfig and defaults to the classic transform — emitting bare
// `React.createElement` with no React import, so building a glyph to measure it
// threw "React is not defined". These pragmas pin this file to the automatic
// runtime in both pipelines, matching the browser build.
import { Position } from '@xyflow/react';
import type { Primitive } from '../../parser/types';

// Real schematic symbols for leaf devices. Each symbol is drawn in its own
// pixel-space box; `slots` gives the exact (x, y) tip of every electrical
// terminal plus the React Flow side it faces, so the wire handles can be
// anchored onto the symbol instead of onto a generic box.
//
// The handle ids the rest of the app wires to are `${term}-src` / `${term}-tgt`
// (see SchematicCanvas / PrimitiveNode). The `term` keys here therefore MUST
// match the terminal names the parser emits:
//   M (transistor) → d, g, s, b      C/R → p, n      X-passive → a, b, c

export interface TermSlot {
  x: number;
  y: number;
  position: Position;
}

// What a symbol function draws — the bare glyph in its own coordinate box.
interface CoreSymbol {
  width: number;
  height: number;
  slots: Record<string, TermSlot>;
  svg: React.ReactNode;
}

export interface DeviceSymbol {
  // Full footprint, including the stub margins reserved on each terminal side.
  width: number;
  height: number;
  // Where the bare glyph (`svg`) is drawn inside that footprint. The caller
  // offsets the glyph by this so the reserved margins surround it.
  drawX: number;
  drawY: number;
  // Terminal tips in footprint coordinates (already shifted by drawX/drawY).
  slots: Record<string, TermSlot>;
  svg: React.ReactNode;
}

// Core glyph dimensions, shared with deviceFootprint() so ELK's reserved size
// always matches what actually renders.
const MOS_W = 64;
const MOS_H = 76;
const PASSIVE_W = 44;
const PASSIVE_H = 72;

// Space reserved on each terminal-bearing side for a supply "stub" — the small
// ground/VDD glyph drawn in place of a wire when supply nets are hidden (see
// PrimitiveNode). Without it a downward stub would collide with the id/model
// caption beneath the symbol. Reserved unconditionally so toggling "hide
// supply" only adds/removes the glyph and never reflows the layout.
const STUB_MARGIN = 16;

// ── NMOS vs PMOS from the model name ──────────────────────────────────────
// CDL stores only the model string (e.g. "nch_18", "pfet_g5v0", "pmos_rf").
// There's no flag for polarity, so we read the conventional n-/p- prefixes
// PDKs use. Returns 'p', 'n', or null (unknown → drawn as a plain MOSFET).
export function mosPolarity(model: string): 'n' | 'p' | null {
  const m = model.toLowerCase();
  if (/(?:^|[^a-z])(?:pmos|pfet|pch|pjf|pdio|pmoscap)/.test(m)) return 'p';
  if (/(?:^|[^a-z])(?:nmos|nfet|nch|njf|ndio|nmoscap)/.test(m)) return 'n';
  // Fall back to the leading polarity letter many compact models use.
  if (/^p[a-z]*(?:fet|mos|ch|_|\d)/.test(m)) return 'p';
  if (/^n[a-z]*(?:fet|mos|ch|_|\d)/.test(m)) return 'n';
  return null;
}

const STROKE = 1.6;

// ── MOSFET (4-terminal, IC enhancement style) ─────────────────────────────
// The textbook analog-IC MOSFET: a gate electrode bar on the left, separated
// by a capacitive gap from a broken three-segment channel (the enhancement-
// mode marking). The drain finger exits the top, the source finger the bottom,
// and the bulk finger runs out to the right carrying the substrate arrow —
// which points INTO the channel for NMOS and OUT for PMOS (the 4-terminal
// convention). Drain/source/bulk are kept apart so they never short across the
// channel. The arrow is omitted when polarity is unknown, so the glyph still
// reads as a plain MOSFET.
function mosfetSymbol(polarity: 'n' | 'p' | null): CoreSymbol {
  const W = MOS_W;
  const H = MOS_H;
  const midY = 38;
  const dsX = 44;        // drain/source lead column, right of the channel
  // Substrate arrow on the bulk finger, between channel (x=30) and bulk term.
  const arrow = polarity === 'n'
    ? '37,38 45,34 45,42'   // tip points left → into channel (NMOS)
    : polarity === 'p'
    ? '45,38 37,34 37,42'   // tip points right → out (PMOS)
    : null;

  return {
    width: W,
    height: H,
    slots: {
      d: { x: dsX, y: 2, position: Position.Top },
      s: { x: dsX, y: H - 2, position: Position.Bottom },
      g: { x: 2, y: midY, position: Position.Left },
      b: { x: W - 2, y: midY, position: Position.Right },
    },
    svg: (
      <svg width={W} height={H} className="dev-svg" fill="none" stroke="currentColor"
        strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
        {/* gate: lead + electrode bar */}
        <line x1={2} y1={midY} x2={22} y2={midY} />
        <line x1={22} y1={20} x2={22} y2={56} strokeWidth={2.2} />
        {/* channel: three broken segments (enhancement mode) */}
        <line x1={30} y1={20} x2={30} y2={30} strokeWidth={2.2} />
        <line x1={30} y1={33} x2={30} y2={43} strokeWidth={2.2} />
        <line x1={30} y1={46} x2={30} y2={56} strokeWidth={2.2} />
        {/* drain finger up, source finger down */}
        <polyline points={`30,25 ${dsX},25 ${dsX},2`} />
        <polyline points={`30,51 ${dsX},51 ${dsX},${H - 2}`} />
        {/* bulk finger + polarity arrow */}
        <line x1={30} y1={midY} x2={W - 2} y2={midY} />
        {arrow && <polygon points={arrow} fill="currentColor" stroke="none" />}
      </svg>
    ),
  };
}

// ── Resistor (vertical zig-zag, p top / n bottom) ─────────────────────────
function resistorSymbol(thirdTerm?: string): CoreSymbol {
  const W = PASSIVE_W;
  const H = PASSIVE_H;
  const cx = W / 2;
  const top = 14;
  const bot = 58;
  // Six-segment zig-zag between top and bot.
  const segs = 6;
  const pts: string[] = [`${cx},${top}`];
  for (let i = 0; i < segs; i++) {
    const y = top + ((i + 0.5) * (bot - top)) / segs;
    pts.push(`${i % 2 === 0 ? cx + 9 : cx - 9},${y}`);
  }
  pts.push(`${cx},${bot}`);

  const slots: Record<string, TermSlot> = {
    p: { x: cx, y: 4, position: Position.Top },
    n: { x: cx, y: H - 4, position: Position.Bottom },
  };
  if (thirdTerm) slots[thirdTerm] = { x: 4, y: H / 2, position: Position.Left };

  return {
    width: W,
    height: H,
    slots,
    svg: (
      <svg width={W} height={H} className="dev-svg" fill="none" stroke="currentColor"
        strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
        <line x1={cx} y1={4} x2={cx} y2={top} />
        <polyline points={pts.join(' ')} />
        <line x1={cx} y1={bot} x2={cx} y2={H - 4} />
        {thirdTerm && <line x1={4} y1={H / 2} x2={cx} y2={H / 2} />}
      </svg>
    ),
  };
}

// ── Capacitor (two plates, p top / n bottom) ──────────────────────────────
function capacitorSymbol(thirdTerm?: string): CoreSymbol {
  const W = PASSIVE_W;
  const H = PASSIVE_H;
  const cx = W / 2;
  // Two equal parallel plates with a clear dielectric gap, centred on the box.
  const p1 = 31;
  const p2 = 41;
  const plateHalf = 14;

  const slots: Record<string, TermSlot> = {
    p: { x: cx, y: 4, position: Position.Top },
    n: { x: cx, y: H - 4, position: Position.Bottom },
  };
  if (thirdTerm) slots[thirdTerm] = { x: 4, y: H / 2, position: Position.Left };

  return {
    width: W,
    height: H,
    slots,
    svg: (
      <svg width={W} height={H} className="dev-svg" fill="none" stroke="currentColor"
        strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
        <line x1={cx} y1={4} x2={cx} y2={p1} />
        <line x1={cx - plateHalf} y1={p1} x2={cx + plateHalf} y2={p1} strokeWidth={2.4} />
        <line x1={cx - plateHalf} y1={p2} x2={cx + plateHalf} y2={p2} strokeWidth={2.4} />
        <line x1={cx} y1={p2} x2={cx} y2={H - 4} />
        {thirdTerm && <line x1={4} y1={H / 2} x2={cx} y2={H / 2} />}
      </svg>
    ),
  };
}

// ── Footprint: reserve stub margins around the bare glyph ──────────────────
// Grows the box by STUB_MARGIN on each side that has a terminal (so a 2-pin
// cap keeps its narrow width but gains top/bottom room), shifts the glyph and
// every slot inward by that margin, and records where the glyph is drawn.
function withStubMargins(core: CoreSymbol): DeviceSymbol {
  const sides = new Set(Object.values(core.slots).map(s => s.position));
  const l = sides.has(Position.Left) ? STUB_MARGIN : 0;
  const r = sides.has(Position.Right) ? STUB_MARGIN : 0;
  const t = sides.has(Position.Top) ? STUB_MARGIN : 0;
  const b = sides.has(Position.Bottom) ? STUB_MARGIN : 0;

  const slots: Record<string, TermSlot> = {};
  for (const [k, s] of Object.entries(core.slots)) {
    slots[k] = { ...s, x: s.x + l, y: s.y + t };
  }
  return {
    width: core.width + l + r,
    height: core.height + t + b,
    drawX: l,
    drawY: t,
    slots,
    svg: core.svg,
  };
}

// Build the bare glyph + aliased slots for a device (no margins yet).
function coreSymbol(prim: Primitive): CoreSymbol | null {
  const termNames = prim.terms.map(([t]) => t);
  if (prim.kind === 'M') return mosfetSymbol(mosPolarity(prim.model));
  // Passives may arrive as native R/C (p,n) or as X-pseudo devices (a,b,c).
  // Map the first two terminals to the symbol's top/bottom and keep any third
  // as a side tap, so every parsed terminal still gets a wire handle.
  const third = termNames.length > 2 ? termNames[2] : undefined;
  const sym = prim.kind === 'R' ? resistorSymbol(third)
    : prim.kind === 'C' ? capacitorSymbol(third)
    : null;
  if (!sym) return null;
  // For X-passives the terminal names are a/b/c, not p/n — alias them onto the
  // symbol's top/bottom slots.
  if (termNames[0] !== 'p' && termNames[0] !== 'n') {
    const { p, n, ...rest } = sym.slots;
    sym.slots = { [termNames[0]]: p, [termNames[1]]: n, ...rest } as Record<string, TermSlot>;
  }
  return sym;
}

// Pick the right symbol for a device. Returns null for kinds we don't have a
// symbol for (so the caller can fall back to the generic glyph box).
export function deviceSymbol(prim: Primitive): DeviceSymbol | null {
  const core = coreSymbol(prim);
  return core ? withStubMargins(core) : null;
}

// Footprint (incl. stub margins) ELK should reserve for a device, or null when
// it falls back to the generic glyph box. Derived from the same symbol the
// node renders so reserved size and rendered size always agree.
export function deviceFootprint(prim: Primitive): { width: number; height: number } | null {
  const sym = deviceSymbol(prim);
  return sym ? { width: sym.width, height: sym.height } : null;
}

// ── Supply stub glyph ──────────────────────────────────────────────────────
// A short lead from a terminal tip ending in a ground (three tapering bars) or
// power (single rail bar) symbol, drawn when "hide supply" suppresses the wire
// so the terminal reads as terminated instead of floating. Coordinates are in
// the symbol footprint space (slot already includes the draw offset); the glyph
// extends outward along the terminal's side. Coloured by net kind to match the
// wire legend, independent of the device's own colour.
export function supplyStub(term: string, slot: TermSlot, kind: 'power' | 'ground'): React.ReactNode {
  const [ox, oy] =
    slot.position === Position.Top ? [0, -1]
    : slot.position === Position.Bottom ? [0, 1]
    : slot.position === Position.Left ? [-1, 0]
    : [1, 0];
  const horizontal = ox !== 0; // lead runs horizontally → bars are vertical
  const lead = 4;
  const color = kind === 'ground' ? 'var(--net-gnd)' : 'var(--net-pwr)';

  // A bar perpendicular to the lead, `dist` out from the tip, half-length `half`.
  const bar = (dist: number, half: number, key: string) => {
    const bx = slot.x + ox * dist;
    const by = slot.y + oy * dist;
    const [hx, hy] = horizontal ? [0, half] : [half, 0];
    return <line key={key} x1={bx - hx} y1={by - hy} x2={bx + hx} y2={by + hy} />;
  };

  return (
    <g key={`stub-${term}`} stroke={color} strokeWidth={1.6} strokeLinecap="round" fill="none">
      <line x1={slot.x} y1={slot.y} x2={slot.x + ox * lead} y2={slot.y + oy * lead} />
      {kind === 'ground' ? (
        <>
          {bar(lead, 8, 'g0')}
          {bar(lead + 3.5, 5, 'g1')}
          {bar(lead + 7, 2, 'g2')}
        </>
      ) : (
        bar(lead + 1, 8.5, 'p0')
      )}
    </g>
  );
}
