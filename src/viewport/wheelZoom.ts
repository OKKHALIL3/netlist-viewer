// One canonical wheel-zoom step, shared by every canvas so the same gesture
// zooms by the same amount in the schematic, hybrid and layout views.
//
// The schematic canvas is React Flow, which zooms via d3-zoom; this mirrors
// d3's default wheel handling so the hand-rolled canvases match it exactly
// rather than each inventing a step.
//
// The important property is that the step follows the wheel DISTANCE, not the
// number of wheel events: a trackpad reports a gesture as a burst of many tiny
// deltas, so a per-event step (the layout canvas used a flat 1.1x) compounds
// into a runaway zoom while a mouse's single big notch barely moves.

export interface WheelLike {
  deltaY: number;
  /** 0 = pixels (default), 1 = lines, 2 = pages */
  deltaMode?: number;
  ctrlKey?: boolean;
}

// deltaMode is normalised to pixel-equivalents: Firefox and most Windows mice
// report lines, not pixels, and treating those as pixels makes a notch a no-op.
const UNIT_BY_DELTA_MODE: Record<number, number> = { 0: 0.002, 1: 0.05, 2: 1 };

/**
 * Multiplier to apply to the current zoom for one wheel event.
 * >1 zooms in, <1 zooms out, exactly 1 for a zero delta.
 */
export function wheelZoomFactor(e: WheelLike): number {
  const unit = UNIT_BY_DELTA_MODE[e.deltaMode ?? 0] ?? UNIT_BY_DELTA_MODE[0];
  // A trackpad pinch arrives as ctrl+wheel with very small deltas, so it gets
  // the same 10x boost d3 gives it — otherwise pinching feels dead.
  const boost = e.ctrlKey ? 10 : 1;
  return 2 ** (-e.deltaY * unit * boost);
}

/** Keep a zoom level inside a viewer's limits. */
export function clampZoom(zoom: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, zoom));
}
