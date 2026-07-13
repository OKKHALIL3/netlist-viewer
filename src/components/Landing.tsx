import { useMemo, useRef, useState } from 'react';
import { useViewerStore } from '../store/viewerStore';
import { parseCDLAsync } from '../parser/pyodide/pyodideParser';
import { parseDspfAsync } from '../layout-viewer/dspf/parseDspfAsync';
import { HYBRID_ENABLED, LAYOUT_ENABLED } from '../flags';
import { BrandMark } from './BrandMark';
import type { AppMode } from '../store/viewerStore';

// Landing flow: load a CDL, optionally load a DSPF, then open a viewer.
// In builds where hybrid/layout are disabled the DSPF step disappears and a
// successful CDL parse drops straight into the schematic viewer.
const EXTRA = HYBRID_ENABLED || LAYOUT_ENABLED;
const VIEWER_COUNT = 1 + (HYBRID_ENABLED ? 1 : 0) + (LAYOUT_ENABLED ? 1 : 0);

function fmtSize(bytes: number): string {
  if (bytes > 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes > 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  if (bytes > 1e3) return (bytes / 1e3).toFixed(1) + ' KB';
  return bytes + ' B';
}

function Chip({ k, v, file }: { k: string; v: string; file?: boolean }) {
  return (
    <div className={`ld-chip${file ? ' file' : ''}`}>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

interface FileMeta { name: string; size: number }

export function Landing() {
  const {
    design, layoutData, layoutModel, parsing, parseError,
    loadDesign, loadLayout, setParsing, setParseError, setAppMode, leaveLanding,
  } = useViewerStore();
  const cdlRef = useRef<HTMLInputElement>(null);
  const dspfRef = useRef<HTMLInputElement>(null);
  const [cdlFile, setCdlFile] = useState<FileMeta | null>(null);
  const [dspfFile, setDspfFile] = useState<FileMeta | null>(null);
  const [dspfProgress, setDspfProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const step: 'cdl' | 'dspf' | 'ready' = !design ? 'cdl' : EXTRA && !layoutModel ? 'dspf' : 'ready';

  const cdlStats = useMemo(() => {
    if (!design) return null;
    let devices = 0, mos = 0;
    for (const cell of design.cells.values()) {
      devices += cell.primitives.length;
      for (const p of cell.primitives) if (p.kind === 'M') mos++;
    }
    return { subckts: design.cells.size, devices, mos };
  }, [design]);

  const dspfStats = useMemo(() => {
    if (!layoutData) return null;
    let r = 0, c = 0;
    for (const net of layoutData.nets) { r += net.resistors.length; c += net.capacitors.length; }
    return { nets: layoutData.nets.length, r, c };
  }, [layoutData]);

  const loadCdl = (file: File) => {
    if (parsing) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      setParseError(null);
      setParsing(true);
      try {
        const d = await parseCDLAsync(ev.target?.result as string);
        setCdlFile({ name: file.name, size: file.size });
        loadDesign(d);
        // Nothing left to choose when the schematic viewer is the only one.
        if (!EXTRA) leaveLanding();
      } catch (err) {
        setParseError(err instanceof Error ? err.message : String(err));
      } finally {
        setParsing(false);
      }
    };
    reader.onerror = () => setParseError(`Could not read the file${reader.error ? `: ${reader.error.message}` : ''}`);
    reader.readAsText(file);
  };

  const loadDspf = (file: File) => {
    if (parsing) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      setParseError(null);
      setParsing(true);
      setDspfProgress(0);
      try {
        const data = await parseDspfAsync(ev.target?.result as string, setDspfProgress);
        setDspfFile({ name: file.name, size: file.size });
        loadLayout(data);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : String(err));
      } finally {
        setParsing(false);
        setDspfProgress(null);
      }
    };
    reader.onerror = () => setParseError(`Could not read the file${reader.error ? `: ${reader.error.message}` : ''}`);
    reader.readAsText(file);
  };

  const open = (mode: AppMode) => {
    setAppMode(mode);
    leaveLanding();
  };

  const zoneProps = (loader: (f: File) => void, browse: () => void) => ({
    role: 'button' as const,
    tabIndex: 0,
    onClick: (e: React.MouseEvent) => { if ((e.target as HTMLElement).tagName !== 'BUTTON' && !parsing) browse(); },
    onKeyDown: (e: React.KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); browse(); }
    },
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragging(true); },
    onDragLeave: () => setDragging(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) loader(f);
    },
  });

  const cdlSummary = cdlFile && cdlStats && (
    <div className="ld-summary">
      <Chip k="CDL file" v={cdlFile.name} file />
      <Chip k="Size" v={fmtSize(cdlFile.size)} />
      <Chip k="Subckts" v={cdlStats.subckts.toLocaleString()} />
      <Chip k="Devices" v={cdlStats.devices.toLocaleString()} />
      <Chip k="MOSFETs" v={cdlStats.mos.toLocaleString()} />
    </div>
  );

  return (
    <div className="landing">
      <header className="ld-head">
        <div className="ld-brand">
          <BrandMark />
          <span className="ld-brand-name">ACE Viewer</span>
          <span className="ld-brand-sub">design viewers</span>
        </div>
        <div className="ld-head-actions">
          <button className="ld-btn ghost" onClick={() => location.reload()} title="Start over">Reset</button>
          {step === 'cdl' && (
            <button className="ld-btn primary" disabled={parsing} onClick={() => cdlRef.current?.click()}>Open CDL…</button>
          )}
          {step === 'dspf' && (
            <button className="ld-btn teal" disabled={parsing} onClick={() => dspfRef.current?.click()}>Open DSPF…</button>
          )}
        </div>
      </header>

      {/* Signal-path stepper */}
      <nav className="ld-flow" aria-label="Load flow">
        <div className={`ld-node${!design ? ' active' : ' done'}`}>
          <div className="ld-dot">{design ? '✓' : '1'}</div>
          <div className="ld-node-label">Load schematic</div>
          <div className="ld-node-tag">CDL netlist</div>
        </div>
        <div className={`ld-wire${design ? ' live' : ''}`} />
        {EXTRA && (
          <>
            <div className={`ld-node optional teal${step === 'dspf' ? ' active' : ''}${layoutModel ? ' done' : ''}`}>
              <div className="ld-dot">{layoutModel ? '✓' : '2'}</div>
              <div className="ld-node-label">Load DSPF</div>
              <div className="ld-node-tag">Optional</div>
            </div>
            <div className={`ld-wire${layoutModel ? ' live' : ''}`} />
          </>
        )}
        <div className={`ld-node${step === 'ready' ? ' active' : ''}`}>
          <div className="ld-dot">{EXTRA ? '3' : '2'}</div>
          <div className="ld-node-label">Explore</div>
          <div className="ld-node-tag">{VIEWER_COUNT === 1 ? '1 viewer' : `${VIEWER_COUNT} viewers`}</div>
        </div>
      </nav>

      <main className="ld-main">
        <section className="ld-stage">
          {step === 'cdl' && (
            <div className={`ld-zone${dragging ? ' dragover' : ''}`} {...zoneProps(loadCdl, () => cdlRef.current?.click())}
              aria-label="Drop a CDL netlist file or click to browse">
              <svg className="ld-zone-icon" viewBox="0 0 64 64" fill="none" aria-hidden="true">
                <rect x="6" y="10" width="52" height="44" rx="6" stroke="var(--accent)" strokeWidth="2" />
                <path d="M14 40h8m0 0v-14h10m0 0h6m6 0h10M32 26v14h8" stroke="var(--txt-dim)" strokeWidth="2" strokeLinecap="round" />
                <circle cx="41" cy="26" r="3" stroke="var(--accent)" strokeWidth="2" />
                <circle cx="22" cy="40" r="2" fill="var(--accent)" />
                <circle cx="40" cy="40" r="2" fill="var(--accent)" />
              </svg>
              <div className="ld-zone-title">Start with your schematic</div>
              {parsing ? (
                <div className="ld-zone-sub">Parsing the netlist… (the first run downloads the parser runtime, ~10 MB)</div>
              ) : (
                <>
                  <div className="ld-zone-sub">
                    {EXTRA
                      ? 'Drop a CDL netlist here, or click to browse. ACE builds the schematic view first, then you can layer parasitics on top.'
                      : 'Drop a CDL netlist here, or click to browse. ACE parses the full hierarchy and builds an interactive schematic.'}
                  </div>
                  <div className="ld-zone-dialects">Supports auCdl, ICnet/LVS, CRLF line endings</div>
                  <div className="ld-zone-actions">
                    <button className="ld-btn primary" onClick={() => cdlRef.current?.click()}>Browse for CDL…</button>
                  </div>
                </>
              )}
              {parseError && <div className="ld-error">{parseError}</div>}
            </div>
          )}

          {step === 'dspf' && (
            <>
              {cdlSummary}
              <div className={`ld-zone teal${dragging ? ' dragover' : ''}`} {...zoneProps(loadDspf, () => dspfRef.current?.click())}
                aria-label="Drop a DSPF file or click to browse, optional step">
                <span className="ld-pill">Optional step</span>
                <svg className="ld-zone-icon" viewBox="0 0 64 64" fill="none" aria-hidden="true">
                  <path d="M6 32h8m4 0h8m4 0h8m4 0h8m4 0h4" stroke="var(--port)" strokeWidth="2" strokeLinecap="round" />
                  <path d="M14 32v-6l4 12 4-12 4 12 2-6h2M34 32v-6l4 12 4-12 2 6h2" stroke="var(--txt-dim)" strokeWidth="1.6" strokeLinejoin="round" />
                  <path d="M24 32v10m-4 0h8M22 46h4M52 32v10m-4 0h8M50 46h4" stroke="var(--port)" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <div className="ld-zone-title">Load the DSPF</div>
                {parsing ? (
                  <div className="ld-zone-sub">
                    Parsing DSPF…{dspfProgress !== null ? ` ${Math.round(dspfProgress * 100)}%` : ''}
                  </div>
                ) : (
                  <>
                    <div className="ld-zone-sub">
                      Drop the matching DSPF here to unlock the remaining viewers. The parasitic netlist is linked
                      to the schematic you just loaded into one interconnected database.
                    </div>
                    <div className="ld-zone-dialects">Post-extraction DSPF from StarRC, Quantus, or Calibre xRC</div>
                    <div className="ld-zone-actions">
                      <button className="ld-btn teal" onClick={() => dspfRef.current?.click()}>Browse for DSPF…</button>
                      <button className="ld-btn" onClick={() => open('schematic')}>Skip — open schematic viewer</button>
                    </div>
                  </>
                )}
                {parseError && <div className="ld-error">{parseError}</div>}
              </div>
            </>
          )}

          {step === 'ready' && (
            <>
              <div className="ld-summary">
                {cdlFile && <Chip k="CDL" v={cdlFile.name} file />}
                {dspfFile && <Chip k="DSPF" v={dspfFile.name} file />}
                {dspfStats && (
                  <>
                    <Chip k="Nets" v={dspfStats.nets.toLocaleString()} />
                    <Chip k="R elements" v={dspfStats.r.toLocaleString()} />
                    <Chip k="C elements" v={dspfStats.c.toLocaleString()} />
                  </>
                )}
              </div>
              <div className="ld-zone ready" aria-label="All viewers ready">
                <svg className="ld-zone-icon" viewBox="0 0 64 64" fill="none" aria-hidden="true">
                  <circle cx="32" cy="32" r="24" stroke="var(--m)" strokeWidth="2" />
                  <path d="M22 32l7 7 13-14" stroke="var(--m)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div className="ld-zone-title">Everything is loaded</div>
                <div className="ld-zone-sub">
                  Schematic and parasitics are stitched. Open any viewer from the panel
                  {HYBRID_ENABLED ? ', or jump straight into the hybrid view to see extraction detail in schematic context' : ''}.
                </div>
                <div className="ld-zone-actions">
                  {HYBRID_ENABLED ? (
                    <button className="ld-btn primary" onClick={() => open('hybrid')}>Open hybrid viewer</button>
                  ) : (
                    <button className="ld-btn primary" onClick={() => open('layout')}>Open layout viewer</button>
                  )}
                </div>
              </div>
            </>
          )}
        </section>

        {/* Viewer unlock rail */}
        <aside className="ld-viewers" aria-label="Viewers">
          <div className="ld-viewers-h">Viewers</div>

          <div className={`ld-card${design ? ' ready' : ''}`}>
            <div className="ld-card-top">
              <div className="ld-card-name">
                <svg className="ld-glyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M3 16h4m0 0V9h5m3 0h6M12 9v7h4" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" />
                  <circle cx="14" cy="9" r="1.6" stroke="var(--accent)" strokeWidth="1.6" />
                </svg>
                Schematic viewer
              </div>
              <span className={`ld-state${design ? ' ready' : ''}`}>{design ? 'Ready' : 'Locked'}</span>
            </div>
            <div className="ld-card-desc">Hierarchical schematic rendered from the CDL.</div>
            <ul className="ld-feats">
              <li><strong>AI interpretation layer</strong> explains every block and what it does</li>
              <li>Groups design blocks by functionality and identifies signal flows</li>
              <li>Select any block to see everything connected to it: loading and interactions between parts</li>
            </ul>
            <div className="ld-req">Needs: CDL</div>
            <button className="ld-btn" disabled={!design} onClick={() => open('schematic')}>Open</button>
          </div>

          {HYBRID_ENABLED && (
            <div className={`ld-card${design && layoutModel ? ' ready' : ''}`}>
              <div className="ld-card-top">
                <div className="ld-card-name">
                  <svg className="ld-glyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M3 12h5m0 0V7h5v5m0 0h8" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" />
                    <path d="M13 12v5m-2.5 0h5M12 20.5h2" stroke="var(--port)" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  Hybrid viewer
                </div>
                <span className={`ld-state${design && layoutModel ? ' ready' : ''}`}>{design && layoutModel ? 'Ready' : 'Locked'}</span>
              </div>
              <div className="ld-card-desc">Schematic and parasitic views working as one.</div>
              <ul className="ld-feats">
                <li><strong>Path propagation</strong>: pick a start and end pin, and the path is traversed across the entire hierarchy</li>
                <li><strong>Coupling overlay</strong>: select a block to reveal every block electromagnetically coupled to it across the design tree</li>
              </ul>
              <div className="ld-req">Needs: CDL + DSPF</div>
              <button className="ld-btn" disabled={!design || !layoutModel} onClick={() => open('hybrid')}>Open</button>
            </div>
          )}

          {LAYOUT_ENABLED && (
            <div className={`ld-card teal-accent${layoutModel ? ' ready' : ''}`}>
              <div className="ld-card-top">
                <div className="ld-card-name">
                  <svg className="ld-glyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="3" y="3" width="8" height="8" rx="1" stroke="var(--port)" strokeWidth="1.6" />
                    <rect x="13" y="3" width="8" height="12" rx="1" stroke="var(--port)" strokeWidth="1.6" />
                    <rect x="3" y="13" width="8" height="8" rx="1" stroke="var(--txt-dim)" strokeWidth="1.6" />
                  </svg>
                  Layout viewer
                </div>
                <span className={`ld-state${layoutModel ? ' ready' : ''}`}>{layoutModel ? 'Ready' : 'Locked'}</span>
              </div>
              <div className="ld-card-desc">The entire layout reconstructed hierarchically from the DSPF.</div>
              <ul className="ld-feats">
                <li><strong>Depth control</strong>: browse the layout level by level, guided by the schematic structure</li>
                <li>Focus on a block and see how it interacts within a context window of its connected neighbors</li>
              </ul>
              <div className="ld-req">Needs: DSPF</div>
              <button className="ld-btn" disabled={!layoutModel} onClick={() => open('layout')}>Open</button>
            </div>
          )}

          {EXTRA && (
            <div className="ld-note">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <ellipse cx="12" cy="6" rx="7" ry="3" stroke="var(--accent)" strokeWidth="1.6" />
                <path d="M5 6v6c0 1.66 3.13 3 7 3s7-1.34 7-3V6" stroke="var(--port)" strokeWidth="1.6" />
                <path d="M5 12v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6" stroke="var(--accent)" strokeWidth="1.6" />
              </svg>
              <div>
                <strong>One interconnected database.</strong> Layout and schematic are linked in every viewer.
                Search once and move seamlessly between the two, with full detail on both sides.
              </div>
            </div>
          )}
        </aside>
      </main>

      <div className="ld-footnote">Files stay local. Nothing leaves this machine.</div>

      <input ref={cdlRef} type="file" accept=".cdl,.ckt,.net,.sp,.spi,.spice,.txt" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) loadCdl(f); e.target.value = ''; }} />
      {EXTRA && (
        <input ref={dspfRef} type="file" accept=".dspf,.spf,.spef,.txt" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) loadDspf(f); e.target.value = ''; }} />
      )}
    </div>
  );
}
