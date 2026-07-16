import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, collectExtras, runAgentTurn } from './agent';
import { toSdkTools, serializeResult, ChatError, mapError } from './client';
import { tinyDesign } from '../hybrid/__fixtures__/tiny';
import { buildHybridModel } from '../hybrid/model';
import { createResolver } from './resolve';
import type { ChatCtx, ChatTool, ToolResult } from './tools/types';

function minimalCtx(): ChatCtx {
  const design = tinyDesign();
  const model = buildHybridModel(design);
  return {
    design,
    resolver: createResolver(design, model),
    layoutData: null,
    layoutModel: null,
    supplyIdx: null,
    netClasses: null,
    dspfLoaded: false,
    viewer: {
      appMode: 'schematic', currentCell: 'TOP', breadcrumb: [{ label: 'TOP', cellName: 'TOP' }], selection: null,
      goToPath: () => {}, setAppMode: () => {}, readBreadcrumb: () => [],
    },
    hybrid: {
      model, conductors: null, couplingPairs: null, weights: [0.3, 0.2, 0.3, 0.2], pathMode: false, selected: null,
      jumpToPath: () => {}, select: () => {}, togglePathMode: () => {}, setPathPins: () => {},
      readSelected: () => null,
      readPathState: () => ({ pathResult: null, pathParasitics: null, pathLayers: null, pathPinsValid: false }),
    },
  };
}

test('system prompt carries grounding rules and live session facts', () => {
  const prompt = buildSystemPrompt(minimalCtx());
  assert.ok(prompt.includes('ONLY from tool results'));
  assert.ok(prompt.includes('[[block:PATH]]'));
  assert.ok(prompt.includes('top cell TOP, 4 cells'));
  assert.ok(prompt.includes('No DSPF loaded'));
});

test('toSdkTools maps the registry shape onto SDK tool definitions', () => {
  const tool: ChatTool = { name: 'x', description: 'd', input_schema: { type: 'object', properties: {} }, run: () => ({ data: 1 }) };
  const [sdk] = toSdkTools([tool]);
  assert.equal(sdk.name, 'x');
  assert.equal(sdk.description, 'd');
  assert.deepEqual(sdk.input_schema, { type: 'object', properties: {} });
});

test('serializeResult keeps data and uiEffect but not UI-only extras', () => {
  const result: ToolResult = {
    data: { a: 1 },
    refs: [{ kind: 'net', net: 'ck' }],
    table: { columns: ['x'], rows: [], note: 'top 5' },
    uiEffect: 'highlighted',
  };
  const parsed = JSON.parse(serializeResult(result));
  assert.deepEqual(parsed.data, { a: 1 });
  assert.equal(parsed.uiEffect, 'highlighted');
  assert.equal(parsed.tableNote, 'top 5');
  assert.equal(parsed.refs, undefined); // refs are for the panel, not the model
  assert.equal(parsed.table, undefined);
});

test('collectExtras flattens refs, tables, and ui effects across tool results', () => {
  const out = collectExtras([
    { data: 1, refs: [{ kind: 'cell', cell: 'A' }], uiEffect: 'one' },
    { data: 2, refs: [{ kind: 'net', net: 'ck' }], table: { columns: [], rows: [] } },
  ]);
  assert.equal(out.refs.length, 2);
  assert.equal(out.tables.length, 1);
  assert.deepEqual(out.uiEffects, ['one']);
});

test('runAgentTurn composes history + user text and returns extras (golden loop)', async () => {
  const seen: { system?: string; messageCount?: number } = {};
  const turn = await runAgentTurn({
    userText: 'rank the blocks',
    history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
    tools: [],
    ctx: minimalCtx(),
    signal: new AbortController().signal,
    handlers: { onText: () => {} },
    loop: async opts => {
      seen.system = opts.system;
      seen.messageCount = opts.messages.length;
      return {
        finalText: 'Top block is [[block:xu1]].',
        toolResults: [{ data: 'ranked', refs: [{ kind: 'block', path: 'xu1' }], uiEffect: 'ranked table shown' }],
        messages: [...opts.messages, { role: 'assistant', content: 'Top block is [[block:xu1]].' }],
      };
    },
  });
  assert.equal(seen.messageCount, 3); // history(2) + new user turn
  assert.ok(seen.system!.includes('Circuit Chat'));
  assert.equal(turn.text, 'Top block is [[block:xu1]].');
  assert.deepEqual(turn.refs, [{ kind: 'block', path: 'xu1' }]);
  assert.deepEqual(turn.uiEffects, ['ranked table shown']);
  assert.equal(turn.messages.length, 4);
});

test('abort surfaces as a stopped ChatError', async () => {
  await assert.rejects(
    runAgentTurn({
      userText: 'x',
      history: [],
      tools: [],
      ctx: minimalCtx(),
      signal: new AbortController().signal,
      handlers: { onText: () => {} },
      loop: async () => {
        throw new ChatError('stopped', 'Stopped.');
      },
    }),
    (e: unknown) => e instanceof ChatError && e.kind === 'stopped',
  );
});

test('mapError classifies unknown errors as api errors', () => {
  const e = mapError(new Error('boom'));
  assert.equal(e.kind, 'api');
  assert.equal(e.message, 'boom');
});
