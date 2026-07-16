import { useEffect, useRef, useState } from 'react';
import { useChatStore, type ChatMsg } from '../../chat/chatStore';
import { useViewerStore } from '../../store/viewerStore';
import { parseMarkers, refKey, refLabel, type Ref } from '../../chat/refs';
import { buildTools } from '../../chat/tools/registry';
import { makeChatCtx } from '../../chat/tools/liveCtx';
import { getApiKey, setApiKey, clearApiKey } from '../../ai/describeCell';
import { CHAT_MODELS, getChatModel, setChatModel, type ChatModel } from '../../chat/client';
import type { ResultTable } from '../../chat/tools/types';

// Global chat drawer — mounted once in App.tsx, persists across all three
// viewers. Citation chips and table rows dispatch the same navigate tool the
// chat brains use, so a click is exactly "navigate(<ref>)".

function navigateToRef(ref: Ref) {
  const navigate = buildTools(makeChatCtx).find(t => t.name === 'navigate');
  if (!navigate) return;
  const input =
    ref.kind === 'block' ? { target: ref.path, kind: 'block', viewer: 'hybrid' }
    : ref.kind === 'cell' ? { target: ref.cell, kind: 'cell' }
    : ref.kind === 'net' ? { target: ref.net, kind: 'net' }
    : { target: ref.id, kind: 'device' };
  void navigate.run(input);
}

function Chip({ refv }: { refv: Ref }) {
  return (
    <button className={`chat-chip chip-${refv.kind}`} title={refKey(refv)} onClick={() => navigateToRef(refv)}>
      {refLabel(refv)}
    </button>
  );
}

function Prose({ text }: { text: string }) {
  const parts = parseMarkers(text);
  return (
    <span>
      {parts.map((p, i) => (typeof p === 'string' ? <span key={i}>{p}</span> : <Chip key={i} refv={p} />))}
    </span>
  );
}

function Table({ table }: { table: ResultTable }) {
  return (
    <div className="chat-table-wrap">
      <table className="chat-table">
        <thead>
          <tr>{table.columns.map(c => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i} className={row.ref ? 'clickable' : ''} onClick={() => row.ref && navigateToRef(row.ref)}>
              {row.cells.map((cell, j) => <td key={j}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {table.note && <div className="chat-table-note">{table.note}</div>}
    </div>
  );
}

function Message({ msg }: { msg: ChatMsg }) {
  return (
    <div className={`chat-msg ${msg.role}${msg.error ? ' error' : ''}`}>
      {msg.notice && <div className="chat-notice">{msg.notice}</div>}
      <div className="chat-msg-text"><Prose text={msg.text} /></div>
      {msg.tables?.map((t, i) => <Table key={i} table={t} />)}
      {msg.refs && msg.refs.length > 0 && (
        <div className="chat-refs">
          {dedupeRefs(msg.refs).slice(0, 12).map(r => <Chip key={refKey(r)} refv={r} />)}
        </div>
      )}
    </div>
  );
}

function dedupeRefs(refs: Ref[]): Ref[] {
  const seen = new Set<string>();
  return refs.filter(r => {
    const k = refKey(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function KeyForm({ onDone }: { onDone: () => void }) {
  const [draft, setDraft] = useState('');
  return (
    <div className="chat-keyform">
      <input
        type="password"
        placeholder="Anthropic API key (stored locally)"
        value={draft}
        onChange={e => setDraft(e.target.value)}
      />
      <button
        disabled={!draft.trim()}
        onClick={() => {
          setApiKey(draft.trim());
          onDone();
        }}
      >
        Save
      </button>
    </div>
  );
}

export function ChatPanel() {
  const design = useViewerStore(s => s.design);
  const { open, messages, status, error, toggleOpen, send, stop, clear } = useChatStore();
  const [draft, setDraft] = useState('');
  const [keyVersion, setKeyVersion] = useState(0);
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [model, setModel] = useState<ChatModel>(() => getChatModel());
  const listRef = useRef<HTMLDivElement>(null);

  const hasKey = getApiKey() !== null;
  void keyVersion; // re-read of getApiKey above is driven by this state bump

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, status]);

  if (!design) return null;

  if (!open) {
    return (
      <button className="chat-fab" onClick={toggleOpen} title="Chat with the circuit">
        Chat
      </button>
    );
  }

  const busy = status !== 'idle';
  const statusLabel =
    status === 'idle' ? null
    : status === 'thinking' ? 'thinking…'
    : status === 'streaming' ? 'writing…'
    : `running ${status.tool}…`;

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    void send(text);
  };

  return (
    <div className="chat-drawer">
      <div className="chat-header">
        <span className="chat-title">Circuit Chat</span>
        {hasKey && (
          <select
            className="chat-model"
            value={model}
            onChange={e => {
              const m = e.target.value as ChatModel;
              setChatModel(m);
              setModel(m);
            }}
            title="Model for chat turns"
          >
            {CHAT_MODELS.map(m => <option key={m} value={m}>{m.replace('claude-', '')}</option>)}
          </select>
        )}
        <button
          className="chat-keybtn"
          title={hasKey ? 'Remove the stored API key' : 'Set an Anthropic API key'}
          onClick={() => {
            if (hasKey) {
              clearApiKey();
              setKeyVersion(v => v + 1);
            } else {
              setShowKeyForm(s => !s);
            }
          }}
        >
          {hasKey ? 'key ✓' : 'no key'}
        </button>
        <button className="chat-clear" title="Clear the conversation" onClick={clear}>⌫</button>
        <button className="chat-close" title="Close" onClick={toggleOpen}>×</button>
      </div>

      {!hasKey && showKeyForm && (
        <KeyForm
          onDone={() => {
            setShowKeyForm(false);
            setKeyVersion(v => v + 1);
          }}
        />
      )}

      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            Ask about the loaded design — “explain the top cell”, “trace a net”, “rank blocks”, “coupling above 5 fF”.
            {!hasKey && <div className="chat-empty-note">Basic parser mode (no API key). Fixed phrasings only.</div>}
          </div>
        )}
        {messages.map((m, i) => <Message key={i} msg={m} />)}
        {statusLabel && <div className="chat-status">{statusLabel}</div>}
      </div>

      {error && <div className="chat-error">{error}</div>}

      <div className="chat-inputrow">
        <textarea
          className="chat-input"
          placeholder="Ask the circuit…"
          value={draft}
          rows={2}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {busy
          ? <button className="chat-send stop" onClick={stop}>Stop</button>
          : <button className="chat-send" disabled={!draft.trim()} onClick={submit}>Send</button>}
      </div>
    </div>
  );
}
