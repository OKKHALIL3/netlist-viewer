import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHybridStore, passesFilters } from '../../store/hybridStore';
import { computeRails, type RailItem } from '../../hybrid/slots';
import { criticalityScores, criticalityOrder } from '../../hybrid/criticality';
import { UNCLASSIFIED } from '../../hybrid/classify';
import { displayPath, type HybridModel } from '../../hybrid/model';
import { T } from './theme';

// Emphasis model: the frontier rail is the content — full-size and
// full-strength; every ancestor rail renders as short compressed cards +
// extra-thin slivers, faded, with tighter vertical rhythm — context, not
// content. The open chain runs down a center spine, the frontier may stack
// into several centered rows (slots.ts), and the view itself pans AND zooms
// (ctrl/pinch wheel, +/− buttons, F or double-click = center & fit).
const MARGIN_X = 70, TOP_PAD = 46, BLOCK_H = 58, CTX_H = 40, GAP_Y = 54, ROW_GAP_Y = 30;
const CTX_CARD_OPACITY = 0.55, CTX_SLIVER_OPACITY = 0.32;
const MIN_K = 0.15, MAX_K = 2.5;
const MAX_REVEAL = 24; // strongest device-neighbors opened full-size on canvas at once

// Counts on the block cards: keep them within the card at any magnitude.
const fmtCount = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` :
  n >= 1e4 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k` : String(n);

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s);

// Deepest on-canvas ancestor of a display path — lets overlays point INTO a
// collapsed branch: the sliver (or closed frontier box) containing the target
// gets a mark instead of the target silently disappearing off-canvas.
function visibleAncestor(model: HybridModel, visible: ReadonlySet<string>, path: string): string | undefined {
  let p = model.blocks.get(path)?.parent;
  while (p !== null && p !== undefined) {
    const dp = displayPath(model, p);
    if (visible.has(dp)) return dp;
    p = model.blocks.get(dp)?.parent;
  }
  return undefined;
}

export function RailsCanvas() {
  const {
    model, openPath, selected, select, toggleOpen, toggleGroup, trace, funcOff, supplyOff,
    zoneColors, sizeByContent, weights, pathResult, pathEnds, coupling, couplingBusy, couplingNeighbors, version,
  } = useHybridStore();
  // Free transform-based view (drag pans, ctrl/pinch wheel zooms — the canvas
  // itself moves, no scrollbars). Refs + direct style writes: no re-renders
  // per frame.
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const dims = useRef({ w: 0, h: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const applyView = () => {
    if (svgRef.current) {
      svgRef.current.style.transform =
        `translate(${view.current.x}px, ${view.current.y}px) scale(${view.current.k})`;
    }
  };
  // Center & fit: the whole tree inside the viewport, spine in the middle
  // (F, ⊡ button, double-click, and every navigation lands here so the
  // clicked branch comes to the middle).
  const fitView = useCallback(() => {
    const el = wrapRef.current;
    const { w, h } = dims.current;
    if (!el || !w || !h) return;
    const cw = el.clientWidth, ch = el.clientHeight;
    if (!cw || !ch) return;
    const k = Math.min(1, Math.max(MIN_K, Math.min(cw / w, ch / h)));
    view.current = { x: (cw - w * k) / 2, y: Math.max(12, (ch - h * k) / 2), k };
    applyView();
  }, []);
  const zoomAt = useCallback((mx: number, my: number, factor: number) => {
    const v = view.current;
    const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
    const r = k / v.k;
    view.current = { x: mx - (mx - v.x) * r, y: my - (my - v.y) * r, k };
    applyView();
  }, []);
  const zoomStep = (factor: number) => {
    const el = wrapRef.current;
    if (el) zoomAt(el.clientWidth / 2, el.clientHeight / 2, factor);
  };

  const scores = useMemo(() => {
    void version; // reclassify()/toggleGroup() mutate the model in place
    return model ? criticalityScores(model, weights) : null;
  }, [model, weights, version]);
  // On selection the canvas opens a branch to the selection AND to each device
  // neighbor, so the connected set renders full-size at once. A high-fan-out
  // block can touch hundreds of neighbors; opening every branch would be an
  // unreadable sprawl, so the canvas caps at the strongest MAX_REVEAL by
  // criticality — the panel still lists them all, grouped by net.
  // The reveal is DEFERRED past the double-click window: the first click of a
  // dblclick selects, and reshaping the tree right then moves the block out
  // from under the second click — toggleOpen would never fire. Selection
  // highlight, stats and the connected panel still react instantly.
  const [reveal, setReveal] = useState<{ sel: string; trace: NonNullable<typeof trace> } | null>(null);
  useEffect(() => {
    // The coupling overlay draws its own fly-lines from the single-chain
    // frontier; the reveal reshapes that away, so the two lenses don't mix —
    // when coupling is on, selection keeps the normal layout.
    if (!selected || !trace || coupling.on) { setReveal(null); return; }
    const t = setTimeout(() => setReveal({ sel: selected, trace }), 300);
    return () => clearTimeout(t);
  }, [selected, trace, coupling.on]);
  const revealTargets = useMemo(() => {
    if (!reveal) return undefined;
    let ns = [...reveal.trace.blocks];
    if (ns.length > MAX_REVEAL && scores) {
      ns = ns.sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0)).slice(0, MAX_REVEAL);
    }
    return [reveal.sel, ...ns];
  }, [reveal, scores]);
  const layout = useMemo(() => {
    void version; // toggleGroup() swaps children arrays in place
    if (!model || !scores) return null;
    // 128..180 clamp (log-normalized score ∈ [0,1]); uniform when sizing is off
    const fullW = (p: string) => (sizeByContent ? 128 + 52 * (scores.get(p) ?? 0) : 150);
    return computeRails(model, openPath, criticalityOrder(scores), fullW, revealTargets);
  }, [model, scores, openPath, sizeByContent, version, revealTargets]);
  const visible = useMemo(() => new Set(layout ? [...layout.items.keys()] : []), [layout]);
  // Overlay targets hidden inside collapsed branches mark their deepest
  // visible ancestor with a dashed ring: "the connection continues in here".
  const traceMarks = useMemo(() => {
    const out = new Set<string>();
    if (!trace || !model) return out;
    for (const p of trace.blocks) {
      if (visible.has(p)) continue;
      const anc = visibleAncestor(model, visible, p);
      if (anc !== undefined) out.add(anc);
    }
    return out;
  }, [trace, model, visible]);
  const pathOn = useMemo(() => new Set(pathResult?.blocks ?? []), [pathResult]);
  // Path blocks mapped onto what is actually on canvas (consecutive dups
  // collapse) — the overlay still reads as one route even when most of the
  // path lives inside collapsed branches.
  const pathReps = useMemo(() => {
    if (!pathResult || !model) return [];
    const reps: string[] = [];
    for (const p of pathResult.blocks) {
      const r = visible.has(p) ? p : visibleAncestor(model, visible, p);
      if (r !== undefined && reps[reps.length - 1] !== r) reps.push(r);
    }
    return reps;
  }, [pathResult, model, visible]);
  const neighbors = couplingNeighbors ?? [];

  // Every navigation re-homes the view: the newly opened branch comes to the
  // middle of the screen instead of growing off to one side.
  // Refit on navigation AND on deselect — but when a SELECTION reshaped the
  // tree, keep the user's zoom and just pan the clicked block to the middle:
  // fitting the whole exploded reveal would yank them out to a full overview.
  const selCenter = useMemo(() => {
    if (!selected || !layout) return null;
    const it = layout.items.get(selected);
    if (!it) return null;
    const full = it.kind === 'full' || (!layout.edges && it.lvl === layout.openPath.length);
    return {
      x: MARGIN_X + it.x + it.w / 2,
      y: TOP_PAD + 26 + it.lvl * (CTX_H + GAP_Y) + it.row * (BLOCK_H + ROW_GAP_Y) + (full ? BLOCK_H : CTX_H) / 2,
    };
  }, [selected, layout]);
  const selCenterRef = useRef(selCenter);
  selCenterRef.current = selCenter;
  // openPath.length disambiguates [] from [''] — both join to '' — so opening
  // the TOP block still re-homes the view.
  const chainKey = (layout ? `${layout.openPath.length}:${layout.openPath.join('|')}` : '') + '::' + (revealTargets?.join('|') ?? '');
  useEffect(() => {
    const c = selCenterRef.current;
    const el = wrapRef.current;
    if (c && el && el.clientWidth) {
      const { k } = view.current;
      view.current = { x: el.clientWidth / 2 - c.x * k, y: el.clientHeight / 2 - c.y * k, k };
      applyView();
    } else {
      fitView();
    }
  }, [model, chainKey, fitView]);

  // Native wheel listener: React's synthetic onWheel is passive, and ctrl+
  // wheel (pinch) must preventDefault or the BROWSER zooms the whole page.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.002));
      } else {
        view.current = { ...view.current, x: view.current.x - e.deltaX, y: view.current.y - e.deltaY };
        applyView();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // "F" key → center & fit, same convention as the schematic canvas.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'f' && e.key !== 'F') return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      fitView();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitView]);

  if (!model || !layout) return null;

  const railCount = layout.rails.length;
  const frontier = layout.openPath.length;      // single-chain: rails above this are context
  // The reveal layout opens multiple branches, so a rail's render class can't
  // be read off `frontier` — it comes from each item's `kind`. A rail is "full"
  // (tall band, bright) when any full-size card lives on it.
  const revealMode = !!layout.edges;
  const levelFull = (lvl: number) =>
    revealMode ? (layout.rails[lvl]?.some(p => layout.items.get(p)?.kind === 'full') ?? false) : lvl === frontier;
  const svgW = MARGIN_X * 2 + Math.max(1, layout.width);
  // Top-anchored vertical rhythm: context bands are short, full bands taller
  // (and may stack several rows in the single-chain frontier).
  const rowsAt = (lvl: number) => layout.rowsAt[lvl] ?? 1;
  const itemH = (it: RailItem) => (it.kind === 'full' || (!revealMode && it.lvl === frontier) ? BLOCK_H : CTX_H);
  const bandH = (lvl: number) =>
    levelFull(lvl) ? rowsAt(lvl) * BLOCK_H + (rowsAt(lvl) - 1) * ROW_GAP_Y : CTX_H;
  const blockTop = (lvl: number) => TOP_PAD + 26 + lvl * (CTX_H + GAP_Y);
  const railLine = (lvl: number) => blockTop(lvl) + bandH(lvl);
  const svgH = railLine(railCount - 1) + 46;
  dims.current = { w: svgW, h: svgH };
  const item = (p: string) => layout.items.get(p)!;
  const itemY = (p: string) => {
    const it = item(p);
    return blockTop(it.lvl) + it.row * (BLOCK_H + ROW_GAP_Y);
  };
  const cx = (p: string) => MARGIN_X + item(p).x + item(p).w / 2;
  const midY = (p: string) => itemY(p) + itemH(item(p)) / 2;
  const openNodes = new Set(layout.openPath);
  const marks = new Set([...traceMarks, ...pathReps.filter(p => !pathOn.has(p))]);
  const supplyDomains = new Set(model.supplyDomains);

  // per-rail net totals honoring the same filters as the footer
  const netsAt = (i: number) => layout.rails[i].reduce((a, p) => {
    const b = model.blocks.get(p)!;
    return passesFilters(b, funcOff, supplyOff, supplyDomains) ? a + b.netCount : a;
  }, 0);
  const netLabel = (i: number) => (i === 0 ? model.blocks.get('')!.label : `${netsAt(i)} net ±`);

  return (
    // Same canvas surface as the layout viewer (.layout-canvas-wrap): a faint
    // 24px dot grid so the two "canvas" homes read as siblings. The svg is a
    // free canvas: drag anywhere to pan, ctrl/pinch wheel to zoom — a
    // transform moves it, no scrollbars. A >6px move flags the gesture and
    // the click that follows a drag is swallowed in capture phase so panning
    // never selects/deselects blocks. Double-click empty canvas / F / the ⊡
    // button = center & fit.
    <div ref={wrapRef}
         style={{ flex: 1, overflow: 'hidden', position: 'relative', cursor: 'grab',
                  background: 'radial-gradient(circle at 1px 1px, #1a2029 1px, transparent 0)',
                  backgroundSize: '24px 24px', backgroundColor: '#0a0d12' }}
         onPointerDown={e => {
           if (e.button !== 0) return;
           drag.current = { x: e.clientX, y: e.clientY, px: view.current.x, py: view.current.y, moved: false };
         }}
         onPointerMove={e => {
           const d = drag.current, el = wrapRef.current;
           if (!d || !el || e.buttons !== 1) return;
           const dx = e.clientX - d.x, dy = e.clientY - d.y;
           if (!d.moved && Math.abs(dx) + Math.abs(dy) > 6) {
             d.moved = true;
             el.setPointerCapture(e.pointerId);
             el.style.cursor = 'grabbing';
           }
           if (d.moved) { view.current = { ...view.current, x: d.px + dx, y: d.py + dy }; applyView(); }
         }}
         onPointerUp={() => { if (wrapRef.current) wrapRef.current.style.cursor = 'grab'; }}
         onClickCapture={e => {
           if (drag.current?.moved) { e.stopPropagation(); e.preventDefault(); }
           drag.current = null;
         }}
         onClick={() => select(null)}
         onDoubleClick={fitView}>
      {/* userSelect none: a double-click must open the block, not select its label text */}
      <svg ref={svgRef} width={svgW} height={svgH}
           style={{ display: 'block', position: 'absolute', left: 0, top: 0, transformOrigin: '0 0',
                    fontFamily: T.mono, userSelect: 'none', willChange: 'transform' }}>
        {Array.from({ length: railCount }, (_, i) => (
          <g key={i} opacity={levelFull(i) ? 1 : 0.55}>
            <line x1={16} y1={railLine(i)} x2={svgW - 16} y2={railLine(i)} stroke={T.rail} strokeWidth={1.4} />
            <text x={18} y={blockTop(i) - 10} fontSize={levelFull(i) ? 11 : 9.5} fill={T.muted} fontStyle="italic">
              {netLabel(i)}
            </text>
            {(layout.hidden[i] ?? 0) > 0 && (
              <text x={18} y={blockTop(i) + 3} fontSize={8.5} fill={T.faint} fontStyle="italic">
                {layout.hidden[i]} devices hidden
              </text>
            )}
          </g>
        ))}
        {/* spine: each open block fans out to the full boxes on the first row
            of the rail below it — slivers sit on the rail without edges;
            stacked rows 2+ get one feeder line each along the right lane.
            Context-to-context edges fade with their rails; the fan into the
            frontier stays full-strength. */}
        {!revealMode && layout.rails.map((rail, i) => {
          if (i === 0) return null;
          const x1 = cx(layout.openPath[i - 1]), y1 = railLine(i - 1);
          const my = y1 + (blockTop(i) - y1) * 0.55;
          return (
            <g key={`edges-${i}`} opacity={i === frontier ? 1 : 0.8}>
              {rail.filter(p => { const it = layout.items.get(p); return it && !it.sliver && it.row === 0; }).map(p => {
                const x2 = cx(p), y2 = blockTop(i);
                return <path key={p} d={`M ${x1} ${y1} V ${my} H ${x2} V ${y2}`}
                             fill="none" stroke={T.edge} strokeWidth={2} />;
              })}
              {Array.from({ length: rowsAt(i) - 1 }, (_, ri) => {
                const r = ri + 1;
                const rowItems = [...layout.items.values()].filter(it => it.lvl === i && it.row === r);
                if (rowItems.length === 0) return null;
                const rowMaxX = Math.max(...rowItems.map(it => MARGIN_X + it.x + it.w));
                const rowCy = blockTop(i) + r * (BLOCK_H + ROW_GAP_Y) + BLOCK_H / 2;
                return <path key={`feeder-${r}`}
                             d={`M ${x1} ${y1} V ${my} H ${svgW - 30} V ${rowCy} H ${rowMaxX + 8}`}
                             fill="none" stroke={T.edge} strokeWidth={2} />;
              })}
            </g>
          );
        })}
        {/* the descent itself: open-chain spine segments redrawn full-strength
            over the faded context fans — the middle-of-the-tree descent line
            must never fade with its rail */}
        {!revealMode && layout.openPath.map((p, i) => {
          if (i === 0) return null;
          return <line key={`spine-${i}`} x1={cx(layout.openPath[i - 1])} y1={railLine(i - 1)}
                       x2={cx(p)} y2={itemY(p)} stroke={T.spine} strokeWidth={2.6} opacity={0.95} />;
        })}
        {!revealMode && layout.openPath.length > 0 && frontier < railCount && (
          <line x1={cx(layout.openPath[frontier - 1])} y1={railLine(frontier - 1)}
                x2={cx(layout.openPath[frontier - 1])}
                y2={railLine(frontier - 1) + (blockTop(frontier) - railLine(frontier - 1)) * 0.55}
                stroke={T.spine} strokeWidth={2.6} opacity={0.95} />
        )}
        {/* reveal edges: every shown parent → child link. The two branches on
            the path to the selection are drawn brighter (spine colour). */}
        {revealMode && layout.edges!.map(([pa, ch], i) => {
          const ap = layout.items.get(pa), cp = layout.items.get(ch);
          if (!ap || !cp) return null;
          const x1 = cx(pa), y1 = itemY(pa) + itemH(ap);
          const x2 = cx(ch), y2 = itemY(ch);
          const my = y1 + (y2 - y1) * 0.5;
          const onSel = pa === selected || ch === selected;
          return <path key={`re-${i}`} d={`M ${x1} ${y1} V ${my} H ${x2} V ${y2}`} fill="none"
                       stroke={onSel ? T.spine : T.edge} strokeWidth={onSel ? 2.4 : 1.8} opacity={0.9} />;
        })}
        {pathReps.length > 1 && (
          <path d={pathReps.map((p, i) => `${i ? 'L' : 'M'} ${cx(p)} ${midY(p)}`).join(' ')}
                fill="none" stroke={T.path} strokeWidth={2.6} strokeDasharray="7 5" strokeLinejoin="round" opacity={0.95} />
        )}
        {/* "+N" stubs: siblings truncated off a context rail — the tree panel
            still lists them; the stub just keeps the count honest. */}
        {layout.stubs.map((st, i) => (
          <g key={`stub-${i}`} opacity={CTX_SLIVER_OPACITY}>
            <title>{`${st.count} more sibling blocks — see the hierarchy tree`}</title>
            <rect x={MARGIN_X + st.x} y={blockTop(st.lvl)} width={st.w} height={CTX_H} rx={4}
                  fill="none" stroke={T.faint} strokeWidth={1.2} strokeDasharray="3 3" />
            <text transform={`rotate(90 ${MARGIN_X + st.x + st.w / 2} ${blockTop(st.lvl) + CTX_H / 2})`}
                  x={MARGIN_X + st.x + st.w / 2} y={blockTop(st.lvl) + CTX_H / 2 + 3}
                  fontSize={8} fill={T.muted} textAnchor="middle">
              +{fmtCount(st.count)}
            </text>
          </g>
        ))}
        {[...layout.items.values()].map(it => {
          const b = model.blocks.get(it.path)!;
          const h = itemH(it);
          const x = MARGIN_X + it.x, y = itemY(it.path), w = it.w;
          // Reveal layout tags each item; single-chain derives class from the
          // frontier. Both drive the same three render branches below.
          const kind = it.kind ?? (it.sliver ? 'sliver' : it.lvl < frontier ? 'context' : 'full');
          const ctx = kind === 'context';
          const isSel = selected === it.path;
          const isOpen = openNodes.has(it.path);
          const dim = !passesFilters(b, funcOff, supplyOff, supplyDomains);
          const accent = zoneColors && b.category && b.category !== UNCLASSIFIED
            ? T.groupColors[b.category.split(':')[0]] : T.unclass;
          const traced = trace?.blocks.has(it.path) || pathOn.has(it.path);
          const contains = !traced && marks.has(it.path);
          // One-shot halo (index.css .hy-ping): yellow on the selection, violet
          // on a connected block. It mounts when a block first becomes a target,
          // so every new selection flashes its selection + its neighbors.
          const ping = isSel ? T.sel : traced ? T.conn : null;
          // faded context, full-strength frontier; anything selected/traced
          // pops back up so overlays stay readable in the faded zone
          const base = kind === 'full' ? 1 : kind === 'sliver' ? CTX_SLIVER_OPACITY : CTX_CARD_OPACITY;
          const gOpacity = dim ? T.dim : isSel || traced || contains ? Math.max(base, 0.9) : base;
          const title =
            `${b.label} (${b.master})` +
            (b.members ? ` — group of ${b.members.length}` : '') +
            (b.children.length === 0 ? ' — leaf block' : isOpen ? ' — open' : '') +
            ` — ${fmtCount(b.devices)} dev · ${fmtCount(b.netCount)} net` +
            (contains ? ' — connected blocks inside' : '');
          // ×N groups (bus arrays and master stacks) read as a literal stack
          // of cards: two ghost cards peeking out behind the front one.
          const deck = b.members && !it.sliver && (
            <>
              <rect x={x + 8} y={y + 8} width={w} height={h} rx={ctx ? 6 : 7} fill={T.card} stroke={accent} strokeWidth={1} opacity={0.25} />
              <rect x={x + 4} y={y + 4} width={w} height={h} rx={ctx ? 6 : 7} fill={T.card} stroke={accent} strokeWidth={1} opacity={0.45} />
            </>
          );
          if (it.sliver) {
            return (
              <g key={it.path} opacity={gOpacity} style={{ cursor: 'pointer' }}
                 onClick={e => { e.stopPropagation(); select(isSel ? null : it.path); }}
                 onDoubleClick={e => { e.stopPropagation(); if (b.children.length) toggleOpen(it.path); else select(it.path); }}>
                <title>{title}</title>
                {traced && <rect x={x - 2.5} y={y - 2.5} width={w + 5} height={h + 5} rx={6}
                                 fill="none" stroke={T.conn} strokeWidth={2} />}
                {contains && <rect x={x - 2.5} y={y - 2.5} width={w + 5} height={h + 5} rx={6}
                                   fill="none" stroke={T.conn} strokeWidth={1.6} strokeDasharray="4 3" />}
                {ping && <rect key={`hy-ping-${selected}`} className="hy-ping" x={x - 2.5} y={y - 2.5} width={w + 5} height={h + 5} rx={6} stroke={ping} strokeWidth={2} />}
                <rect x={x} y={y} width={w} height={h} rx={4} fill={T.card}
                      stroke={isSel ? T.sel : accent} strokeWidth={isSel ? 2.2 : 1.2} />
                <rect x={x} y={y} width={w} height={4} rx={2} fill={accent} />
                <text transform={`rotate(90 ${x + w / 2} ${y + h / 2})`}
                      x={x + w / 2} y={y + h / 2 + 3} fontSize={7.5} fill={T.muted} textAnchor="middle">
                  {clip(b.label, 6)}
                </text>
              </g>
            );
          }
          if (ctx) {
            // compressed open-ancestor card: names only, no stats/chevron —
            // it is the breadcrumb on canvas, not the content
            const labelChars = Math.floor((w - 18) / 5.8);
            const masterChars = Math.floor((w - 18) / 4.9);
            return (
              <g key={it.path} opacity={gOpacity} style={{ cursor: 'pointer' }}
                 onClick={e => { e.stopPropagation(); select(isSel ? null : it.path); }}
                 onDoubleClick={e => { e.stopPropagation(); toggleOpen(it.path); }}>
                <title>{title}</title>
                {traced && <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6} rx={8}
                                 fill="none" stroke={T.conn} strokeWidth={2.2} />}
                {contains && <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6} rx={8}
                                   fill="none" stroke={T.conn} strokeWidth={1.6} strokeDasharray="5 4" />}
                {ping && <rect key={`hy-ping-${selected}`} className="hy-ping" x={x - 3} y={y - 3} width={w + 6} height={h + 6} rx={8} stroke={ping} strokeWidth={2.2} />}
                {deck}
                <rect x={x} y={y} width={w} height={h} rx={6} fill={T.card}
                      stroke={isSel ? T.sel : accent} strokeWidth={isSel ? 2.4 : 1.8} />
                <rect x={x} y={y} width={5} height={h} rx={2.5} fill={accent} />
                <text x={x + w / 2 + 2} y={y + 16} fontSize={9.5} fontWeight={700} fill={T.text} textAnchor="middle">
                  {clip(b.label, labelChars)}
                </text>
                <text x={x + w / 2 + 2} y={y + 30} fontSize={8} fill={T.muted} textAnchor="middle">
                  {clip(b.master, masterChars)}
                </text>
                {b.members && (() => {
                  const t = `×${fmtCount(b.members.length)}`;
                  const bw = t.length * 5.5 + 8;
                  return (
                    <g style={{ cursor: 'pointer' }}
                       onClick={e => { e.stopPropagation(); toggleGroup(it.path); }}
                       onDoubleClick={e => e.stopPropagation()}>
                      <title>{`expand ${b.members.length} grouped instances`}</title>
                      <rect x={x + w - bw - 3} y={y - 7} width={bw} height={13} rx={6.5} fill={T.accent} />
                      <text x={x + w - bw / 2 - 3} y={y + 3} fontSize={8.5} fontWeight={700} fill={T.bg} textAnchor="middle">{t}</text>
                    </g>
                  );
                })()}
                {b.groupOf && model.blocks.get(b.groupOf)?.expanded && (() => {
                  // an OPEN member of an expanded group must keep its
                  // fold-back affordance even as a compressed context card
                  const gb = model.blocks.get(b.groupOf)!;
                  const bw = 16;
                  return (
                    <g style={{ cursor: 'pointer' }}
                       onClick={e => { e.stopPropagation(); toggleGroup(b.groupOf!); }}
                       onDoubleClick={e => e.stopPropagation()}>
                      <title>{`collapse back to ${gb.label} (×${gb.members!.length})`}</title>
                      <rect x={x + w - bw - 3} y={y - 7} width={bw} height={13} rx={6.5}
                            fill={T.panel2} stroke={T.accent} strokeWidth={1.2} />
                      <text x={x + w - bw / 2 - 3} y={y + 3} fontSize={9} fontWeight={700} fill={T.accent} textAnchor="middle">×</text>
                    </g>
                  );
                })()}
              </g>
            );
          }
          const labelChars = Math.floor((w - 22) / 6.7);
          const masterChars = Math.floor((w - 22) / 5.4);
          return (
            <g key={it.path} opacity={gOpacity} style={{ cursor: 'pointer' }}
               onClick={e => { e.stopPropagation(); select(isSel ? null : it.path); }}
               // leaves can't open — re-select so a double-click doesn't
               // click-toggle the selection away
               onDoubleClick={e => { e.stopPropagation(); if (b.children.length) toggleOpen(it.path); else select(it.path); }}>
              <title>{title}</title>
              {traced && <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} rx={10}
                               fill="none" stroke={T.conn} strokeWidth={2.5} />}
              {contains && <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} rx={10}
                                 fill="none" stroke={T.conn} strokeWidth={1.8} strokeDasharray="5 4" />}
              {ping && <rect key={`hy-ping-${selected}`} className="hy-ping" x={x - 4} y={y - 4} width={w + 8} height={h + 8} rx={10} stroke={ping} strokeWidth={2.5} />}
              {deck}
              <rect x={x} y={y} width={w} height={h} rx={7} fill={T.card}
                    stroke={isSel ? T.sel : accent} strokeWidth={isSel ? 2.6 : isOpen ? 2.2 : 1.5} />
              <rect x={x} y={y} width={7} height={h} rx={3} fill={accent} />
              {/* instance name + master cell name inside the box */}
              <text x={x + w / 2 + 3} y={y + 17} fontSize={11} fontWeight={700} fill={T.text} textAnchor="middle">
                {clip(b.label, labelChars)}
              </text>
              <text x={x + w / 2 + 3} y={y + 31} fontSize={9} fill={T.muted} textAnchor="middle">
                {clip(b.master, masterChars)}
              </text>
              <text x={x + w / 2 + 3} y={y + 44} fontSize={8} fill={T.faint} textAnchor="middle">
                {fmtCount(b.devices)} dev · {fmtCount(b.netCount)} net
              </text>
              {b.children.length > 0 && (
                <text x={x + w / 2 + 3} y={y + h - 3} fontSize={8}
                      fill={isOpen ? T.accent : T.faint} textAnchor="middle">
                  {isOpen ? '▾' : '▸'}
                </text>
              )}
              {b.members && (() => {
                // "×N" collapsed-group chip, same language as the schematic's
                // array badge (accent pill, dark text). Kept inside the card's
                // right edge so it can't overlap the neighboring block.
                // Clicking it pops the group open into its individual members.
                const t = `×${fmtCount(b.members.length)}`;
                const bw = t.length * 5.5 + 8;
                return (
                  <g style={{ cursor: 'pointer' }}
                     onClick={e => { e.stopPropagation(); toggleGroup(it.path); }}
                     onDoubleClick={e => e.stopPropagation()}>
                    <title>{`expand ${b.members.length} grouped instances`}</title>
                    <rect x={x + w - bw - 3} y={y - 7} width={bw} height={13} rx={6.5} fill={T.accent} />
                    <text x={x + w - bw / 2 - 3} y={y + 3} fontSize={8.5} fontWeight={700} fill={T.bg} textAnchor="middle">{t}</text>
                  </g>
                );
              })()}
              {b.groupOf && model.blocks.get(b.groupOf)?.expanded && (() => {
                // Expanded group member: outline chip folds the family back
                // into its ×N group.
                const gb = model.blocks.get(b.groupOf)!;
                const bw = 16;
                return (
                  <g style={{ cursor: 'pointer' }}
                     onClick={e => { e.stopPropagation(); toggleGroup(b.groupOf!); }}
                     onDoubleClick={e => e.stopPropagation()}>
                    <title>{`collapse back to ${gb.label} (×${gb.members!.length})`}</title>
                    <rect x={x + w - bw - 3} y={y - 7} width={bw} height={13} rx={6.5}
                          fill={T.panel2} stroke={T.accent} strokeWidth={1.2} />
                    <text x={x + w - bw / 2 - 3} y={y + 3} fontSize={9} fontWeight={700} fill={T.accent} textAnchor="middle">×</text>
                  </g>
                );
              })()}
            </g>
          );
        })}
        {railCount === 1 && (
          <text x={cx('')} y={railLine(0) + 24} fontSize={10.5} fill={T.faint} fontStyle="italic" textAnchor="middle">
            double-click a block to open what is underneath it
          </text>
        )}
        {pathResult && (pathEnds ?? []).map((pe, i) => {
          const rp = visible.has(pe.block) ? pe.block : visibleAncestor(model, visible, pe.block);
          if (rp === undefined) return null;
          const x = cx(rp), y = itemY(rp) - 12;
          return (
            <g key={i}>
              <path d={`M ${x} ${y - 6} L ${x + 6} ${y} L ${x} ${y + 6} L ${x - 6} ${y} Z`} fill={i ? T.blue : T.path} />
              <text x={x + 10} y={y + 3} fontSize={9} fill={T.text}>{pe.pin}</text>
            </g>
          );
        })}
        {/* device-connection fly-lines: the selection curves out to each of its
            neighbors, labelled by the net they share — the "connected to" story
            drawn on the canvas. */}
        {revealMode && selected && trace && visible.has(selected) && (() => {
          const sx = cx(selected), sy = midY(selected);
          return [...trace.blocks].map(nb => {
            if (!visible.has(nb)) return null;
            const nx = cx(nb), ny = midY(nb);
            const sameRow = Math.abs(sy - ny) < 1;
            const mx = (sx + nx) / 2;
            const cyy = (sy + ny) / 2 + (sameRow ? 34 + Math.min(46, Math.abs(sx - nx) * 0.05) : 0);
            const label = trace.netOf.get(nb) ?? '';
            return (
              <g key={`fly-${nb}`}>
                <path d={`M ${sx} ${sy} Q ${mx} ${cyy} ${nx} ${ny}`} fill="none"
                      stroke={T.conn} strokeWidth={1.8} opacity={0.7} />
                {label && (
                  <text x={mx} y={cyy - 4} fontSize={8} fill={T.conn} textAnchor="middle"
                        stroke={T.bg} strokeWidth={3} paintOrder="stroke">
                    {clip(label, 16)}
                  </text>
                )}
              </g>
            );
          });
        })()}
        {selected && visible.has(selected) && neighbors.length > 0 && (() => {
          const maxTotal = Math.max(...neighbors.map(n => n.total), Number.EPSILON);
          const sx = cx(selected), sy = midY(selected);
          return neighbors.map(n => {
            if (!visible.has(n.block)) return null;
            const nx = cx(n.block), ny = midY(n.block);
            // same-rail pairs bow below the rail so the line doesn't strike
            // through the block cards sitting between them
            const bow = sy === ny ? 30 + Math.min(46, Math.abs(sx - nx) * 0.05) : 0;
            const mx = (sx + nx) / 2, cy = (sy + ny) / 2 + bow * 2;
            const labelY = (sy + ny + 2 * cy) / 4 - 5; // above the curve midpoint
            return (
              <g key={n.block}>
                <path d={`M ${sx} ${sy} Q ${mx} ${cy} ${nx} ${ny}`} fill="none" stroke={T.coupling}
                      strokeWidth={1 + 5 * (n.total / maxTotal)} opacity={0.7} />
                <text x={mx} y={labelY} fontSize={8} fill={T.muted} textAnchor="middle"
                      stroke="#0a0d12" strokeWidth={3} paintOrder="stroke">
                  {`${(n.total * 1e15).toFixed(1)} fF`}
                </text>
              </g>
            );
          });
        })()}
      </svg>
      {/* view controls: zoom ± and center-&-fit, clear of the right overlay
          rail. Same .fit-btn language as the schematic canvas. */}
      <div style={{ position: 'absolute', top: 12, right: 288, display: 'flex', gap: 6, zIndex: 20 }}
           onPointerDown={e => e.stopPropagation()}
           onDoubleClick={e => e.stopPropagation()}>
        <button className="fit-btn" style={{ position: 'static' }} title="Zoom out"
                onClick={e => { e.stopPropagation(); zoomStep(0.8); }}>−</button>
        <button className="fit-btn" style={{ position: 'static' }} title="Zoom in"
                onClick={e => { e.stopPropagation(); zoomStep(1.25); }}>+</button>
        <button className="fit-btn" style={{ position: 'static' }} title="Center & fit (F)"
                onClick={e => { e.stopPropagation(); fitView(); }}>
          ⊡ Fit <kbd>F</kbd>
        </button>
      </div>
      {couplingBusy && (
        <div style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 20, pointerEvents: 'none',
                      background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8,
                      padding: '6px 12px', fontSize: 11.5, color: T.muted }}>
          computing coupling…
        </div>
      )}
    </div>
  );
}
