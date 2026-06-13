import { useRef } from 'react';
import { useViewerStore } from '../store/viewerStore';
import { parseCDLAsync } from '../parser/pyodide/pyodideParser';

export function DropZone() {
  const fileRef = useRef<HTMLInputElement>(null);
  const { loadDesign, parsing, parseError, setParsing, setParseError } = useViewerStore();

  const load = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      setParseError(null);
      setParsing(true);
      try {
        const design = await parseCDLAsync(text);
        loadDesign(design);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : String(err));
      } finally {
        setParsing(false);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div
      className="dropzone"
      onClick={() => !parsing && fileRef.current?.click()}
      onDrop={e => { e.preventDefault(); if (parsing) return; const f = e.dataTransfer.files[0]; if (f) load(f); }}
      onDragOver={e => e.preventDefault()}
    >
      <div className="dropzone-icon">▦</div>
      <div className="dropzone-title">CDL Schematic Viewer</div>
      {parsing ? (
        <div className="dropzone-sub">Loading parser and parsing netlist… (first run downloads the Python runtime, ~10 MB)</div>
      ) : (
        <>
          <div className="dropzone-sub">Drop a CDL netlist file here, or click to browse</div>
          <div className="dropzone-hint">Supports auCdl, ICnet/LVS, CRLF — all four sample dialects</div>
        </>
      )}
      {parseError && <div className="dropzone-error">{parseError}</div>}
      <input
        ref={fileRef}
        type="file"
        accept=".cdl,.sp,.spi,.spice"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) { load(f); e.target.value = ''; } }}
      />
    </div>
  );
}
