import { useRef, useState } from 'react';
import { useViewerStore } from '../store/viewerStore';
import { useHybridStore } from '../store/hybridStore';
import { parseCDLAsync } from '../parser/pyodide/pyodideParser';
import { parseDspfAsync } from '../layout-viewer/dspf/parseDspfAsync';

export function TopBar() {
  const {
    design, currentCell, breadcrumb, mode, hideSupply, organize, parsing, parseError,
    ascendTo, setMode, toggleHideSupply, toggleOrganize, loadDesign, setParsing, setParseError, setSearchOpen,
    appMode, setAppMode, loadLayout, layoutModel,
  } = useViewerStore();
  // Hybrid trail — rendered in the SAME center slot as the schematic trail so
  // the breadcrumb never moves between views. Selective subscriptions: the
  // top bar must not re-render on every hybrid-store change.
  const hyModel = useHybridStore(s => s.model);
  const hyOpenPath = useHybridStore(s => s.openPath);
  const hyGoToCrumb = useHybridStore(s => s.goToCrumb);
  const fileRef = useRef<HTMLInputElement>(null);
  const dspfRef = useRef<HTMLInputElement>(null);
  // 0..1 while a DSPF parse is running in the worker, null otherwise.
  const [dspfProgress, setDspfProgress] = useState<number | null>(null);

  const handleDspf = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      setParseError(null);
      setParsing(true);
      setDspfProgress(0);
      try {
        const data = await parseDspfAsync(ev.target?.result as string, setDspfProgress);
        loadLayout(data);
        setAppMode('layout');
      } catch (err) {
        setParseError(err instanceof Error ? err.message : String(err));
      } finally {
        setParsing(false);
        setDspfProgress(null);
      }
    };
    reader.onerror = () => {
      setParseError(`Could not read the file${reader.error ? `: ${reader.error.message}` : ''}`);
      setParsing(false);
      setDspfProgress(null);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const cell = design?.cells.get(currentCell);
  const netCount = cell?.nets.length ?? 0;

  const loadFile = async (text: string) => {
    setParseError(null);
    setParsing(true);
    try {
      const d = await parseCDLAsync(text);
      loadDesign(d);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
    } finally {
      setParsing(false);
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => loadFile(ev.target?.result as string);
    reader.onerror = () => setParseError(`Could not read the file${reader.error ? `: ${reader.error.message}` : ''}`);
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (parsing) return;
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => loadFile(ev.target?.result as string);
    reader.onerror = () => setParseError(`Could not read the file${reader.error ? `: ${reader.error.message}` : ''}`);
    reader.readAsText(file);
  };

  return (
    <div
      className="topbar"
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
    >
      {/* Logo */}
      <div className="logo">
        <span className="logo-dot" />
        ACE
      </div>

      {/* Breadcrumb (center) — the navigation trail lives here in EVERY view.
          Schematic and layout share the schematic trail; hybrid shows its own
          open chain (crumbs ARE openPath — clicking one collapses below it). */}
      {design && appMode !== 'hybrid' && (
        <div className="breadcrumb">
          {breadcrumb.map((entry, i) => (
            <span key={i}>
              {i > 0 && <span className="crumb-sep">/</span>}
              <span
                className={`crumb-item${i === breadcrumb.length - 1 ? ' cur' : ''}`}
                onClick={() => ascendTo(i)}
              >
                {entry.label}
              </span>
            </span>
          ))}
        </div>
      )}
      {design && appMode === 'hybrid' && hyModel && (
        <div className="breadcrumb">
          {(hyOpenPath.length ? hyOpenPath : ['']).map((c, i, arr) => (
            <span key={c || 'root'}>
              {i > 0 && <span className="crumb-sep">/</span>}
              <span
                className={`crumb-item${i === arr.length - 1 ? ' cur' : ''}`}
                title={i === 0 ? hyModel.blocks.get('')?.label : undefined}
                onClick={i === arr.length - 1 ? undefined : () => hyGoToCrumb(i)}
              >
                {i === 0 ? 'top' : (hyModel.blocks.get(c)?.label ?? c)}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Right side */}
      <div className="topbar-right">
        {parseError && <span className="badge badge-error">{parseError}</span>}
        {parsing && (
          <span className="badge">
            {dspfProgress !== null ? `Parsing DSPF… ${Math.round(dspfProgress * 100)}%` : 'Parsing…'}
          </span>
        )}

        {design && (
          <>
            {/* Schematic-only controls come FIRST so everything after them —
                view toggle, search, file buttons — sits in the exact same
                place in all three views (right-aligned constant tail). */}
            {appMode === 'schematic' && (
              <>
                {/* Hide supply toggle */}
                <div className="supply-toggle">
                  <span className="supply-label">Hide supply nets</span>
                  <div className={`toggle-sw${hideSupply ? ' on' : ''}`} onClick={toggleHideSupply}>
                    <i />
                  </div>
                </div>

                {/* Organize toggle — cluster blocks into labeled functional sections */}
                <div className="supply-toggle" title="Group blocks into labeled functional sections (analog core, bias, digital, I/O)">
                  <span className="supply-label">Organize</span>
                  <div className={`toggle-sw${organize ? ' on' : ''}`} onClick={toggleOrganize}>
                    <i />
                  </div>
                </div>

                {/* View modes */}
                <div className="mode-btns">
                  <button className={mode === 'inst' ? 'on' : ''} onClick={() => setMode('inst')}>Instances</button>
                  <button className={mode === 'both' ? 'on' : ''} onClick={() => setMode('both')}>Nets + Instances</button>
                </div>

                <span className="badge">cell: {currentCell}</span>
                <span className="badge">{netCount.toLocaleString()} nets</span>
              </>
            )}

            {/* App mode: schematic ⇄ hybrid ⇄ layout */}
            <div className="mode-btns">
              <button className={appMode === 'schematic' ? 'on' : ''} onClick={() => setAppMode('schematic')}>
                Schematic
              </button>
              <button
                className={appMode === 'hybrid' ? 'on' : ''}
                title="Hybrid hierarchy viewer (CDL + DSPF)"
                onClick={() => setAppMode('hybrid')}
              >
                Hybrid
              </button>
              <button
                className={appMode === 'layout' ? 'on' : ''}
                disabled={!layoutModel}
                title={layoutModel ? 'Physical layout map' : 'Load a DSPF first'}
                onClick={() => setAppMode('layout')}
              >
                Layout
              </button>
            </div>

            {/* Design-wide search — same spot in every view ("/" works everywhere) */}
            <button className="search-btn" onClick={() => setSearchOpen(true)} title="Search the design (/)">
              ⌕ Search <kbd>/</kbd>
            </button>
          </>
        )}

        <input ref={fileRef} type="file" accept=".cdl,.sp,.spi,.spice" style={{ display: 'none' }} onChange={handleFile} />
        <input ref={dspfRef} type="file" accept=".dspf,.spf,.txt" style={{ display: 'none' }} onChange={handleDspf} />
        {design && (
          <button className="btn-secondary" onClick={() => dspfRef.current?.click()} title="Correlate a DSPF parasitic file">
            Add DSPF
          </button>
        )}
        <button className="btn-primary" disabled={parsing} onClick={() => fileRef.current?.click()}>
          {design ? 'Load file' : 'Open CDL…'}
        </button>
      </div>
    </div>
  );
}
