import { memo, useLayoutEffect, useRef, useState } from 'react';
import { useStore, type NodeProps } from '@xyflow/react';
import type { GroupKind } from '../../organize/groups';

// A decorative dotted section box for the Organize view. Rendered behind the
// real nodes and non-interactive (pointer-events: none) so it never intercepts
// a click meant for a block inside it. Sized by the node's style width/height;
// the inner div just fills it.
export interface GroupNodeData extends Record<string, unknown> {
  label: string;
  note?: string;
  kind: GroupKind;
}

// One hue per functional group, drawn from the app's device/zone palette so the
// organized schematic reads as the same product as the hybrid + layout viewers.
const COLORS: Record<GroupKind, string> = {
  core: '#5fd0a0',     // analog green (--m / --pin-i)
  bias: '#ffb454',     // amber
  digital: '#4f9dff',  // digital blue (--accent)
  io: '#c084fc',       // violet (--conn)
  passive: '#8b95a7',  // neutral gray
  other: '#566073',    // faint
};

function GroupNodeImpl({ data }: NodeProps) {
  const d = data as GroupNodeData;
  const color = COLORS[d.kind] ?? COLORS.other;
  // Counter-scale the header (and the box border) against the viewport zoom so
  // section titles stay readable at fit view on a large cell — at a fixed 13px
  // flow size they shrank to a few screen pixels. Capped so a hand-zoom far
  // past fit can't blow a title up to the size of its own box.
  const zoom = useStore(s => s.transform[2]);
  const boxRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  // Layout (pre-transform) widths of the box and the title, so the boost can be
  // capped per box: a narrow section must show its whole name, not clip it.
  // Both are boost-independent — transforms don't affect layout, the box is
  // sized by the node style, and the title span never flex-shrinks.
  const [meas, setMeas] = useState({ box: 0, title: 0 });
  useLayoutEffect(() => {
    const box = boxRef.current?.offsetWidth ?? 0;
    const title = titleRef.current?.offsetWidth ?? 0;
    setMeas(m => (m.box === box && m.title === title ? m : { box, title }));
  });
  // Title fits iff title·boost ≤ box − 3·boost (border) − 28 (row insets),
  // i.e. boost ≤ (box − 28) / (title + 3).
  const fitBoost = meas.title > 0 ? (meas.box - 28) / (meas.title + 3) : Infinity;
  const boost = Math.max(1, Math.min(10, 1 / zoom, fitBoost));
  return (
    <div
      ref={boxRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        border: `${1.5 * boost}px dashed ${color}`,
        borderRadius: 14,
        background: `${color}0f`,
        pointerEvents: 'none',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 14,
          // Pre-divide the row's width by the scale factor so the scaled-up
          // header still clips at the box's right edge instead of spilling out.
          width: `calc((100% - 28px) / ${boost})`,
          transform: `scale(${boost})`,
          transformOrigin: 'top left',
          display: 'flex',
          gap: 10,
          alignItems: 'baseline',
          overflow: 'hidden',
        }}
      >
        <span
          ref={titleRef}
          style={{
            fontFamily: "'Sora', system-ui, sans-serif",
            fontWeight: 600,
            fontSize: 13,
            letterSpacing: 0.3,
            color,
            whiteSpace: 'nowrap',
            flexShrink: 0,
            // A dark pill behind the title keeps it legible where wires and
            // blocks crowd the top edge of the section.
            background: 'rgba(11, 15, 20, 0.78)',
            padding: '1px 8px',
            borderRadius: 6,
          }}
        >
          {d.label}
        </span>
        {d.note && (
          <span
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 10,
              color: '#7d8a9c',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {d.note}
          </span>
        )}
      </div>
    </div>
  );
}

export const GroupNode = memo(GroupNodeImpl);
