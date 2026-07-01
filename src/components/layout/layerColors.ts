// Single source of the layer palette — the layer chips, the canvas skeleton,
// and the inspector swatches all import from here.
// Real extractor layer names beyond the base set (vias, contacts, diffusion)
// get stable hashed hues so two layers never collide into one color.
export const LAYER_COLOR: Record<string, string> = {
  poly: '#d06bd0', od: '#7a8c5a', metal1: '#4f9dff', metal2: '#5fd0a0',
  metal3: '#ffb454', metal4: '#ff6b8a', metal5: '#b79bea',
  metal6: '#6fd0ff', metal7: '#ffd23f', via1: '#3d7dd0', via2: '#3fae82',
  via3: '#d09244', via4: '#d05a74', via5: '#9377c9',
};

const EXTRA_PALETTE = ['#8fb7e8', '#7fc9a8', '#e8b98f', '#e88fa5', '#a89be0', '#7fc4d0', '#c9a8e0', '#9ed0a8'];

export function layerColor(name: string): string {
  const exact = LAYER_COLOR[name] ?? LAYER_COLOR[name.toLowerCase()];
  if (exact) return exact;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return EXTRA_PALETTE[h % EXTRA_PALETTE.length];
}
