// Which viewers this build exposes. VITE_VIEWERS is a comma list —
// "schematic" | "schematic,hybrid" | "all" — set per build by CI so the
// public site only shows released viewers while the preview build carries
// everything. Unset (local dev, tests) means all viewers.

export interface ViewerFlags {
  hybrid: boolean;
  layout: boolean;
  chat: boolean;
}

export function parseViewers(raw: string | undefined): ViewerFlags {
  const list = (raw ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0 || list.includes('all')) return { hybrid: true, layout: true, chat: true };
  return { hybrid: list.includes('hybrid'), layout: list.includes('layout'), chat: list.includes('chat') };
}

// import.meta.env only exists under vite; the optional chain keeps this
// module importable from the node-based test runner.
const flags = parseViewers(import.meta.env?.VITE_VIEWERS);

export const HYBRID_ENABLED = flags.hybrid;
export const LAYOUT_ENABLED = flags.layout;
export const CHAT_ENABLED = flags.chat;
