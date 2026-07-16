import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBasic, runParserTurn, HELP_TEXT } from './basicParser';
import { tinyDesign } from '../hybrid/__fixtures__/tiny';
import { buildHybridModel } from '../hybrid/model';
import { buildConductors } from '../hybrid/connectivity';
import { createResolver } from './resolve';
import type { ChatCtx } from './tools/types';

// The bounded-intent examples from the design table, mapped to tools.
const MATRIX: Array<[string, string, Record<string, unknown>]> = [
  ['what does this block do?', 'explain_block', { target: 'this block' }],
  ['explain AMP', 'explain_block', { target: 'AMP' }],
  ['follow ck from the PLL to the divider', 'trace_net', { net: 'ck' }],
  ['trace xu1/xs2:d to xu2:z', 'trace_path', { fromPin: 'xu1/xs2:d', toPin: 'xu2:z' }],
  ['all bias nets with coupling above 5fF', 'find_nets', { class: 'bias', minCouplingFf: 5 }],
  ['coupling above 1.5 ff', 'find_nets', { minCouplingFf: 1.5 }],
  ['parasitic summary of the output stage', 'analyze_slice', { block: 'the output stage' }],
  ['rank blocks', 'rank_blocks', {}],
  ['rank nets by sprawl', 'rank_nets', { by: 'sprawl' }],
  ['rank nets', 'rank_nets', { by: 'coupling' }],
  ['go to XU2', 'navigate', { target: 'XU2' }],
  ['show me the amp', 'navigate', { target: 'the amp' }],
  ['find mid', 'resolve_entity', { mention: 'mid' }],
  ['where am I?', 'get_context', {}],
];

test('intent matrix maps each phrasing to the right tool and input', () => {
  for (const [text, tool, input] of MATRIX) {
    const parsed = parseBasic(text);
    assert.ok(!('help' in parsed), `"${text}" should parse`);
    if (!('help' in parsed)) {
      assert.equal(parsed.tool, tool, text);
      assert.deepEqual(parsed.input, input, text);
    }
  }
});

test('unknown phrasing falls back to help', () => {
  const parsed = parseBasic('please make me a sandwich');
  assert.ok('help' in parsed);
});

function ctx(): ChatCtx {
  const design = tinyDesign();
  const model = buildHybridModel(design);
  return {
    design,
    resolver: createResolver(design, model),
    layoutData: null, layoutModel: null, supplyIdx: null, netClasses: null, dspfLoaded: false,
    viewer: {
      appMode: 'schematic', currentCell: 'TOP', breadcrumb: [{ label: 'TOP', cellName: 'TOP' }], selection: null,
      goToPath: () => {}, setAppMode: () => {}, readBreadcrumb: () => [{ label: 'TOP', cellName: 'TOP' }],
    },
    hybrid: {
      model, conductors: buildConductors(design, model), couplingPairs: null,
      weights: [0.3, 0.2, 0.3, 0.2], pathMode: false, selected: null,
      jumpToPath: () => {}, select: () => {}, togglePathMode: () => {}, setPathPins: () => {},
      readSelected: () => null,
      readPathState: () => ({ pathResult: null, pathParasitics: null, pathLayers: null, pathPinsValid: false }),
    },
  };
}

test('runParserTurn end-to-end: rank blocks produces a table', async () => {
  const turn = await runParserTurn(ctx(), 'rank blocks');
  assert.equal(turn.isError, false);
  assert.ok(turn.table && turn.table.rows.length > 0);
});

test('runParserTurn end-to-end: trace of a real net cites blocks', async () => {
  const turn = await runParserTurn(ctx(), 'trace mid');
  assert.equal(turn.isError, false);
  assert.ok(turn.refs.some(r => r.kind === 'net' && r.net === 'mid'));
});

test('runParserTurn surfaces tool errors as the answer text', async () => {
  const turn = await runParserTurn(ctx(), 'coupling above 5 ff');
  assert.equal(turn.isError, true);
  assert.ok(turn.text.includes('No DSPF'));
});

test('runParserTurn without a design explains itself', async () => {
  const turn = await runParserTurn(null, 'rank blocks');
  assert.equal(turn.isError, true);
  assert.ok(turn.text.includes('load a CDL'));
});

test('help lists the supported phrasings', async () => {
  const turn = await runParserTurn(ctx(), 'gibberish input here');
  assert.equal(turn.text, HELP_TEXT);
});
