import { useMemo } from 'react';
import { useHybridStore, passesFilters } from '../../store/hybridStore';
import { computeSlots } from '../../hybrid/slots';
import { criticalityScores, criticalityOrder } from '../../hybrid/criticality';
import { UNCLASSIFIED } from '../../hybrid/classify';
import { couplingFor } from '../../hybrid/coupling';
import { displayPath, subtreeDepth } from '../../hybrid/model';
import { T } from './theme';

const SLOT_W = 112, MARGIN_X = 70, LEVEL_H = 118, TOP_PAD = 46, BLOCK_H = 34;

// Counts on the tiny block cards: keep them within the card at any magnitude.
const fmtCount = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` :
  n >= 1e4 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k` : String(n);

export function RailsCanvas() {
  const {
    design, layoutData, model, rootPath, depth, selected, select, drillDown, trace, funcOff, supplyOff,
    zoneColors, sizeByContent, weights, pathResult, pathEnds, coupling, couplingPairs,
  } = useHybridStore();
  const scores = useMemo(() => (model ? criticalityScores(model, weights) : null), [model, weights]);
  const layout = useMemo(
    () => (model && scores ? computeSlots(model, rootPath, depth, criticalityOrder(scores)) : null),
    [model, scores, rootPath, depth],
  );
  const neighbors = useMemo(() => {
    if (!coupling.on || !selected || !couplingPairs || !layoutData || !design || !model || !layout) return [];
    return couplingFor(design, model, layoutData, couplingPairs, selected, [...layout.slot.keys()], coupling.minC, coupling.includeSupply);
  }, [coupling, selected, couplingPairs, layoutData, design, model, layout]);
  if (!model || !layout) return null;
  const blockW = (p: string) => (sizeByContent ? 60 + 44 * (scores!.get(p) ?? 0) : 86); // 60..104 clamp, uniform when off

  const rootDepth = model.blocks.get(rootPath)!.depth;
  const visible = [...layout.slot.keys()].map(p => model.blocks.get(p)!);
  // rails sized to the CURRENT subtree, not the design-wide maxDepth — a
  // shallow macro inside a deep design must not draw empty rails below itself
  const railCount = Math.min(depth, subtreeDepth(model, rootPath)) + 1;
  const svgW = MARGIN_X * 2 + Math.max(1, layout.width) * SLOT_W;
  const svgH = TOP_PAD + railCount * LEVEL_H + 30;
  const cx = (p: string) => MARGIN_X + (layout.slot.get(p)! + 0.5) * SLOT_W;
  const railY = (lvl: number) => TOP_PAD + lvl * LEVEL_H + 70;
  const lvl = (b: { depth: number }) => b.depth - rootDepth;
  // per-rail net totals for the CURRENT view, honoring the same filters as the
  // footer (design-wide levelNetCounts would overstate after a drill-down)
  const netsAtLvl = new Map<number, number>();
  for (const b of visible) {
    if (!passesFilters(b, funcOff, supplyOff)) continue;
    netsAtLvl.set(lvl(b), (netsAtLvl.get(lvl(b)) ?? 0) + b.netCount);
  }
  const netLabel = (i: number) =>
    i === 0 ? model.blocks.get(rootPath)!.label : `${netsAtLvl.get(i) ?? 0} net ±`;

  return (
    // Same canvas surface as the layout viewer (.layout-canvas-wrap): a faint
    // 24px dot grid so the two "canvas" homes read as siblings.
    <div style={{ flex: 1, overflow: 'auto', position: 'relative',
                  background: 'radial-gradient(circle at 1px 1px, #1a2029 1px, transparent 0)',
                  backgroundSize: '24px 24px', backgroundColor: '#0a0d12' }}>
      {/* background click = deselect only — typed path pins survive the glance */}
      <svg width={svgW} height={svgH} style={{ display: 'block', minWidth: '100%', fontFamily: T.mono }}
           onClick={() => select(null)}>
        {Array.from({ length: railCount }, (_, i) => (
          <g key={i}>
            <line x1={16} y1={railY(i)} x2={svgW - 16} y2={railY(i)} stroke={T.rail} strokeWidth={1.4} />
            <text x={18} y={railY(i) - 42} fontSize={11} fill={T.muted} fontStyle="italic">{netLabel(i)}</text>
          </g>
        ))}
        {visible.map(b => {
          // A group's displayed children keep their real parent pointer (the
          // representative member) — resolve edges through the display map.
          if (b.parent === null) return null;
          const dp = displayPath(model, b.parent);
          if (!layout.slot.has(dp)) return null;
          const x1 = cx(dp), y1 = railY(lvl(model.blocks.get(dp)!));
          const x2 = cx(b.path), y2 = railY(lvl(b)) - BLOCK_H;
          const my = y1 + (y2 - y1) * 0.55;
          return <path key={b.path} d={`M ${x1} ${y1} V ${my} H ${x2} V ${y2}`}
                       fill="none" stroke={T.edge} strokeWidth={1.2} />;
        })}
        {visible.map(b => {
          const w = blockW(b.path), x = cx(b.path) - w / 2, y = railY(lvl(b)) - BLOCK_H;
          const isSel = selected === b.path;
          const maxChars = Math.floor((w - 14) / 6);
          const dim = !passesFilters(b, funcOff, supplyOff);
          const accent = zoneColors && b.category && b.category !== UNCLASSIFIED
            ? T.groupColors[b.category.split(':')[0]] : T.unclass;
          return (
            <g key={b.path} opacity={dim ? T.dim : 1} style={{ cursor: 'pointer' }}
               onClick={e => { e.stopPropagation(); select(isSel ? null : b.path); }}
               // leaves can't drill — re-select so a double-click doesn't
               // click-toggle the selection away
               onDoubleClick={e => { e.stopPropagation(); if (b.children.length) drillDown(b.path); else select(b.path); }}>
              <title>
                {`${b.label} (${b.master})`}
                {b.members ? ` — array of ${b.members.length}` : ''}
                {b.children.length === 0 ? ' — leaf block' : ''}
              </title>
              {(trace?.blocks.has(b.path) || pathResult?.blocks.includes(b.path)) && (
                <rect x={x - 4} y={y - 4} width={w + 8} height={BLOCK_H + 8} rx={8}
                      fill="none" stroke={T.conn} strokeWidth={2.5} />
              )}
              <rect x={x} y={y} width={w} height={BLOCK_H} rx={5} fill={T.card}
                    stroke={isSel ? T.sel : accent} strokeWidth={isSel ? 2.6 : 1.6} />
              <rect x={x} y={y} width={7} height={BLOCK_H} rx={3} fill={accent} />
              <text x={x + w / 2} y={y + 14} fontSize={9.5} fontWeight={700} fill={T.text} textAnchor="middle">
                {b.label.length > maxChars ? b.label.slice(0, maxChars - 1) + '…' : b.label}
              </text>
              <text x={x + w / 2} y={y + 26} fontSize={8} fill={T.muted} textAnchor="middle">
                {fmtCount(b.devices)} dev · {fmtCount(b.netCount)} net
              </text>
              {b.members && (() => {
                // "×N" collapsed-array chip, same language as the schematic's
                // array badge (accent pill, dark text). Kept inside the card's
                // right edge so it can't overlap the neighboring block.
                const t = `×${fmtCount(b.members.length)}`;
                const bw = t.length * 5.5 + 8;
                return (
                  <g>
                    <rect x={x + w - bw - 3} y={y - 7} width={bw} height={13} rx={6.5} fill={T.accent} />
                    <text x={x + w - bw / 2 - 3} y={y + 3} fontSize={8.5} fontWeight={700} fill={T.bg} textAnchor="middle">{t}</text>
                  </g>
                );
              })()}
            </g>
          );
        })}
        {pathResult && (() => {
          const pts = pathResult.blocks.filter(p => layout.slot.has(p))
            .map(p => [cx(p), railY(lvl(model.blocks.get(p)!)) - BLOCK_H / 2] as const);
          if (pts.length < 2) return null;
          return <path d={pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${x} ${y}`).join(' ')}
                       fill="none" stroke={T.path} strokeWidth={2.6} strokeDasharray="7 5" strokeLinejoin="round" opacity={0.95} />;
        })()}
        {pathResult && (pathEnds ?? []).map((pe, i) => {
          if (!layout.slot.has(pe.block)) return null;
          const x = cx(pe.block), y = railY(lvl(model.blocks.get(pe.block)!)) - BLOCK_H - 12;
          return (
            <g key={i}>
              <path d={`M ${x} ${y - 6} L ${x + 6} ${y} L ${x} ${y + 6} L ${x - 6} ${y} Z`} fill={i ? T.blue : T.path} />
              <text x={x + 10} y={y + 3} fontSize={9} fill={T.text}>{pe.pin}</text>
            </g>
          );
        })}
        {selected && layout.slot.has(selected) && neighbors.length > 0 && (() => {
          const maxTotal = Math.max(...neighbors.map(n => n.total), Number.EPSILON);
          const sx = cx(selected), sy = railY(lvl(model.blocks.get(selected)!)) - BLOCK_H / 2;
          return neighbors.map(n => {
            const nb = model.blocks.get(n.block);
            if (!nb) return null;
            const nx = cx(n.block), ny = railY(lvl(nb)) - BLOCK_H / 2;
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
