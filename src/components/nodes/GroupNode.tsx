import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
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
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        border: `1.5px dashed ${color}`,
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
          right: 14,
          display: 'flex',
          gap: 10,
          alignItems: 'baseline',
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            fontFamily: "'Sora', system-ui, sans-serif",
            fontWeight: 600,
            fontSize: 13,
            letterSpacing: 0.3,
            color,
            whiteSpace: 'nowrap',
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
