import { create } from 'zustand';
import type Anthropic from '@anthropic-ai/sdk';
import { getApiKey } from '../ai/apiKey';
import { runAgentTurn } from './agent';
import { runParserTurn } from './basicParser';
import { buildTools } from './tools/registry';
import { makeChatCtx } from './tools/liveCtx';
import { ChatError, mapError } from './client';
import type { Ref } from './refs';
import type { ResultTable } from './tools/types';

// Conversation state + turn orchestration. Pure logic lives in agent.ts /
// basicParser.ts; this store is the glue between them, the live stores, and
// the panel. API-shaped history (with tool_use blocks) is kept separately
// from display messages and capped so long sessions stay cheap.

export interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  refs?: Ref[];
  tables?: ResultTable[];
  notice?: string;
  error?: boolean;
}

export type ChatStatus = 'idle' | 'thinking' | 'streaming' | { tool: string };

const HISTORY_CAP = 20;
const OPEN_STORAGE = 'cdl-viewer:chat-open';
const NO_KEY_NOTICE =
  'No Claude API key set — running in basic parser mode with fixed phrasings. Add an Anthropic API key (chat header) for full natural-language chat.';

// The chat column defaults to open (it is a first-class slice of the app, not
// a hidden extra); the user's collapse choice persists across sessions.
function initialOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_STORAGE) !== 'closed';
  } catch {
    return true;
  }
}

interface ChatState {
  open: boolean;
  messages: ChatMsg[];
  status: ChatStatus;
  error: string | null;
  noticeShown: boolean;
  apiHistory: Anthropic.MessageParam[];
  toggleOpen: () => void;
  send: (text: string) => Promise<void>;
  stop: () => void;
  clear: () => void;
}

let controller: AbortController | null = null;

export const useChatStore = create<ChatState>((set, get) => ({
  open: initialOpen(),
  messages: [],
  status: 'idle',
  error: null,
  noticeShown: false,
  apiHistory: [],

  toggleOpen: () =>
    set(s => {
      const open = !s.open;
      try {
        localStorage.setItem(OPEN_STORAGE, open ? 'open' : 'closed');
      } catch {
        // storage unavailable — keep in-memory state only
      }
      return { open };
    }),

  stop: () => controller?.abort(),

  clear: () => set({ messages: [], apiHistory: [], error: null, status: 'idle' }),

  send: async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || get().status !== 'idle') return;
    set(s => ({ messages: [...s.messages, { role: 'user', text: trimmed }], error: null, status: 'thinking' }));

    const ctx = makeChatCtx();
    const appendAssistant = (msg: ChatMsg) => set(s => ({ messages: [...s.messages, msg], status: 'idle' }));

    if (!getApiKey()) {
      // Parser mode — deterministic, no network.
      const notice = get().noticeShown ? undefined : NO_KEY_NOTICE;
      if (notice) set({ noticeShown: true });
      const turn = await runParserTurn(ctx, trimmed);
      appendAssistant({
        role: 'assistant',
        text: turn.text,
        refs: turn.refs,
        tables: turn.table ? [turn.table] : undefined,
        notice,
        error: turn.isError || undefined,
      });
      return;
    }

    if (!ctx) {
      appendAssistant({ role: 'assistant', text: 'No design loaded — load a CDL first.', error: true });
      return;
    }

    controller = new AbortController();
    // Live streaming message that fills in as deltas arrive.
    set(s => ({ messages: [...s.messages, { role: 'assistant', text: '' }] }));
    const patchLast = (patch: Partial<ChatMsg>) =>
      set(s => {
        const messages = [...s.messages];
        messages[messages.length - 1] = { ...messages[messages.length - 1], ...patch };
        return { messages };
      });

    try {
      const turn = await runAgentTurn({
        userText: trimmed,
        history: get().apiHistory,
        tools: buildTools(makeChatCtx),
        ctx,
        signal: controller.signal,
        handlers: {
          onText: delta =>
            set(s => {
              const messages = [...s.messages];
              const last = messages[messages.length - 1];
              messages[messages.length - 1] = { ...last, text: last.text + delta };
              return { messages, status: 'streaming' };
            }),
          onToolUse: name => set({ status: { tool: name } }),
        },
      });
      patchLast({ refs: turn.refs, tables: turn.tables.length ? turn.tables : undefined });
      set({ apiHistory: turn.messages.slice(-HISTORY_CAP), status: 'idle' });
    } catch (e) {
      const err = e instanceof ChatError ? e : mapError(e);
      patchLast({ text: get().messages[get().messages.length - 1].text || err.message, error: true });
      set({ error: err.kind === 'stopped' ? null : err.message, status: 'idle' });
    } finally {
      controller = null;
    }
  },
}));
