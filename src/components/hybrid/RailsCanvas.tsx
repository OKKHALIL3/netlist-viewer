import { useMemo, useRef } from 'react';
import { useHybridStore, passesFilters } from '../../store/hybridStore';
import { computeRails } from '../../hybrid/slots';
import { criticalityScores, criticalityOrder } from '../../hybrid/criticality';
import { UNCLASSIFIED } from '../../hybrid/classify';
import { couplingFor } from '../../hybrid/coupling';
import { displayPath, type HybridModel } from '../../hybrid/model';
import { T } from './theme';

const MARGIN_X = 70, LEVEL_H = 140, TOP_PAD = 46, BLOCK_H = 58;

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
    design, layoutData, model, openPath, selected, select, toggleOpen, toggleGroup, trace, funcOff, supplyOff,
    zoneColors, sizeByContent, weights, pathResult, pathEnds, coupling, couplingPairs, version,
  } = useHybridStore();
  // drag-to-pan bookkeeping (no re-renders — refs only)
  const wrapRef = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; sl: number; st: number; moved: boolean } | null>(null);
  const scores = useMemo(() => {
    void version; // reclassify()/toggleGroup() mutate the model in place
    return model ? criticalityScores(model, weights) : null;
  }, [model, weights, version]);
  const layout = useMemo(() => {
    void version; // toggleGroup() swaps children arrays in place
    if (!model || !scores) return null;
    // 128..180 clamp (log-normalized score ∈ [0,1]); uniform when sizing is off
    const fullW = (p: string) => (sizeByContent ? 128 + 52 * (scores.get(p) ?? 0) : 150);
    return computeRails(model, openPath, criticalityOrder(scores), fullW);
  }, [model, scores, openPath, sizeByContent, version]);
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
  const neighbors = useMemo(() => {
    if (!coupling.on || !selected || !couplingPairs || !layoutData || !design || !model || !layout) return [];
    return couplingFor(design, model, layoutData, couplingPairs, selected, [...layout.items.keys()], coupling.minC, coupling.includeSupply);
  }, [coupling, selected, couplingPairs, layoutData, design, model, layout]);
  if (!model || !layout) return null;

  const railCount = layout.rails.length;
  const svgW = MARGIN_X * 2 + Math.max(1, layout.width);
  const svgH = TOP_PAD + railCount * LEVEL_H + 30;
  const item = (p: string) => layout.items.get(p)!;
  const cx = (p: string) => MARGIN_X + item(p).x + item(p).w / 2;
  const railY = (lvl: number) => TOP_PAD + lvl * LEVEL_H + 70;
  const openNodes = new Set(layout.openPath);
  const marks = new Set([...traceMarks, ...pathReps.filter(p => !pathOn.has(p))]);

  // per-rail net totals honoring the same filters as the footer
  const netsAt = (i: number) => layout.rails[i].reduce((a, p) => {
    const b = model.blocks.get(p)!;
    return passesFilters(b, funcOff, supplyOff) ? a + b.netCount : a;
  }, 0);
  const netLabel = (i: number) => (i === 0 ? model.blocks.get('')!.label : `${netsAt(i)} net ±`);

  return (
    // Same canvas surface as the layout viewer (.layout-canvas-wrap): a faint
    // 24px dot grid so the two "canvas" homes read as siblings. Content is
    // centered while it fits ('safe' keeps it scrollable-from-zero once it
    // outgrows the viewport). Background click = deselect only.
    // Drag anywhere to pan (scrollbars stay as fallback): a >4px move flags
    // the gesture and the click that follows a drag is swallowed in capture
    // phase so panning never selects/deselects blocks.
    <div ref={wrapRef}
         style={{ flex: 1, overflow: 'auto', position: 'relative', cursor: 'grab',
                  display: 'flex', justifyContent: 'safe center', alignItems: 'flex-start',
                  background: 'radial-gradient(circle at 1px 1px, #1a2029 1px, transparent 0)',
                  backgroundSize: '24px 24px', backgroundColor: '#0a0d12' }}
         onPointerDown={e => {
           const el = wrapRef.current;
           if (e.button !== 0 || !el) return;
           pan.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop, moved: false };
         }}
         onPointerMove={e => {
           const p = pan.current, el = wrapRef.current;
           if (!p || !el || e.buttons !== 1) return;
           const dx = e.clientX - p.x, dy = e.clientY - p.y;
           if (!p.moved && Math.abs(dx) + Math.abs(dy) > 4) {
             p.moved = true;
             el.setPointerCapture(e.pointerId);
             el.style.cursor = 'grabbing';
           }
           if (p.moved) { el.scrollLeft = p.sl - dx; el.scrollTop = p.st - dy; }
         }}
         onPointerUp={() => { if (wrapRef.current) wrapRef.current.style.cursor = 'grab'; }}
         onClickCapture={e => {
           if (pan.current?.moved) { e.stopPropagation(); e.preventDefault(); }
           pan.current = null;
         }}
         onClick={() => select(null)}>
      {/* userSelect none: a double-click must open the block, not select its label text */}
      <svg width={svgW} height={svgH} style={{ display: 'block', flex: 'none', fontFamily: T.mono, userSelect: 'none' }}>
        {Array.from({ length: railCount }, (_, i) => (
          <g key={i}>
            <line x1={16} y1={railY(i)} x2={svgW - 16} y2={railY(i)} stroke={T.rail} strokeWidth={1.4} />
            <text x={18} y={railY(i) - BLOCK_H - 10} fontSize={11} fill={T.muted} fontStyle="italic">{netLabel(i)}</text>
          </g>
        ))}
        {/* spine: each open block fans out to the full boxes on the rail
            below it — slivers sit on the rail without edges */}
        {layout.rails.map((rail, i) => {
          if (i === 0) return null;
          const x1 = cx(layout.openPath[i - 1]), y1 = railY(i - 1);
          return (
            <g key={`edges-${i}`}>
              {rail.filter(p => !item(p).sliver).map(p => {
                const x2 = cx(p), y2 = railY(i) - BLOCK_H;
                const my = y1 + (y2 - y1) * 0.55;
                return <path key={p} d={`M ${x1} ${y1} V ${my} H ${x2} V ${y2}`}
                             fill="none" stroke={T.edge} strokeWidth={1.2} />;
              })}
            </g>
          );
        })}
        {pathReps.length > 1 && (
          <path d={pathReps.map((p, i) => `${i ? 'L' : 'M'} ${cx(p)} ${railY(item(p).lvl) - BLOCK_H / 2}`).join(' ')}
                fill="none" stroke={T.path} strokeWidth={2.6} strokeDasharray="7 5" strokeLinejoin="round" opacity={0.95} />
        )}
        {[...layout.items.values()].map(it => {
          const b = model.blocks.get(it.path)!;
          const x = MARGIN_X + it.x, y = railY(it.lvl) - BLOCK_H, w = it.w;
          const isSel = selected === it.path;
          const isOpen = openNodes.has(it.path);
          const dim = !passesFilters(b, funcOff, supplyOff);
          const accent = zoneColors && b.category && b.category !== UNCLASSIFIED
            ? T.groupColors[b.category.split(':')[0]] : T.unclass;
          const traced = trace?.blocks.has(it.path) || pathOn.has(it.path);
          const contains = !traced && marks.has(it.path);
          const title =
            `${b.label} (${b.master})` +
            (b.members ? ` — array of ${b.members.length}` : '') +
            (b.children.length === 0 ? ' — leaf block' : isOpen ? ' — open' : '') +
            ` — ${fmtCount(b.devices)} dev · ${fmtCount(b.netCount)} net` +
            (contains ? ' — connected blocks inside' : '');
          if (it.sliver) {
            return (
              <g key={it.path} opacity={dim ? T.dim : 1} style={{ cursor: 'pointer' }}
                 onClick={e => { e.stopPropagation(); select(isSel ? null : it.path); }}
                 onDoubleClick={e => { e.stopPropagation(); if (b.children.length) toggleOpen(it.path); else select(it.path); }}>
                <title>{title}</title>
                {traced && <rect x={x - 2.5} y={y - 2.5} width={w + 5} height={BLOCK_H + 5} rx={6}
                                 fill="none" stroke={T.conn} strokeWidth={2} />}
                {contains && <rect x={x - 2.5} y={y - 2.5} width={w + 5} height={BLOCK_H + 5} rx={6}
                                   fill="none" stroke={T.conn} strokeWidth={1.6} strokeDasharray="4 3" />}
                <rect x={x} y={y} width={w} height={BLOCK_H} rx={4} fill={T.card}
                      stroke={isSel ? T.sel : accent} strokeWidth={isSel ? 2.2 : 1.2} />
                <rect x={x} y={y} width={w} height={5} rx={2} fill={accent} />
                <text transform={`rotate(90 ${x + w / 2} ${y + BLOCK_H / 2})`}
                      x={x + w / 2} y={y + BLOCK_H / 2 + 3} fontSize={8} fill={T.muted} textAnchor="middle">
                  {clip(b.label, 9)}
                </text>
              </g>
            );
          }
          const labelChars = Math.floor((w - 22) / 6.7);
          const masterChars = Math.floor((w - 22) / 5.4);
          return (
            <g key={it.path} opacity={dim ? T.dim : 1} style={{ cursor: 'pointer' }}
               onClick={e => { e.stopPropagation(); select(isSel ? null : it.path); }}
               // leaves can't open — re-select so a double-click doesn't
               // click-toggle the selection away
               onDoubleClick={e => { e.stopPropagation(); if (b.children.length) toggleOpen(it.path); else select(it.path); }}>
              <title>{title}</title>
              {traced && <rect x={x - 4} y={y - 4} width={w + 8} height={BLOCK_H + 8} rx={10}
                               fill="none" stroke={T.conn} strokeWidth={2.5} />}
              {contains && <rect x={x - 4} y={y - 4} width={w + 8} height={BLOCK_H + 8} rx={10}
                                 fill="none" stroke={T.conn} strokeWidth={1.8} strokeDasharray="5 4" />}
              <rect x={x} y={y} width={w} height={BLOCK_H} rx={7} fill={T.card}
                    stroke={isSel ? T.sel : accent} strokeWidth={isSel ? 2.6 : isOpen ? 2.2 : 1.5} />
              <rect x={x} y={y} width={7} height={BLOCK_H} rx={3} fill={accent} />
              {/* instance name + master cell name IN the box (Amr round 3) */}
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
                <text x={x + w / 2 + 3} y={y + BLOCK_H - 3} fontSize={8}
                      fill={isOpen ? T.accent : T.faint} textAnchor="middle">
                  {isOpen ? '▾' : '▸'}
                </text>
              )}
              {b.members && (() => {
                // "×N" collapsed-array chip, same language as the schematic's
                // array badge (accent pill, dark text). Kept inside the card's
                // right edge so it can't overlap the neighboring block.
                // Clicking it pops the group open into its individual members.
                const t = `×${fmtCount(b.members.length)}`;
                const bw = t.length * 5.5 + 8;
                return (
                  <g style={{ cursor: 'pointer' }}
                     onClick={e => { e.stopPropagation(); toggleGroup(it.path); }}
                     onDoubleClick={e => e.stopPropagation()}>
                    <title>{`expand ${b.members.length} array elements`}</title>
                    <rect x={x + w - bw - 3} y={y - 7} width={bw} height={13} rx={6.5} fill={T.accent} />
                    <text x={x + w - bw / 2 - 3} y={y + 3} fontSize={8.5} fontWeight={700} fill={T.bg} textAnchor="middle">{t}</text>
                  </g>
                );
              })()}
              {b.groupOf && model.blocks.get(b.groupOf)?.expanded && (() => {
                // Expanded array member: outline chip folds the family back
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
          <text x={cx('')} y={railY(0) + 24} fontSize={10.5} fill={T.faint} fontStyle="italic" textAnchor="middle">
            double-click a block to open what is underneath it
          </text>
        )}
        {pathResult && (pathEnds ?? []).map((pe, i) => {
          const rp = visible.has(pe.block) ? pe.block : visibleAncestor(model, visible, pe.block);
          if (rp === undefined) return null;
          const x = cx(rp), y = railY(item(rp).lvl) - BLOCK_H - 12;
          return (
            <g key={i}>
              <path d={`M ${x} ${y - 6} L ${x + 6} ${y} L ${x} ${y + 6} L ${x - 6} ${y} Z`} fill={i ? T.blue : T.path} />
              <text x={x + 10} y={y + 3} fontSize={9} fill={T.text}>{pe.pin}</text>
            </g>
          );
        })}
        {selected && visible.has(selected) && neighbors.length > 0 && (() => {
          const maxTotal = Math.max(...neighbors.map(n => n.total), Number.EPSILON);
          const sx = cx(selected), sy = railY(item(selected).lvl) - BLOCK_H / 2;
          return neighbors.map(n => {
            if (!visible.has(n.block)) return null;
            const nx = cx(n.block), ny = railY(item(n.block).lvl) - BLOCK_H / 2;
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
    </div>
  );
}
