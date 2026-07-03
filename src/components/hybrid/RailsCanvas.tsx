import { useMemo } from 'react';
import { useHybridStore } from '../../store/hybridStore';
import { computeSlots } from '../../hybrid/slots';
import { T } from './theme';

const SLOT_W = 112, MARGIN_X = 70, LEVEL_H = 118, TOP_PAD = 46, BLOCK_H = 34, BLOCK_W = 86;

export function RailsCanvas() {
  const { model, rootPath, depth, selected, select, drillDown, clearOverlays } = useHybridStore();
  const layout = useMemo(
    () => (model ? computeSlots(model, rootPath, depth) : null),
    [model, rootPath, depth],
  );
  if (!model || !layout) return null;

  const rootDepth = model.blocks.get(rootPath)!.depth;
  const visible = [...layout.slot.keys()].map(p => model.blocks.get(p)!);
  const railCount = Math.min(depth, model.maxDepth - rootDepth) + 1;
  const svgW = MARGIN_X * 2 + Math.max(1, layout.width) * SLOT_W;
  const svgH = TOP_PAD + railCount * LEVEL_H + 30;
  const cx = (p: string) => MARGIN_X + (layout.slot.get(p)! + 0.5) * SLOT_W;
  const railY = (lvl: number) => TOP_PAD + lvl * LEVEL_H + 70;
  const lvl = (b: { depth: number }) => b.depth - rootDepth;
  const netLabel = (i: number) =>
    i === 0 ? model.blocks.get(rootPath)!.label : `${model.levelNetCounts[rootDepth + i] ?? 0} net ±`;

  return (
    <div style={{ flex: 1, overflow: 'auto', position: 'relative', background: T.bg }}>
      <svg width={svgW} height={svgH} style={{ display: 'block', minWidth: '100%' }}
           onClick={() => clearOverlays()}>
        {Array.from({ length: railCount }, (_, i) => (
          <g key={i}>
            <line x1={16} y1={railY(i)} x2={svgW - 16} y2={railY(i)} stroke={T.rail} strokeWidth={1.4} />
            <text x={18} y={railY(i) - 42} fontSize={11} fill={T.muted} fontStyle="italic">{netLabel(i)}</text>
          </g>
        ))}
        {visible.filter(b => b.parent !== null && layout.slot.has(b.parent)).map(b => {
          const x1 = cx(b.parent!), y1 = railY(lvl(model.blocks.get(b.parent!)!));
          const x2 = cx(b.path), y2 = railY(lvl(b)) - BLOCK_H;
          const my = y1 + (y2 - y1) * 0.55;
          return <path key={b.path} d={`M ${x1} ${y1} V ${my} H ${x2} V ${y2}`}
                       fill="none" stroke={T.edge} strokeWidth={1.2} />;
        })}
        {visible.map(b => {
          const w = BLOCK_W, x = cx(b.path) - w / 2, y = railY(lvl(b)) - BLOCK_H;
          const isSel = selected === b.path;
          const maxChars = Math.floor((w - 14) / 6);
          return (
            <g key={b.path} style={{ cursor: 'pointer' }}
               onClick={e => { e.stopPropagation(); select(isSel ? null : b.path); }}
               onDoubleClick={e => { e.stopPropagation(); if (b.children.length) drillDown(b.path); }}>
              <rect x={x} y={y} width={w} height={BLOCK_H} rx={5} fill={T.card}
                    stroke={isSel ? T.blue : T.border} strokeWidth={isSel ? 2.6 : 1.6} />
              <text x={x + w / 2} y={y + 14} fontSize={9.5} fontWeight={700} fill={T.text} textAnchor="middle">
                {b.label.length > maxChars ? b.label.slice(0, maxChars - 1) + '…' : b.label}
              </text>
              <text x={x + w / 2} y={y + 26} fontSize={8} fill={T.muted} textAnchor="middle">
                {b.devices} dev · {b.netCount} net
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
