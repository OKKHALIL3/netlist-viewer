import { useEffect, useRef, useState, useCallback } from 'react';
import { useViewerStore } from '../../store/viewerStore';
import type { View } from './transform';
import { fitView, worldToScreen, screenToWorld, zoomAt, panBy } from './transform';
import { pickInstance } from './pick';
import type { LayoutModel } from '../../layout-viewer/model';

const PAD = 48;
const LAYER_COLOR: Record<string, string> = {
  poly: '#d06bd0', od: '#7a8c5a', metal1: '#4f9dff', metal2: '#5fd0a0',
  metal3: '#ffb454', metal4: '#ff6b8a', metal5: '#b79bea',
};
const NEUTRAL = '#6b7689';
const INST = '#4f9dff', SEL = '#ffd23f', CONN = '#c084fc';

function depthMax(d: 0 | 1 | 2 | 'all'): number { return d === 'all' ? Infinity : d; }

function draw(
  ctx: CanvasRenderingContext2D, model: LayoutModel, v: View, w: number, h: number,
  depth: number, layers: Record<string, boolean>, hasLayers: boolean,
  selId: string | null, selNet: string | null, hoverId: string | null,
) {
  ctx.clearRect(0, 0, w, h);

  const netObj = selNet ? model.nets.find(n => n.name === selNet) ?? null : null;
  const touched = new Set(netObj?.instances ?? []);

  // ── connections: ONLY the selected net's RC skeleton, colored by layer ──
  if (netObj) {
    for (const c of model.connections) {
      if (c.net !== selNet) continue;
      if (hasLayers && c.layer && layers[c.layer] === false) continue;
      ctx.strokeStyle = hasLayers && c.layer ? (LAYER_COLOR[c.layer] ?? NEUTRAL) : NEUTRAL;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      c.points.forEach((p, i) => {
        const [sx, sy] = worldToScreen(v, p[0], p[1]);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ── instance boxes ──
  for (const inst of model.instances) {
    if (inst.depth === 0 || inst.depth > depth) continue;
    const isSel = selId === inst.id;
    const isTouch = touched.has(inst.id);
    const isHover = hoverId === inst.id && !isSel;
    const [x0, y1s] = worldToScreen(v, inst.bbox[0], inst.bbox[3]);
    const [x1, y0s] = worldToScreen(v, inst.bbox[2], inst.bbox[1]);
    const bw = x1 - x0, bh = y0s - y1s;

    ctx.globalAlpha = selNet && !isTouch && !isSel ? 0.18 : 1;
    ctx.strokeStyle = isSel ? SEL : isTouch ? CONN : INST;
    ctx.fillStyle = isSel ? 'rgba(255,210,63,0.13)' : isTouch ? 'rgba(192,132,252,0.12)' : 'rgba(79,157,255,0.10)';
    ctx.lineWidth = isSel || isHover ? 2 : 1.3;
    ctx.fillRect(x0, y1s, bw, bh);
    ctx.strokeRect(x0, y1s, bw, bh);
    if (isHover) { ctx.strokeStyle = '#9cc4ff'; ctx.lineWidth = 1; ctx.strokeRect(x0 - 2, y1s - 2, bw + 4, bh + 4); }

    if (bw > 34 && bh > 12) {
      ctx.fillStyle = isSel ? SEL : isTouch ? '#e7d4ff' : '#9cc4ff';
      ctx.font = '11px "Space Mono", monospace';
      ctx.fillText(inst.label, x0 + 5, y1s + 13);
    }
    ctx.globalAlpha = 1;
  }

  // ── the selected net's bounding box (the wide dashed box) — drawn on top ──
  if (netObj) {
    const [x0, y1s] = worldToScreen(v, netObj.bbox[0], netObj.bbox[3]);
    const [x1, y0s] = worldToScreen(v, netObj.bbox[2], netObj.bbox[1]);
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = SEL;
    ctx.fillStyle = 'rgba(255,210,63,0.06)';
    ctx.lineWidth = 1.8;
    ctx.fillRect(x0, y1s, x1 - x0, y0s - y1s);
    ctx.strokeRect(x0, y1s, x1 - x0, y0s - y1s);
    ctx.setLineDash([]);
    ctx.fillStyle = SEL;
    ctx.font = '11px "Space Mono", monospace';
    ctx.fillText(`${netObj.name} · net`, x0 + 5, y1s + 14);
  }
}

export function LayoutCanvas() {
  const model = useViewerStore(s => s.layoutModel);
  const layoutDepth = useViewerStore(s => s.layoutDepth);
  const layerVisibility = useViewerStore(s => s.layerVisibility);
  const selection = useViewerStore(s => s.selection);
  const setSelection = useViewerStore(s => s.setSelection);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const hoverRef = useRef<string | null>(null);
  const [, force] = useState(0);

  const render = useCallback(() => {
    const cv = canvasRef.current, wrap = wrapRef.current;
    if (!cv || !wrap || !model) return;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (w === 0 || h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr;
    cv.style.width = `${w}px`; cv.style.height = `${h}px`;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!viewRef.current) viewRef.current = fitView(model.extent, w, h, PAD);
    else viewRef.current = { ...viewRef.current, h };
    const selId = selection?.type === 'instance' ? selection.id : null;
    const selNet = selection?.type === 'net' ? selection.name : null;
    draw(ctx, model, viewRef.current, w, h, depthMax(layoutDepth), layerVisibility, model.layers.length > 0, selId, selNet, hoverRef.current);
  }, [model, layoutDepth, layerVisibility, selection]);

  useEffect(() => { viewRef.current = null; render(); }, [model]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { render(); });
  useEffect(() => {
    const ro = new ResizeObserver(render);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [render]);

  const fit = () => { if (model && wrapRef.current) { viewRef.current = fitView(model.extent, wrapRef.current.clientWidth, wrapRef.current.clientHeight, PAD); force(n => n + 1); } };

  const onWheel = (e: React.WheelEvent) => {
    if (!viewRef.current) return;
    const r = canvasRef.current!.getBoundingClientRect();
    viewRef.current = zoomAt(viewRef.current, e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
    force(n => n + 1);
  };
  const onDown = (e: React.MouseEvent) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; };
  const onMove = (e: React.MouseEvent) => {
    const v = viewRef.current; if (!v || !model) return;
    const r = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (drag.current) {
      drag.current.moved = drag.current.moved || Math.abs(e.clientX - drag.current.x) > 3 || Math.abs(e.clientY - drag.current.y) > 3;
      viewRef.current = panBy(v, e.clientX - drag.current.x, e.clientY - drag.current.y);
      drag.current.x = e.clientX; drag.current.y = e.clientY;
      force(n => n + 1);
      return;
    }
    const [wx, wy] = screenToWorld(v, sx, sy);
    if (readoutRef.current) readoutRef.current.textContent = `${wx.toFixed(2)}, ${wy.toFixed(2)} µm`;
    const hov = pickInstance(model, depthMax(layoutDepth), wx, wy);
    if (hov !== hoverRef.current) { hoverRef.current = hov; force(n => n + 1); }
  };
  const onUp = (e: React.MouseEvent) => {
    const d = drag.current; drag.current = null;
    if (!d || d.moved || !viewRef.current || !model) return;
    const r = canvasRef.current!.getBoundingClientRect();
    const [wx, wy] = screenToWorld(viewRef.current, e.clientX - r.left, e.clientY - r.top);
    const id = pickInstance(model, depthMax(layoutDepth), wx, wy);
    setSelection(id !== null ? { type: 'instance', id } : null);
  };

  return (
    <div ref={wrapRef} className="layout-canvas-wrap"
         onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
         onMouseLeave={() => { drag.current = null; if (hoverRef.current) { hoverRef.current = null; force(n => n + 1); } }}>
      <canvas ref={canvasRef} />
      <button className="layout-fit" onClick={fit} title="Fit to view">⤢ Fit</button>
      <div className="layout-legend">
        <span><i className="sw-inst" /> instance bbox</span>
        <span><i className="sw-net" /> net bbox</span>
        <span><i className="sw-conn" /> connection (by layer)</span>
        <span><i className="sw-sel" /> selected</span>
      </div>
      <div ref={readoutRef} className="layout-readout">— µm</div>
    </div>
  );
}
