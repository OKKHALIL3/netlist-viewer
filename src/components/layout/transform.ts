import type { Bbox } from '../../layout-viewer/model';
import { clampZoom } from '../../viewport/wheelZoom';

// screenX = wx*scale + tx ;  screenY = H - (wy*scale + ty)   (Y flipped: µm up)
export interface View { scale: number; tx: number; ty: number; h: number }

export function fitView(extent: Bbox, width: number, height: number, pad: number): View {
  const w = Math.max(extent[2] - extent[0], 1e-6);
  const h = Math.max(extent[3] - extent[1], 1e-6);
  // Clamp positive: when the viewport is narrower than the padding (a collapsed
  // panel / tiny window), (width - 2*pad) goes negative and a negative scale
  // would mirror the map and invert hit-testing.
  const scale = Math.max(1e-6, Math.min((width - 2 * pad) / w, (height - 2 * pad) / h));
  // center the extent in the viewport
  const tx = (width - (extent[0] + extent[2]) * scale) / 2;
  const ty = (height - (extent[1] + extent[3]) * scale) / 2;
  return { scale, tx, ty, h: height };
}

export function worldToScreen(v: View, x: number, y: number): [number, number] {
  return [x * v.scale + v.tx, v.h - (y * v.scale + v.ty)];
}

export function screenToWorld(v: View, sx: number, sy: number): [number, number] {
  return [(sx - v.tx) / v.scale, (v.h - sy - v.ty) / v.scale];
}

export function panBy(v: View, dxScreen: number, dyScreen: number): View {
  // dragging right/down should move the world right/down on screen
  return { ...v, tx: v.tx + dxScreen, ty: v.ty - dyScreen };
}

// min/max bound the resulting scale. They default to unbounded so the existing
// callers/tests are unaffected; the canvas passes limits derived from its
// fit-all scale, since scale here is px-per-micron and has no fixed range.
export function zoomAt(
  v: View, factor: number, sx: number, sy: number,
  min = 0, max = Infinity,
): View {
  const [wx, wy] = screenToWorld(v, sx, sy);
  const scale = clampZoom(v.scale * factor, min, max);
  // solve tx,ty so that (wx,wy) stays under (sx,sy)
  const tx = sx - wx * scale;
  const ty = (v.h - sy) - wy * scale;
  return { ...v, scale, tx, ty };
}
