import { buildTools } from './tools/registry';
import type { ChatCtx, ToolResult } from './tools/types';
import type { Ref } from './refs';
import type { ResultTable } from './tools/types';

// The no-key fallback brain: a fixed set of phrasings mapped onto the SAME
// tool registry the LLM agent uses. Deterministic and fully testable — the
// intent-table examples are its fixture matrix.

export type Parsed = { tool: string; input: Record<string, unknown> } | { help: true };

const PIN_RE = /^\S+:\S+$/;

export function parseBasic(text: string): Parsed {
  const t = text.trim();

  let m = /^(?:explain|describe|what\s+does)\s+(.+?)(?:\s+do)?\s*\??$/i.exec(t);
  if (m) return { tool: 'explain_block', input: { target: m[1].trim() } };

  m = /^(?:trace|follow)\s+(\S+)\s+(?:from\s+(.+?)\s+)?to\s+(.+?)\s*$/i.exec(t);
  if (m) {
    const [, a, from, to] = m;
    if (PIN_RE.test(a) && PIN_RE.test(to) && !from) return { tool: 'trace_path', input: { fromPin: a, toPin: to } };
    return { tool: 'trace_net', input: { net: a } };
  }
  m = /^(?:trace|follow)\s+(\S+)\s*$/i.exec(t);
  if (m) return { tool: 'trace_net', input: { net: m[1] } };

  m = /^(?:(?:find|show|list)\s+)?(?:all\s+)?(?:(bias|clock|signal)\s+)?nets?\s+(?:with\s+)?coupling\s+(?:above|over|>)\s*([\d.]+)\s*f?f?\s*$/i.exec(t)
    ?? /^(?:(bias|clock|signal)\s+)?coupling\s+(?:above|over|>)\s*([\d.]+)\s*f?f?\s*$/i.exec(t);
  if (m) {
    const input: Record<string, unknown> = { minCouplingFf: Number(m[2]) };
    if (m[1]) input.class = m[1].toLowerCase();
    return { tool: 'find_nets', input };
  }

  m = /^(?:parasitic|rc)\s+summary\s+(?:of\s+)?(.+?)\s*$/i.exec(t) ?? /^analyze\s+(.+?)\s*$/i.exec(t);
  if (m) return { tool: 'analyze_slice', input: { block: m[1].trim() } };

  if (/^rank\s+blocks?\s*$/i.test(t)) return { tool: 'rank_blocks', input: {} };
  m = /^rank\s+nets?(?:\s+by\s+(coupling|cap|totalcap|sprawl))?\s*$/i.exec(t);
  if (m) {
    const by = m[1]?.toLowerCase();
    return { tool: 'rank_nets', input: { by: by === 'cap' || by === 'totalcap' ? 'totalCap' : by ?? 'coupling' } };
  }

  m = /^(?:go\s+to|show\s+me|show|open|jump\s+to)\s+(.+?)\s*$/i.exec(t);
  if (m) return { tool: 'navigate', input: { target: m[1].trim() } };

  m = /^(?:find|where\s+is|search)\s+(.+?)\s*\??$/i.exec(t);
  if (m) return { tool: 'resolve_entity', input: { mention: m[1].trim() } };

  if (/^(?:where\s+am\s+i|what\s+is\s+this|context)\s*\??$/i.test(t)) return { tool: 'get_context', input: {} };

  return { help: true };
}

export const HELP_TEXT = [
  'Basic parser mode understands:',
  '· explain <cell or block>',
  '· trace <net>  ·  trace <block:PIN> to <block:PIN>',
  '· [bias|clock] nets with coupling above <N> fF',
  '· parasitic summary of <block>  ·  analyze <block>',
  '· rank blocks  ·  rank nets by coupling|cap|sprawl',
  '· go to <name>  ·  find <name>  ·  where am I',
].join('\n');

export interface ParserTurn {
  text: string;
  refs: Ref[];
  table: ResultTable | null;
  isError: boolean;
}

function summarize(result: ToolResult): string {
  const parts: string[] = [];
  if (result.uiEffect) parts.push(result.uiEffect);
  if (result.table) parts.push(result.table.note ?? 'Results are in the table below.');
  if (parts.length === 0) {
    const d = result.data;
    parts.push(typeof d === 'string' ? d : '```\n' + JSON.stringify(d, null, 2) + '\n```');
  }
  return parts.join('\n');
}

// One deterministic turn: parse → dispatch the single tool → template answer.
export async function runParserTurn(ctx: ChatCtx | null, text: string): Promise<ParserTurn> {
  const parsed = parseBasic(text);
  if ('help' in parsed) return { text: HELP_TEXT, refs: [], table: null, isError: false };
  const tool = buildTools(() => ctx).find(t => t.name === parsed.tool);
  if (!tool) return { text: `Internal error: tool "${parsed.tool}" missing.`, refs: [], table: null, isError: true };
  const result = await tool.run(parsed.input);
  return {
    text: result.isError ? String(result.data) : summarize(result),
    refs: result.refs ?? [],
    table: result.table ?? null,
    isError: result.isError ?? false,
  };
}
