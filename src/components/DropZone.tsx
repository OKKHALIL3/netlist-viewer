import { useRef } from 'react';
import { useViewerStore } from '../store/viewerStore';
import { parseCDL } from '../parser/cdl';

export function DropZone() {
  const fileRef = useRef<HTMLInputElement>(null);
  const { loadDesign } = useViewerStore();

  const load = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => loadDesign(parseCDL(e.target?.result as string));
    reader.readAsText(file);
  };

  return (
    <div
      className="dropzone"
      onClick={() => fileRef.current?.click()}
      onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) load(f); }}
      onDragOver={e => e.preventDefault()}
    >
      <div className="dropzone-icon">▦</div>
      <div className="dropzone-title">CDL Schematic Viewer</div>
      <div className="dropzone-sub">Drop a CDL netlist file here, or click to browse</div>
      <div className="dropzone-hint">Supports auCdl, ICnet/LVS, CRLF — all four sample dialects</div>
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
