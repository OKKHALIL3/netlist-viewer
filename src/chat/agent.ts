import type Anthropic from '@anthropic-ai/sdk';
import { runToolLoop, type StreamHandlers, type ToolLoopResult } from './client';
import type { ChatCtx, ChatTool, ToolResult } from './tools/types';
import type { Ref } from './refs';
import type { ResultTable } from './tools/types';

// One agent turn: system prompt + tool loop + collection of the typed extras
// (refs, tables, ui effects) the panel renders alongside the streamed prose.

const SYSTEM_BASE = `You are Circuit Chat inside a CDL/DSPF netlist viewer. Answer ONLY from tool results — never invent net names, device ids, or figures. Resolve entity mentions with resolve_entity before tracing, analyzing, or navigating; use get_context for "this" / "here". Cite every element you mention with inline markers: [[block:PATH]], [[net:NAME]], [[cell:NAME]], [[device:CELL/ID]] — the UI turns these into clickable chips, so use the exact ids tools returned. Figures come from DSPF extraction and are exact; report unsolved path segments by their status, never as zero. The "bias" and "clock" net classes are heuristics — say so when you rely on them. Result tables from tools are shown to the user directly: do not restate table rows in prose, just summarize what they show. Keep answers short: lead with the result, then the evidence. When a tool reports a uiEffect, tell the user where to look.`;

export function buildSystemPrompt(ctx: ChatCtx): string {
  const facts = [
    `Design: top cell ${ctx.design.topCell}, ${ctx.design.cells.size} cells.`,
    ctx.dspfLoaded ? 'A DSPF is loaded — parasitic tools are live.' : 'No DSPF loaded — parasitic tools will report that; connectivity and explain still work.',
    `Active viewer: ${ctx.viewer.appMode}.`,
  ];
  return `${SYSTEM_BASE}\n\nCurrent session: ${facts.join(' ')}`;
}

export interface AgentTurn {
  text: string;
  refs: Ref[];
  tables: ResultTable[];
  uiEffects: string[];
  messages: Anthropic.MessageParam[];
}

export interface AgentTurnOptions {
  userText: string;
  history: Anthropic.MessageParam[];
  tools: ChatTool[];
  ctx: ChatCtx;
  signal: AbortSignal;
  handlers: StreamHandlers;
  // test seam — golden tests inject a scripted loop
  loop?: (opts: Parameters<typeof runToolLoop>[0]) => Promise<ToolLoopResult>;
}

export function collectExtras(results: ToolResult[]): Pick<AgentTurn, 'refs' | 'tables' | 'uiEffects'> {
  const refs: Ref[] = [];
  const tables: ResultTable[] = [];
  const uiEffects: string[] = [];
  for (const r of results) {
    if (r.refs) refs.push(...r.refs);
    if (r.table) tables.push(r.table);
    if (r.uiEffect) uiEffects.push(r.uiEffect);
  }
  return { refs, tables, uiEffects };
}

export async function runAgentTurn(opts: AgentTurnOptions): Promise<AgentTurn> {
  const loop = opts.loop ?? runToolLoop;
  const result = await loop({
    system: buildSystemPrompt(opts.ctx),
    tools: opts.tools,
    messages: [...opts.history, { role: 'user', content: opts.userText }],
    signal: opts.signal,
    handlers: opts.handlers,
  });
  return {
    text: result.finalText,
    ...collectExtras(result.toolResults),
    messages: result.messages,
  };
}
