import { useRef } from 'react';
import { useViewerStore } from '../store/viewerStore';
import { parseCDLAsync } from '../parser/pyodide/pyodideParser';

export function TopBar() {
  const {
    design, currentCell, breadcrumb, mode, hideSupply, nodeLayout, parsing, parseError,
    ascendTo, setMode, toggleHideSupply, toggleNodeLayout, loadDesign, setParsing, setParseError, setSearchOpen,
  } = useViewerStore();
  const fileRef = useRef<HTMLInputElement>(null);

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

      {/* Breadcrumb (center) */}
      {design && (
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

      {/* Right side */}
      <div className="topbar-right">
        {parseError && <span className="badge badge-error">{parseError}</span>}
        {parsing && <span className="badge">Parsing…</span>}

        {design && (
          <>
            {/* Design-wide search */}
            <button className="search-btn" onClick={() => setSearchOpen(true)} title="Search the design (/)">
              ⌕ Search <kbd>/</kbd>
            </button>

            {/* Block layout toggle: beta = pins around 4 edges, off = classic sections */}
            <div className="supply-toggle">
              <span className="supply-label">Compact pins<sup className="beta-tag">beta</sup></span>
              <div
                className={`toggle-sw${nodeLayout === 'beta' ? ' on' : ''}`}
                onClick={toggleNodeLayout}
                title="Arrange pins around the block edges (inputs left, outputs right, supply top, ground bottom)"
              >
                <i />
              </div>
            </div>

            {/* Hide supply toggle */}
            <div className="supply-toggle">
              <span className="supply-label">Hide supply nets</span>
              <div
                className={`toggle-sw${hideSupply ? ' on' : ''}`}
                onClick={toggleHideSupply}
              >
                <i />
              </div>
            </div>

            {/* View modes */}
            <div className="mode-btns">
              <button className={mode === 'inst' ? 'on' : ''} onClick={() => setMode('inst')}>
                Instances
              </button>
              <button className={mode === 'both' ? 'on' : ''} onClick={() => setMode('both')}>
                Nets + Instances
              </button>
              <button className={mode === 'net' ? 'on' : ''} onClick={() => setMode('net')}>
                Net focus
              </button>
            </div>

            <span className="badge">cell: {currentCell}</span>
            <span className="badge">{netCount.toLocaleString()} nets</span>
          </>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".cdl,.sp,.spi,.spice"
          style={{ display: 'none' }}
          onChange={handleFile}
        />
        <button className="btn-primary" disabled={parsing} onClick={() => fileRef.current?.click()}>
          {design ? 'Load file' : 'Open CDL…'}
        </button>
      </div>
    </div>
  );
}
