import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDesign } from '../../hybrid/__fixtures__/tiny';
import { buildHybridModel } from '../../hybrid/model';
import { buildConductors } from '../../hybrid/connectivity';
import { createResolver } from '../resolve';
import { buildTools } from './registry';
import type { ChatCtx, ToolResult } from './types';
import type { BreadcrumbEntry, SelectionType } from '../../store/viewerStore';

// Fake-store ChatCtx over the tiny fixture. Navigation actions record calls
// and mutate the fake state so verification reads see the effect.
function fakeCtx(overrides: Partial<{ jumpLands: boolean; goToPathLands: boolean }> = {}): { ctx: ChatCtx; calls: string[] } {
  const design = tinyDesign();
  const model = buildHybridModel(design);
  const conductors = buildConductors(design, model);
  const calls: string[] = [];
  let breadcrumb: BreadcrumbEntry[] = [{ label: 'TOP', cellName: 'TOP' }];
  let selected: string | null = null;

  const ctx: ChatCtx = {
    design,
    resolver: createResolver(design, model),
    layoutData: null,
    layoutModel: null,
    supplyIdx: null,
    netClasses: null,
    dspfLoaded: false,
    viewer: {
      appMode: 'schematic',
      currentCell: 'TOP',
      breadcrumb,
      selection: null,
      goToPath: (path: BreadcrumbEntry[], sel: SelectionType | null) => {
        calls.push(`goToPath:${path.map(p => p.label).join('/')}:${sel ? JSON.stringify(sel) : 'null'}`);
        if (overrides.goToPathLands !== false) breadcrumb = path;
      },
      setAppMode: mode => calls.push(`setAppMode:${mode}`),
      readBreadcrumb: () => breadcrumb,
    },
    hybrid: {
      model,
      conductors,
      couplingPairs: null,
      weights: [0.3, 0.2, 0.3, 0.2],
      pathMode: false,
      selected: null,
      jumpToPath: path => {
        calls.push(`jumpToPath:${path}`);
        if (overrides.jumpLands !== false) selected = path;
      },
      select: path => calls.push(`select:${path}`),
      togglePathMode: () => calls.push('togglePathMode'),
      setPathPins: (a, b) => calls.push(`setPathPins:${a}:${b}`),
      readSelected: () => selected,
      readPathState: () => ({ pathResult: null, pathParasitics: null, pathLayers: null, pathPinsValid: false }),
    },
  };
  return { ctx, calls };
}

function toolByName(ctx: ChatCtx | null, name: string) {
  const tools = buildTools(() => ctx);
  const tool = tools.find(t => t.name === name);
  assert.ok(tool, `tool ${name} exists`);
  return tool!;
}

test('every tool returns a uniform error with no design loaded', async () => {
  for (const tool of buildTools(() => null)) {
    const out = (await tool.run({})) as ToolResult;
    assert.equal(out.isError, true, tool.name);
  }
});

test('get_context reports viewer state and design facts', async () => {
  const { ctx } = fakeCtx();
  const out = (await toolByName(ctx, 'get_context').run({})) as ToolResult;
  const data = out.data as Record<string, unknown>;
  assert.equal(data.topCell, 'TOP');
  assert.equal(data.activeViewer, 'schematic');
  assert.equal(data.dspfLoaded, false);
});

test('resolve_entity returns candidates with refs', async () => {
  const { ctx } = fakeCtx();
  const out = (await toolByName(ctx, 'resolve_entity').run({ mention: 'AMP', kind: 'cell' })) as ToolResult;
  assert.ok(!out.isError);
  assert.ok(out.refs && out.refs.length === 1);
  assert.deepEqual(out.refs![0], { kind: 'cell', cell: 'AMP' });
});

test('explain_block assembles ports, structures, and neighbors', async () => {
  const { ctx } = fakeCtx();
  const out = (await toolByName(ctx, 'explain_block').run({ target: 'XU1' })) as ToolResult;
  assert.ok(!out.isError);
  const data = out.data as { cell: string; ports: Array<{ name: string; role: string }>; connectedNeighborBlocks: string[] };
  assert.equal(data.cell, 'AMP');
  assert.ok(data.ports.some(p => p.role === 'supply'));
  assert.ok(data.connectedNeighborBlocks.includes('xu2'), `neighbors: ${data.connectedNeighborBlocks}`);
});

test('trace_net finds the conductor and its blocks from a net name', async () => {
  const { ctx } = fakeCtx();
  const out = (await toolByName(ctx, 'trace_net').run({ net: 'mid' })) as ToolResult;
  assert.ok(!out.isError);
  const data = out.data as { blocksOnConductor: string[]; deviceEndpointBlocks: string[] };
  assert.ok(data.blocksOnConductor.includes('xu1'));
  assert.ok(data.blocksOnConductor.includes('xu2'));
});

test('trace_net on a supply net explains itself', async () => {
  const { ctx } = fakeCtx();
  const out = (await toolByName(ctx, 'trace_net').run({ net: 'vdd' })) as ToolResult;
  assert.equal(out.isError, true);
  assert.ok(String(out.data).includes('supply'));
});

test('trace_path reports unresolved endpoints as an error', async () => {
  const { ctx, calls } = fakeCtx();
  const out = (await toolByName(ctx, 'trace_path').run({ fromPin: 'nope:X', toPin: 'also:Y' })) as ToolResult;
  assert.equal(out.isError, true);
  assert.ok(calls.includes('togglePathMode'), 'path mode enabled before tracing');
  assert.ok(calls.some(c => c.startsWith('setPathPins:nope:X')));
});

test('find_nets and analyze_slice degrade cleanly without a DSPF', async () => {
  const { ctx } = fakeCtx();
  const find = (await toolByName(ctx, 'find_nets').run({ minCouplingFf: 5 })) as ToolResult;
  assert.equal(find.isError, true);
  assert.ok(String(find.data).includes('No DSPF'));
  const slice = (await toolByName(ctx, 'analyze_slice').run({ block: 'XU1' })) as ToolResult;
  assert.equal(slice.isError, true);
});

test('rank_blocks works without a DSPF and notes the missing components', async () => {
  const { ctx } = fakeCtx();
  const out = (await toolByName(ctx, 'rank_blocks').run({ limit: 3 })) as ToolResult;
  assert.ok(!out.isError);
  assert.ok(out.table && out.table.rows.length > 0);
  assert.ok(out.table!.note?.includes('No DSPF'));
});

test('navigate to a block in hybrid verifies the jump landed', async () => {
  const { ctx, calls } = fakeCtx();
  const out = (await toolByName(ctx, 'navigate').run({ target: 'XU2', kind: 'block', viewer: 'hybrid' })) as ToolResult;
  assert.ok(!out.isError, JSON.stringify(out.data));
  assert.ok(calls.includes('setAppMode:hybrid'));
  assert.ok(calls.includes('jumpToPath:xu2'));
});

test('navigate reports failure when the hybrid jump silently no-ops', async () => {
  const { ctx } = fakeCtx({ jumpLands: false });
  const out = (await toolByName(ctx, 'navigate').run({ target: 'XU2', kind: 'block', viewer: 'hybrid' })) as ToolResult;
  assert.equal(out.isError, true);
  assert.ok(String(out.data).includes('did not land'));
});

test('navigate to a net selects it in the schematic', async () => {
  const { ctx, calls } = fakeCtx();
  const out = (await toolByName(ctx, 'navigate').run({ target: 'mid', kind: 'net', viewer: 'schematic' })) as ToolResult;
  assert.ok(!out.isError, JSON.stringify(out.data));
  assert.ok(calls.some(c => c.includes('"type":"net"') && c.includes('"name":"mid"')));
});
