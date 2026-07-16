import Anthropic from '@anthropic-ai/sdk';
import { getApiKey } from '../ai/describeCell';
import type { ChatTool, ToolResult } from './tools/types';

// The one Anthropic client for the app: streaming tool loop for the chat
// agent, plus a simple single-shot completion the existing describe/label
// features migrate onto. Browser-direct with the user's own key — same
// no-backend story as the original raw-fetch callers, now in one place.

export const CHAT_MODELS = ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'] as const;
export type ChatModel = (typeof CHAT_MODELS)[number];
const MODEL_STORAGE = 'cdl-viewer:chat-model';
const DEFAULT_MODEL: ChatModel = 'claude-opus-4-8';

export function getChatModel(): ChatModel {
  const stored = localStorage.getItem(MODEL_STORAGE);
  return (CHAT_MODELS as readonly string[]).includes(stored ?? '') ? (stored as ChatModel) : DEFAULT_MODEL;
}

export function setChatModel(model: ChatModel): void {
  localStorage.setItem(MODEL_STORAGE, model);
}

export type ChatErrorKind = 'no-key' | 'invalid-key' | 'rate-limited' | 'stopped' | 'api';

export class ChatError extends Error {
  kind: ChatErrorKind;
  constructor(kind: ChatErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export function mapError(e: unknown): ChatError {
  if (e instanceof ChatError) return e;
  if (e instanceof Anthropic.APIUserAbortError) return new ChatError('stopped', 'Stopped.');
  if (e instanceof Anthropic.AuthenticationError) return new ChatError('invalid-key', 'The Anthropic API key was rejected — check it in the chat header.');
  if (e instanceof Anthropic.RateLimitError) return new ChatError('rate-limited', 'Rate limited by the Anthropic API — wait a moment and retry.');
  if (e instanceof Anthropic.APIError) return new ChatError('api', `Anthropic API error (${e.status}): ${e.message}`);
  if (e instanceof DOMException && e.name === 'AbortError') return new ChatError('stopped', 'Stopped.');
  return new ChatError('api', e instanceof Error ? e.message : String(e));
}

export function toSdkTools(tools: ChatTool[]): Anthropic.Tool[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool['input_schema'],
  }));
}

// Tool results go back to the model as JSON text; the typed extras (refs,
// tables) are for the UI and are collected separately by the caller.
export function serializeResult(result: ToolResult): string {
  const payload: Record<string, unknown> = { data: result.data };
  if (result.uiEffect) payload.uiEffect = result.uiEffect;
  if (result.table?.note) payload.tableNote = result.table.note;
  return JSON.stringify(payload);
}

export interface StreamHandlers {
  onText(delta: string): void;
  onToolUse?(name: string): void;
}

export interface ToolLoopResult {
  finalText: string;
  toolResults: ToolResult[];
  messages: Anthropic.MessageParam[];
}

export interface ToolLoopOptions {
  system: string;
  tools: ChatTool[];
  messages: Anthropic.MessageParam[];
  signal: AbortSignal;
  handlers: StreamHandlers;
  maxIterations?: number;
  model?: ChatModel;
}

export async function runToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult> {
  const apiKey = getApiKey();
  if (!apiKey) throw new ChatError('no-key', 'No Anthropic API key set.');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const model = opts.model ?? getChatModel();
  const maxIterations = opts.maxIterations ?? 8;

  const messages: Anthropic.MessageParam[] = [...opts.messages];
  const collected: ToolResult[] = [];
  let finalText = '';

  try {
    for (let iter = 0; iter < maxIterations; iter++) {
      const stream = client.messages.stream(
        {
          model,
          max_tokens: 4096,
          // Adaptive thinking is supported on the Opus/Sonnet tiers only —
          // Haiku 4.5 rejects the parameter, so omit it there.
          ...(model === 'claude-haiku-4-5' ? {} : { thinking: { type: 'adaptive' as const } }),
          // Stable prefix (system + tools) carries the cache breakpoint; the
          // conversation appends after it.
          system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
          tools: toSdkTools(opts.tools),
          messages,
        },
        { signal: opts.signal },
      );
      stream.on('text', delta => {
        finalText += delta;
        opts.handlers.onText(delta);
      });
      const message = await stream.finalMessage();
      messages.push({ role: 'assistant', content: message.content });

      if (message.stop_reason !== 'tool_use') break;

      const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        opts.handlers.onToolUse?.(use.name);
        const tool = opts.tools.find(t => t.name === use.name);
        let result: ToolResult;
        if (!tool) {
          result = { data: `Unknown tool "${use.name}".`, isError: true };
        } else {
          try {
            result = await tool.run((use.input ?? {}) as Record<string, unknown>);
          } catch (e) {
            result = { data: `Tool failed: ${e instanceof Error ? e.message : String(e)}`, isError: true };
          }
        }
        collected.push(result);
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: serializeResult(result),
          is_error: result.isError || undefined,
        });
      }
      messages.push({ role: 'user', content: results });
    }
  } catch (e) {
    throw mapError(e);
  }

  return { finalText, toolResults: collected, messages };
}

// Single-shot prose completion — the migration target for describeCell and
// labelGroups. Error strings intentionally match the original raw-fetch
// callers so their consumers keep working unchanged.
export async function simpleCompletion(opts: { model: string; maxTokens: number; prompt: string }): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No Anthropic API key set.');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  let res: Anthropic.Message;
  try {
    res = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: [{ role: 'user', content: opts.prompt }],
    });
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      const message = (e.error as { error?: { message?: string } } | undefined)?.error?.message ?? e.message;
      throw new Error(`Anthropic API error (${e.status}): ${message}`);
    }
    throw e;
  }
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();
  if (!text) throw new Error('Anthropic API returned an empty response.');
  return text;
}
