import { useEffect, useRef, useState, useCallback } from 'react';
import { useViewerStore } from '../../store/viewerStore';
import type { View } from './transform';
import { fitView, worldToScreen, screenToWorld, zoomAt, panBy } from './transform';
import { pickInstance } from './pick';
import type { LayoutModel } from '../../layout-viewer/model';

const PAD = 40;
const LAYER_COLOR: Record<string, string> = {
  poly: '#d06bd0', od: '#7a8c5a', metal1: '#4f9dff', metal2: '#5fd0a0',
  metal3: '#ffb454', metal4: '#ff6b8a', metal5: '#b79bea',
};
const NEUTRAL = '#6b7689';

function depthMax(d: 0 | 1 | 2 | 'all'): number { return d === 'all' ? Infinity : d; }

function draw(
  ctx: CanvasRenderingContext2D, model: LayoutModel, v: View, w: number, h: number,
  depth: number, layers: Record<string, boolean>, hasLayers: boolean,
  selId: string | null, selNet: string | null,
) {
  ctx.clearRect(0, 0, w, h);

  // nets to show: the selected net, or the nets touching the selected instance
  const showNets = new Set<string>();
  if (selNet) showNets.add(selNet);
  else if (selId !== null) for (const n of model.nets) if (n.instances.includes(selId)) showNets.add(n.name);

  // connections (under everything) — ONLY for the selection's nets. Drawing
  // every parasitic segment of a real design at once is unreadable noise, so
  // with nothing selected we show just the boxes. Select a block or net to
  // light up its RC-skeleton traces.
  if (showNets.size > 0) {
    for (const c of model.connections) {
      if (!showNets.has(c.net)) continue;
      if (hasLayers && c.layer && layers[c.layer] === false) continue;
      const color = hasLayers && c.layer ? (LAYER_COLOR[c.layer] ?? NEUTRAL) : NEUTRAL;
      const hot = selNet === c.net;
      ctx.strokeStyle = color;
      ctx.globalAlpha = hot ? 0.95 : 0.65;
      ctx.lineWidth = hot ? 2.4 : 1.4;
      ctx.beginPath();
      c.points.forEach((p, i) => {
        const [sx, sy] = worldToScreen(v, p[0], p[1]);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // net boxes (translucent dashed). A block can touch dozens of nets, so the
  // unfocused boxes are drawn faint and UNLABELLED (their names live in the
  // inspector) — only the focused net gets a bold box + label, so the labels
  // never pile into an unreadable stack.
  for (const n of model.nets) {
    if (!showNets.has(n.name)) continue;
    const hot = selNet === n.name;
    const [x0, y1s] = worldToScreen(v, n.bbox[0], n.bbox[3]);
    const [x1, y0s] = worldToScreen(v, n.bbox[2], n.bbox[1]);
    ctx.setLineDash([6, 4]);
    ctx.globalAlpha = hot ? 1 : 0.3;
    ctx.strokeStyle = hot ? '#ffd23f' : '#5fd0a0';
    ctx.fillStyle = hot ? 'rgba(255,210,63,0.10)' : 'rgba(95,208,160,0.05)';
    ctx.lineWidth = hot ? 1.7 : 1.1;
    ctx.fillRect(x0, y1s, x1 - x0, y0s - y1s);
    ctx.strokeRect(x0, y1s, x1 - x0, y0s - y1s);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    if (hot) {
      ctx.fillStyle = '#ffd23f';
      ctx.font = '11px "Space Mono", monospace';
      ctx.fillText(`${n.name} ·net`, x0 + 4, y1s + 12);
    }
  }

  // instance boxes (solid blue, yellow when selected)
  for (const inst of model.instances) {
    if (inst.depth === 0 || inst.depth > depth) continue;
    const hot = selId === inst.id;
    const dim = selNet !== null;
    const [x0, y1s] = worldToScreen(v, inst.bbox[0], inst.bbox[3]);
    const [x1, y0s] = worldToScreen(v, inst.bbox[2], inst.bbox[1]);
    ctx.globalAlpha = dim ? 0.3 : 1;
    ctx.strokeStyle = hot ? '#ffd23f' : '#4f9dff';
    ctx.fillStyle = hot ? 'rgba(255,210,63,0.14)' : 'rgba(79,157,255,0.12)';
    ctx.lineWidth = hot ? 2 : 1.3;
    ctx.fillRect(x0, y1s, x1 - x0, y0s - y1s);
    ctx.strokeRect(x0, y1s, x1 - x0, y0s - y1s);
    ctx.fillStyle = hot ? '#ffd23f' : '#9cc4ff';
    ctx.font = '11px "Space Mono", monospace';
    ctx.fillText(inst.label, x0 + 4, y1s + 13);
    ctx.globalAlpha = 1;
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
  const viewRef = useRef<View | null>(null);
  const [, force] = useState(0);
  const drag = useRef<{ x: number; y: number } | null>(null);

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
    const depth = depthMax(layoutDepth);
    const selId = selection?.type === 'instance' ? selection.id : null;
    const selNet = selection?.type === 'net' ? selection.name : null;
    draw(ctx, model, viewRef.current, w, h, depth, layerVisibility, model.layers.length > 0, selId, selNet);
  }, [model, layoutDepth, layerVisibility, selection]);

  // Refit when a new model loads.
  useEffect(() => { viewRef.current = null; render(); }, [model]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { render(); });
  useEffect(() => {
    const ro = new ResizeObserver(render);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [render]);

  const onWheel = (e: React.WheelEvent) => {
    if (!viewRef.current) return;
    const r = canvasRef.current!.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    viewRef.current = zoomAt(viewRef.current, factor, e.clientX - r.left, e.clientY - r.top);
    force(n => n + 1);
  };
  const onDown = (e: React.MouseEvent) => { drag.current = { x: e.clientX, y: e.clientY }; };
  const onMove = (e: React.MouseEvent) => {
    if (!drag.current || !viewRef.current) return;
    viewRef.current = panBy(viewRef.current, e.clientX - drag.current.x, e.clientY - drag.current.y);
    drag.current = { x: e.clientX, y: e.clientY };
    force(n => n + 1);
  };
  const onUp = (e: React.MouseEvent) => {
    const moved = drag.current && (Math.abs(e.clientX - drag.current.x) > 3 || Math.abs(e.clientY - drag.current.y) > 3);
    drag.current = null;
    if (moved || !viewRef.current || !model) return;
    const r = canvasRef.current!.getBoundingClientRect();
    const [wx, wy] = screenToWorld(viewRef.current, e.clientX - r.left, e.clientY - r.top);
    const id = pickInstance(model, depthMax(layoutDepth), wx, wy);
    setSelection(id !== null ? { type: 'instance', id } : null);
  };

  return (
    <div ref={wrapRef} className="layout-canvas-wrap"
         onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
         onMouseLeave={() => { drag.current = null; }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
