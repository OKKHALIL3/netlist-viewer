import { useRef } from 'react';
import { useViewerStore } from '../store/viewerStore';
import { parseCDL } from '../parser/cdl';

export function TopBar() {
  const {
    design, currentCell, breadcrumb, mode, hideSupply,
    ascendTo, setMode, toggleHideSupply, loadDesign,
  } = useViewerStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const cell = design?.cells.get(currentCell);
  const netCount = cell?.nets.length ?? 0;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const d = parseCDL(text);
      loadDesign(d);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      loadDesign(parseCDL(text));
    };
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

      {/* Steps */}
      <div className="steps">
        <span className="step active">1 · Schematic</span>
        <span className="step-sep">—</span>
        <span className="step">2 Flavor</span>
        <span className="step-sep">—</span>
        <span className="step">3 Coupling Caps</span>
        <span className="step-sep">—</span>
        <span className="step">4 Termination</span>
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
        {design && (
          <>
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
        <button className="btn-primary" onClick={() => fileRef.current?.click()}>
          {design ? 'Load file' : 'Open CDL…'}
        </button>
      </div>
    </div>
  );
}
