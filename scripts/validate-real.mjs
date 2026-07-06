// Validate the full parse→correlate pipeline against the three REAL sample
// pairs (three different extractors) and assert the layer + correlation story
// the brief demands. Run: npm run validate:real
//
// tsx can't host pyodide, so the CDL adapter runs here in plain node (pyodide)
// while the TS modules load through tsx's ESM API. Pyodide must be imported
// BEFORE tsx's loader is pulled in, or its wasm path resolution breaks.
import { readFileSync, existsSync } from 'fs';
import { loadPyodide } from 'pyodide';

const HANDOFF = `${process.env.HOME}/Downloads/Abstract_Layout_Viewer_Handoff`;
if (!existsSync(HANDOFF)) {
  console.log(`handoff samples not present at ${HANDOFF} — skipping real-file validation`);
  process.exit(0);
}

const { tsImport } = await import('tsx/esm/api');
const { parseDspf } = await tsImport('../src/layout-viewer/dspf/parseDspf.ts', import.meta.url);
const { correlate } = await tsImport('../src/layout-viewer/correlate.ts', import.meta.url);
const { refineNetKinds } = await tsImport('../src/parser/netKinds.ts', import.meta.url);

const pyodide = await loadPyodide();
await pyodide.loadPackage('micropip');
await pyodide.pyimport('micropip').install('eda-netlist-parser');
pyodide.runPython(readFileSync(new URL('../src/parser/pyodide/cdl_adapter.py', import.meta.url), 'utf-8'));
const parseCdlPy = pyodide.globals.get('parse_cdl');

function parseCDL(text) {
  const parsed = JSON.parse(parseCdlPy(text));
  const design = { cells: new Map(Object.entries(parsed.cells)), topCell: parsed.topCell, warnings: parsed.warnings };
  refineNetKinds(design);
  return design;
}

let failures = 0;
const expect = (label, cond, detail = '') => {
  console.log(`  ${cond ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

const PAIRS = [
  ['StrongARMLatch.cdl', 'StrongARMLatch_pex.dspf'],
  ['n16g_CLK_PRE_BUF.cdl', 'n16g_CLK_PRE_BUF_quantus.dspf'],
  ['CLKGEN_icnet.cdl', 'CLKGEN_xact.dspf'],
];

for (const [cdlName, dspfName] of PAIRS) {
  console.log(`\n── ${dspfName} ${'─'.repeat(Math.max(0, 58 - dspfName.length))}`);
  const design = parseCDL(readFileSync(`${HANDOFF}/sample_cdl/${cdlName}`, 'utf-8'));
  const t0 = Date.now();
  const data = parseDspf(readFileSync(`${HANDOFF}/sample_dspf/${dspfName}`, 'utf-8'));
  const tParse = Date.now() - t0;
  const model = correlate(design, data);
  const d = data.diagnostics, st = model.stats;
  const netsMapped = model.nets.filter(n => n.instances.length > 0).length;

  console.log(`  parse ${tParse} ms · divider "${data.divider}" delimiter "${data.delimiter}" finger "${data.fingerDelim ?? '—'}"`);
  console.log(`  nets ${d.nets} (merged ${d.netsMerged}, ${netsMapped} mapped to blocks) · devices ${st.devicesUnique} (pin points ${d.devicePinPoints})`);
  console.log(`  R ${d.resistors} (${d.resistorsWithGeometry} w/ geometry) · C ${d.capacitors} (${d.couplingCaps} coupling)`);
  console.log(`  layers [${data.layers.slice(0, 8).join(', ')}${data.layers.length > 8 ? ', …' : ''}] · ground [${data.groundNets.join(', ')}]`);
  console.log(`  matched ${st.devicesMatched} dummy ${st.devicesDummy} topLevel ${st.devicesTopLevel} hierMiss ${st.devicesHierMiss}`);
  console.log(`  blocks ${st.instancesMatched}/${st.instancesTotal} (+${st.physicalBlocks} physical-only) · connections ${model.connections.length}`);
  const warnings = [...d.warnings, ...model.warnings];
  console.log(`  warnings: ${warnings.join(' | ') || '—'}`);

  expect('0 unrecognized directives', d.unrecognized === 0, String(d.unrecognized));

  if (dspfName.startsWith('StrongARM')) {
    // Calibre xRC: the full-layer end of the spectrum.
    expect('full layer story (poly + metals present)',
      data.layersPresent && ['poly', 'metal1', 'metal2', 'metal3'].every(l => data.layers.includes(l)));
    expect('ground net GND declared', data.groundNets.includes('GND'));
    expect('finger delim @', data.fingerDelim === '@');
    expect('no hierarchy misses (flat design)', st.devicesHierMiss === 0);
    expect('RC skeleton dense', model.connections.length > 1500, String(model.connections.length));
    expect('every net has totalCap', model.nets.every(n => n.totalCap !== null || n.isGround));
  }

  if (dspfName.startsWith('n16g')) {
    // Cadence Quantus: '#' delimiter, ground net 0, doubled-X instance names.
    expect('ground net 0 declared', data.groundNets.includes('0'));
    expect('finger delim @ (quoted in header)', data.fingerDelim === '@');
    expect('417 unique devices (matches its instance section)', st.devicesUnique === 417, String(st.devicesUnique));
    expect('all real devices correlate (X-collapse)', st.devicesHierMiss === 0, String(st.devicesHierMiss));
    expect('all 41 CDL blocks placed', st.instancesMatched === 41 && st.instancesTotal === 41,
      `${st.instancesMatched}/${st.instancesTotal}`);
    expect('RC skeleton resolved via node index', model.connections.length > 20000, String(model.connections.length));
    const top = design.cells.get(design.topCell);
    expect('AVRH classified power (topology+propagation)', top.nets.find(n => n.name === 'AVRH')?.kind === 'power');
    expect('VSS classified ground', top.nets.find(n => n.name === 'VSS')?.kind === 'ground');
    const buff = design.cells.get('n16g_clk_cml2cmos_buff');
    expect('net1 dangling in source (known-good: intentional dummy resistor leg)',
      buff.nets.find(n => n.name === 'net1')?.endpoints.length === 1);
  }

  if (dspfName.startsWith('CLKGEN')) {
    // Calibre xACT: layerless, '|' divider, renumbered physical hierarchy.
    expect('divider | read from TAB-delimited header', data.divider === '|');
    expect('layerless story (graceful degradation)', !data.layersPresent);
    expect('totalCap engineering suffix parsed', model.nets.some(n => n.totalCap !== null && n.totalCap < 1e-9));
    expect('device identity without coordinates', st.devicesUnique > 10000, String(st.devicesUnique));
    expect('half the devices still correlate by name', st.devicesMatched > 5000, String(st.devicesMatched));
    expect('physical-only block families surfaced', st.physicalBlocks >= 10, String(st.physicalBlocks));
    expect('nearly all nets map to blocks', netsMapped > 2000, `${netsMapped}/${model.nets.length}`);
  }
}

console.log(failures ? `\n❌ ${failures} expectation(s) FAILED` : '\n✅ all real-file expectations hold');
process.exit(failures ? 1 : 0);
