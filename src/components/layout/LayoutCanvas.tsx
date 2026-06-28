import { useEffect, useRef, useState, useCallback } from 'react';
import { useViewerStore } from '../../store/viewerStore';
import type { View } from './transform';
import { fitView, worldToScreen, screenToWorld, zoomAt, panBy } from './transform';
import { pickInstance } from './pick';
import type { LayoutModel, Bbox } from '../../layout-viewer/model';

const PAD = 48;
const LAYER_COLOR: Record<string, string> = {
  poly: '#d06bd0', od: '#7a8c5a', metal1: '#4f9dff', metal2: '#5fd0a0',
  metal3: '#ffb454', metal4: '#ff6b8a', metal5: '#b79bea',
};
const NEUTRAL = '#6b7689';
const SEL = '#ffd23f', CONN = '#c084fc';

// Per-block color families: each top-level block gets a stable hue so sibling
// blocks read as distinct; descendants inherit their top block's hue. The
// whole-design boundary (depth 0) is a neutral grey.
const PALETTE = ['#4f9dff', '#5fd0a0', '#ffb454', '#ff6b8a', '#b79bea', '#4fd0e0', '#e0a3ff', '#7bd88f'];
const ROOT_COLOR = '#8a93a6';
function blockColor(id: string): string {
  const top = id.split('/')[0];
  if (!top) return ROOT_COLOR;
  let h = 0;
  for (let i = 0; i < top.length; i++) h = (h * 31 + top.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

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
  // depth 0 (the whole-design boundary) is drawn first as context; deeper boxes
  // layer on top. When a block is selected, dim everything off its branch
  // (self / ancestors / descendants); the depth-0 box always stays visible.
  const onSelBranch = (id: string): boolean => {
    if (selId === null || selId === '' || id === '' || id === selId) return true;
    return selId.startsWith(id + '/') || id.startsWith(selId + '/');
  };
  for (const inst of model.instances) {
    if (inst.depth > depth) continue;
    const isSel = selId === inst.id;
    const isTouch = touched.has(inst.id);
    const isHover = hoverId === inst.id && !isSel;
    const faded = selId !== null ? !onSelBranch(inst.id) : (!!selNet && !isTouch);

    const base = inst.depth === 0 ? ROOT_COLOR : blockColor(inst.id);
    const stroke = isSel ? SEL : (isTouch && selNet) ? CONN : base;
    const fill = isSel ? rgba(SEL, 0.14)
      : (isTouch && selNet) ? rgba(CONN, 0.12)
      : rgba(base, inst.depth === 0 ? 0.04 : 0.11);

    const [x0, y1s] = worldToScreen(v, inst.bbox[0], inst.bbox[3]);
    const [x1, y0s] = worldToScreen(v, inst.bbox[2], inst.bbox[1]);
    const bw = x1 - x0, bh = y0s - y1s;

    ctx.globalAlpha = faded ? 0.12 : 1;
    ctx.strokeStyle = stroke;
    ctx.fillStyle = fill;
    ctx.lineWidth = isSel || isHover ? 2 : inst.depth === 0 ? 1.4 : 1.3;
    ctx.fillRect(x0, y1s, bw, bh);
    ctx.strokeRect(x0, y1s, bw, bh);
    if (isHover) { ctx.strokeStyle = rgba(base, 0.9); ctx.lineWidth = 1; ctx.strokeRect(x0 - 2, y1s - 2, bw + 4, bh + 4); }

    if (bw > 34 && bh > 12) {
      ctx.fillStyle = isSel ? SEL : faded ? rgba(base, 0.5) : stroke;
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
  const layoutFocusRequest = useViewerStore(s => s.layoutFocusRequest);

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

  const fitAll = useCallback(() => {
    const wrap = wrapRef.current;
    if (!model || !wrap) return;
    viewRef.current = fitView(model.extent, wrap.clientWidth, wrap.clientHeight, PAD);
    force(n => n + 1);
  }, [model]);

  // Frame the current selection when something requests focus (zone dropdown,
  // insights panel) — NOT on plain canvas clicks, which would be jarring.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!model || !selection || !wrap || layoutFocusRequest === 0) return;
    let bbox: Bbox | undefined;
    if (selection.type === 'instance') bbox = model.instances.find(i => i.id === selection.id)?.bbox;
    else if (selection.type === 'net') bbox = model.nets.find(n => n.name === selection.name)?.bbox;
    if (bbox) { viewRef.current = fitView(bbox, wrap.clientWidth, wrap.clientHeight, 90); render(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutFocusRequest]);

  // Keyboard: F = fit all, Esc = deselect.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'f' || e.key === 'F') fitAll();
      else if (e.key === 'Escape') setSelection(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitAll, setSelection]);

  const exportPng = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const a = document.createElement('a');
    a.download = `${model?.design ?? 'layout'}-layout.png`;
    a.href = cv.toDataURL('image/png');
    a.click();
  };

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
      <div className="layout-tools">
        <button onClick={fitAll} title="Fit to view (F)">⤢ Fit</button>
        <button onClick={exportPng} title="Export PNG">⬇ PNG</button>
      </div>
      <div className="layout-legend">
        <span><i className="sw-inst" /> block (by hierarchy)</span>
        <span><i className="sw-net" /> net bbox</span>
        <span><i className="sw-conn" /> connection (by layer)</span>
        <span><i className="sw-sel" /> selected</span>
      </div>
      <div ref={readoutRef} className="layout-readout">— µm</div>
    </div>
  );
}
