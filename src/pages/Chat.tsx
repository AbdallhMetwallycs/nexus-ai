import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  Bot,
  Check,
  Copy,
  FileText,
  MessageSquarePlus,
  MoreHorizontal,
  Paperclip,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { Badge, Button, ConfirmDialog, DemoNotice, EmptyState, IconButton, Input, Menu, Modal, Select, Tooltip, useToast, type MenuItem } from '../components/ui';
import { ContextPanelCard, KeyValue } from '../components/common/PageChrome';
import { Markdown } from '../lib/markdown';
import { MOCK_CONVERSATIONS, SIMULATED_REPLIES } from '../data/chat';
import type { Attachment, ChatMessage, Conversation } from '../data/types';
import { MOCK_AGENTS } from '../data/agents';
import { MOCK_MODELS, modelName } from '../data/models';
import { usePlatform } from '../state/PlatformContext';
import { clockTime, cn, timeAgo } from '../lib/utils';
import { resolveTransport } from '../contract/client';
import type { ChatTokenEvent, ChatUsageEvent, ModelRecord } from '../contract/ipc';

/* ------------------------------------------------------------------ */
/* Store: frontend-only conversation state (Phase 1).                  */
/* Backend seam: swap for a repository call in Phase 2.                */
/* ------------------------------------------------------------------ */

let idSeq = 1000;
const nextId = () => `m-${++idSeq}`;

function newConversation(modelId: string, agentId: string): Conversation {
  return {
    id: `c-${Date.now()}`,
    title: 'New conversation',
    updatedAt: new Date().toISOString(),
    agentId,
    modelId,
    pinned: false,
    messages: [],
  };
}

function pickReply(text: string): string {
  // Deterministic-ish selection so retries feel varied but honest about being canned
  const idx = (text.length + text.charCodeAt(0)) % SIMULATED_REPLIES.length;
  return SIMULATED_REPLIES[idx];
}

/* ------------------------------------------------------------------ */

export default function Chat() {
  const { conversationId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { activeModelId, setActiveModelId, online } = usePlatform();

  // A Tauri-backed build talks to the real core; the browser build keeps the approved
  // Phase 1 demo path. The transport is resolved once (the host cannot appear mid-session).
  const transport = useMemo(() => resolveTransport(), []);
  const live = transport.kind === 'tauri';

  const [models, setModels] = useState<ModelRecord[]>([]);
  const [activeModel, setActiveModel] = useState<ModelRecord | null>(null);
  const [coreError, setCoreError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ used: number; max: number } | null>(null);
  const [engineCap, setEngineCap] = useState<number | null>(null);
  const [liveStatus, setLiveStatus] = useState<Record<string, 'loading' | 'streaming' | 'done' | 'stopped' | 'error'>>({});
  const [stopping, setStopping] = useState(false);
  const streamRef = useRef<{ conversationId: string; messageId: string } | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>(() =>
    live ? [] : MOCK_CONVERSATIONS,
  );
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [thinking, setThinking] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Handle ?new=1 from quick actions
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      const conv = newConversation(live ? activeModel?.id ?? '' : activeModelId, 'universal');
      setConversations((prev) => [conv, ...prev]);
      navigate(`/chat/${conv.id}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live core: discover what is actually on disk and pick the owner's remembered model.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void (async () => {
      const listed = await transport.call('model.list', { installedOnly: true, limit: 100 });
      if (cancelled) return;
      if (!listed.ok) {
        setCoreError(`${listed.error.code}: ${listed.error.message}`);
        return;
      }
      setModels(listed.data.items);
      const remembered = localStorage.getItem('nexus.activeModelId');
      const chosen =
        listed.data.items.find((m) => m.id === remembered) ?? listed.data.items[0] ?? null;
      setActiveModel(chosen);
      if (chosen) {
        localStorage.setItem('nexus.activeModelId', chosen.id);
        setActiveModelId(chosen.id);
        setConversations((prev) =>
          prev.length === 0
            ? [newConversation(chosen.id, 'universal')]
            : prev.map((c) => (c.modelId ? c : { ...c, modelId: chosen.id })),
        );
      }
      // The advertised window is not the window we run: the core caps it by measurement.
      const status = await transport.call('engine.status');
      if (!cancelled && status.ok && status.data.running && status.data.contextCap) {
        setEngineCap(status.data.contextCap);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [live, transport]);

  // A packaged build landing on /chat should open the conversation it created.
  useEffect(() => {
    if (live && !conversationId && conversations.length > 0) {
      navigate(`/chat/${conversations[0].id}`, { replace: true });
    }
  }, [live, conversationId, conversations, navigate]);

  // Streaming and measured context arrive as events, never as polling.
  useEffect(() => {
    if (!live) return;
    const modelId = activeModel?.id;
    const offToken = transport.subscribe('chat://token', (event: ChatTokenEvent) => {
      setConversations((prev) =>
        prev.map((conversation) => {
          if (conversation.id !== event.conversationId) return conversation;
          const index = conversation.messages.findIndex((m) => m.id === event.messageId);
          let messages = conversation.messages;
          if (index === -1) {
            messages = [
              ...conversation.messages,
              {
                id: event.messageId,
                role: 'assistant',
                content: event.delta,
                ts: new Date().toISOString(),
                modelId,
              },
            ];
          } else if (event.delta) {
            messages = conversation.messages.map((m, i) =>
              i === index ? { ...m, content: m.content + event.delta } : m,
            );
          }
          return { ...conversation, messages, updatedAt: new Date().toISOString() };
        }),
      );
      if (event.done) {
        setLiveStatus((prev) => ({
          ...prev,
          [event.messageId]: prev[event.messageId] === 'stopped' ? 'stopped' : 'done',
        }));
        setThinking(false);
        setStopping(false);
        streamRef.current = null;
      } else {
        setLiveStatus((prev) => ({ ...prev, [event.messageId]: 'streaming' }));
      }
    });
    const offUsage = transport.subscribe('chat://usage', (event: ChatUsageEvent) => {
      setUsage({ used: event.contextUsed, max: event.contextMax });
    });
    return () => {
      offToken();
      offUsage();
    };
  }, [live, transport, activeModel?.id]);

  const active = useMemo(
    () => conversations.find((c) => c.id === conversationId) ?? null,
    [conversations, conversationId],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!q) return list;
    return list.filter(
      (c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)),
    );
  }, [conversations, search]);

  // What the rail may claim: measured when the engine answered, estimated otherwise.
  const estimatedTokens = active
    ? Math.round(active.messages.reduce((sum, m) => sum + m.content.length, 0) / 4)
    : 0;
  const liveModel = live ? models.find((m) => m.id === active?.modelId) ?? activeModel : null;
  const displayModel = live
    ? liveModel?.name ?? 'No model loaded'
    : active
      ? modelName(active.modelId)
      : '—';
  const contextUsed = live && usage ? usage.used : estimatedTokens;
  const contextMax = live
    ? usage?.max ?? engineCap ?? liveModel?.contextWindow ?? 32_768
    : MOCK_MODELS.find((m) => m.id === active?.modelId)?.contextWindow ?? 32_768;
  const streamingId = streamRef.current?.messageId;

  const update = (fn: (prev: Conversation[]) => Conversation[]) => setConversations(fn);

  const mutateActive = (fn: (c: Conversation) => Conversation) => {
    if (!active) return;
    update((prev) => prev.map((c) => (c.id === active.id ? fn(c) : c)));
  };

  const scrollToEnd = (behavior: ScrollBehavior = 'smooth') => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior });
    });
  };

  useEffect(() => {
    scrollToEnd('auto');
    setShowScrollDown(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, thinking]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setShowScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 200);
  };

  const simulateReply = (userText: string) => {
    if (!active) return;
    setThinking(true);
    // Simulated latency only — nothing is generated by a model.
    setTimeout(() => {
      const reply: ChatMessage = {
        id: nextId(),
        role: 'assistant',
        content: pickReply(userText),
        ts: new Date().toISOString(),
        modelId: active.modelId,
        agentId: active.agentId,
      };
      mutateActive((c) => ({
        ...c,
        updatedAt: reply.ts,
        title: c.messages.length === 1 ? userText.slice(0, 42) || c.title : c.title,
        messages: [...c.messages, reply],
      }));
      setThinking(false);
    }, 900 + (userText.length % 5) * 180);
  };

  /** The real path: load through admission, then stream tokens from the local engine. */
  const sendLive = async (text: string, conversation: Conversation) => {
    if (!activeModel) {
      toast('No installed model was found. Put a GGUF file in the models folder.', 'error');
      return;
    }
    // `chat.send` refuses empty content, so an attachment-only turn sends the same
    // sentence the bubble shows instead of an empty string the core would reject.
    const content = text || `(attached ${attachments.map((a) => a.name).join(', ')})`;
    const userMessage: ChatMessage = {
      id: nextId(),
      role: 'user',
      content,
      ts: new Date().toISOString(),
      attachments: attachments.length ? attachments : undefined,
    };
    const messageId = `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const emptyReply: ChatMessage = {
      id: messageId,
      role: 'assistant',
      content: '',
      ts: new Date().toISOString(),
      modelId: activeModel.id,
    };
    update((prev) =>
      prev.map((c) =>
        c.id !== conversation.id
          ? c
          : {
              ...c,
              title: c.messages.length === 0 ? text.slice(0, 42) || c.title : c.title,
              messages: [...c.messages, userMessage, emptyReply],
              updatedAt: userMessage.ts,
            },
      ),
    );
    setThinking(true);
    setStopping(false);
    setUsage(null);
    setCoreError(null);
    setLiveStatus((prev) => ({ ...prev, [messageId]: 'loading' }));
    streamRef.current = { conversationId: conversation.id, messageId };

    const fail = (code: string, message: string) => {
      setCoreError(`${code}: ${message}`);
      setLiveStatus((prev) => ({ ...prev, [messageId]: 'error' }));
      update((prev) =>
        prev.map((c) =>
          c.id !== conversation.id
            ? c
            : {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === messageId ? { ...m, content: `> ${message}` } : m,
                ),
              },
        ),
      );
    };

    const loaded = await transport.call('engine.loadModel', { modelId: activeModel.id });
    if (!loaded.ok) {
      setThinking(false);
      streamRef.current = null;
      fail(loaded.error.code, loaded.error.message);
      return;
    }
    setEngineCap(loaded.data.contextCapped);
    const sent = await transport.call('chat.send', {
      conversationId: conversation.id,
      content,
      clientId: messageId,
    });
    if (!sent.ok) {
      setThinking(false);
      setStopping(false);
      streamRef.current = null;
      if (sent.error.code === 'job.cancelled') {
        setLiveStatus((prev) => ({ ...prev, [messageId]: 'stopped' }));
      } else {
        fail(sent.error.code, sent.error.message);
      }
    }
  };

  const stop = async () => {
    const streaming = streamRef.current;
    if (!streaming) return;
    setStopping(true);
    setLiveStatus((prev) => ({ ...prev, [streaming.messageId]: 'stopped' }));
    await transport.call('chat.stop', { conversationId: streaming.conversationId });
  };

  const send = () => {
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    if (!active) return;
    if (live) {
      setDraft('');
      setAttachments([]);
      void sendLive(text, active);
      return;
    }
    const msg: ChatMessage = {
      id: nextId(),
      role: 'user',
      content: text || `(attached ${attachments.map((a) => a.name).join(', ')})`,
      ts: new Date().toISOString(),
      attachments: attachments.length ? attachments : undefined,
    };
    mutateActive((c) => ({ ...c, messages: [...c.messages, msg], updatedAt: msg.ts }));
    setDraft('');
    setAttachments([]);
    simulateReply(text);
  };

  const regenerate = () => {
    if (!active) return;
    if (live) {
      toast('Regenerate is not implemented in this build (chat.regenerate lands with M2).', 'info');
      return;
    }
    const lastUser = [...active.messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    mutateActive((c) => {
      const idx = c.messages.length - 1;
      const copy = [...c.messages];
      if (copy[idx]?.role === 'assistant') copy.pop();
      return { ...c, messages: copy };
    });
    simulateReply(lastUser.content);
    toast('Regenerated a simulated reply (no model ran)', 'info');
  };

  const copyMessage = async (m: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(m.content);
    } catch {
      /* clipboard can be blocked; prototype still acknowledges */
    }
    setCopiedId(m.id);
    setTimeout(() => setCopiedId(null), 1400);
  };

  const onAttach = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const next: Attachment[] = Array.from(files).map((f) => ({
      name: f.name,
      sizeKB: Math.max(1, Math.round(f.size / 1024)),
      kind: /\.(png|jpe?g|gif|webp)$/i.test(f.name)
        ? 'image'
        : /\.pdf$/i.test(f.name)
          ? 'pdf'
          : /\.docx?$/i.test(f.name)
            ? 'docx'
            : /\.(csv|xlsx)$/i.test(f.name)
              ? 'csv'
              : 'code',
    }));
    setAttachments((prev) => [...prev, ...next].slice(0, 4));
    e.target.value = '';
    toast(
      live
        ? `${next.length} file(s) attached — only your message text is sent to the model in this build`
        : `${next.length} file(s) queued — analysis is disabled in Phase 1`,
      'info',
    );
  };

  const createConversation = () => {
    const conv = newConversation(live ? activeModel?.id ?? '' : activeModelId, 'universal');
    setConversations((prev) => [conv, ...prev]);
    navigate(`/chat/${conv.id}`);
  };

  const deleteConversation = (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (active?.id === id) navigate('/chat');
    toast('Conversation removed from prototype state', 'success');
  };

  /* ------------------------------------------------------------------ */

  return (
    <div className="flex h-full min-h-0">
      {/* Conversation list */}
      <div className="flex w-[248px] shrink-0 flex-col border-r border-surface-line bg-surface-raised/60">
        <div className="space-y-2 p-3">
          <Button variant="primary" icon={<MessageSquarePlus size={14} />} className="w-full" onClick={createConversation}>
            New conversation
          </Button>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter conversations…"
            aria-label="Filter conversations"
            className="field h-8 text-xs"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {filtered.length === 0 ? (
            <EmptyState title="No matches" description="No conversation contains that text." className="py-8" />
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => navigate(`/chat/${c.id}`)}
                className={cn(
                  'group mb-0.5 flex w-full items-start gap-2 rounded-field px-2.5 py-2 text-left',
                  active?.id === c.id ? 'bg-accent/10' : 'hover:bg-surface-line/40',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    {c.pinned && <Check size={11} className="shrink-0 text-violet" />}
                    <span className={cn('truncate text-xs font-medium', active?.id === c.id ? 'text-ink-primary' : 'text-ink-secondary')}>
                      {c.title}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-2xs text-ink-faint">
                    {c.messages.length} msg · {timeAgo(new Date(c.updatedAt))}
                  </span>
                </span>
                <Menu
                  triggerLabel={`Actions for ${c.title}`}
                  trigger={
                    <span
                      role="presentation"
                      onClick={(e) => e.stopPropagation()}
                      className="rounded p-0.5 text-ink-faint opacity-0 hover:text-ink-primary group-hover:opacity-100"
                    >
                      <MoreHorizontal size={13} />
                    </span>
                  }
                  items={
                    [
                      {
                        id: 'rename',
                        label: 'Rename',
                        onSelect: () => {
                          setRenaming(c.id);
                          setRenameValue(c.title);
                        },
                      },
                      {
                        id: 'pin',
                        label: c.pinned ? 'Unpin' : 'Pin',
                        onSelect: () =>
                          update((prev) => prev.map((x) => (x.id === c.id ? { ...x, pinned: !x.pinned } : x))),
                      },
                      { id: 'del', label: 'Delete', danger: true, icon: <Trash2 />, onSelect: () => deleteConversation(c.id) },
                    ] satisfies MenuItem[]
                  }
                />
              </button>
            ))
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!active ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<Sparkles />}
              title="Select or start a conversation"
              description={
                live
                  ? 'Answers are generated locally by the engine on this machine. Nothing leaves it.'
                  : 'NEXUS AI Chat is a UI prototype. Replies are canned simulations — no model is running.'
              }
              action={
                <Button variant="primary" icon={<MessageSquarePlus size={14} />} onClick={createConversation}>
                  New conversation
                </Button>
              }
            />
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-surface-line px-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink-primary">{active.title}</p>
                <p className="truncate text-2xs text-ink-faint">
                  {MOCK_AGENTS.find((a) => a.id === active.agentId)?.name ?? active.agentId} · {displayModel}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Select
                  aria-label="Model for this conversation"
                  className="h-8 w-[190px] text-xs"
                  value={active.modelId}
                  onChange={(e) => {
                    const id = e.target.value;
                    mutateActive((c) => ({ ...c, modelId: id }));
                    if (!live) return;
                    const chosen = models.find((m) => m.id === id) ?? null;
                    setActiveModel(chosen);
                    if (!chosen) return;
                    localStorage.setItem('nexus.activeModelId', chosen.id);
                    setActiveModelId(chosen.id);
                    toast(`Loading ${chosen.name}… first load can take 30 s`, 'info');
                    void transport.call('engine.loadModel', { modelId: chosen.id }).then((result) => {
                      if (!result.ok) setCoreError(`${result.error.code}: ${result.error.message}`);
                    });
                  }}
                  options={(live ? models : MOCK_MODELS).map((m) => ({ value: m.id, label: m.name }))}
                />
                <Select
                  aria-label="Agent for this conversation"
                  className="h-8 w-[150px] text-xs"
                  value={active.agentId}
                  onChange={(e) => mutateActive((c) => ({ ...c, agentId: e.target.value }))}
                  options={MOCK_AGENTS.map((a) => ({ value: a.id, label: a.name.replace(' NEXUS ', ' ') }))}
                />
                <Tooltip content="Conversation settings" side="bottom">
                  <IconButton label="Conversation settings" onClick={() => setSettingsOpen(true)}>
                    <Settings2 size={14} />
                  </IconButton>
                </Tooltip>
                <Tooltip content="Clear all messages in this conversation" side="bottom">
                  <IconButton label="Clear conversation" tone="danger" onClick={() => setClearConfirm(true)}>
                    <Trash2 size={14} />
                  </IconButton>
                </Tooltip>
              </div>
            </div>

            {/* Messages */}
            <div className="relative flex-1">
              <div ref={scrollRef} onScroll={onScroll} className="absolute inset-0 overflow-y-auto">
                <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
                  {!live && (
                    <DemoNotice className="mb-2" text="Assistant replies below are canned simulations, not model output." />
                  )}
                  {live && coreError && (
                    <div className="rounded-card border border-state-err/30 bg-state-err/10 px-4 py-3 text-xs text-state-err">
                      {coreError}
                    </div>
                  )}
                  {live && !activeModel && (
                    <div className="rounded-card border border-state-warn/30 bg-state-warn/10 px-4 py-3 text-xs text-ink-secondary">
                      No installed model was found in the models folder. Copy a GGUF file there, then
                      reopen this screen.
                    </div>
                  )}
                  {active.messages.length === 0 && !thinking && (
                    <EmptyState
                      title="No messages yet"
                      description={
                        live
                          ? 'The answer is generated on this machine by the local engine. The first model load can take up to 30 seconds.'
                          : 'Ask anything to see the simulated reply flow. Attachments and generation are UI demos only.'
                      }
                      className="py-16"
                    />
                  )}
                  {active.messages.map((m) => (
                    <MessageBubble
                      key={m.id}
                      message={m}
                      status={liveStatus[m.id]}
                      copied={copiedId === m.id}
                      onCopy={() => copyMessage(m)}
                      onRegenerate={m.role === 'assistant' && m === active.messages[active.messages.length - 1] ? regenerate : undefined}
                    />
                  ))}
                  {thinking && (!live || !streamingId) && (
                    <div className="flex items-center gap-2.5 rounded-card border border-surface-line bg-surface-raised px-4 py-3">
                      <Bot size={15} className="text-accent" />
                      <span className="flex items-center gap-1 text-xs text-ink-muted">
                        Generating simulated reply
                        <span className="inline-flex gap-0.5">
                          {[0, 1, 2].map((i) => (
                            <span key={i} className="h-1 w-1 animate-pulse-dot rounded-full bg-accent" style={{ animationDelay: `${i * 220}ms` }} />
                          ))}
                        </span>
                      </span>
                      <Badge tone="idle" className="ml-auto">
                        no real inference
                      </Badge>
                    </div>
                  )}
                  <div className="h-2" />
                </div>
              </div>
              {showScrollDown && (
                <button
                  aria-label="Scroll to latest message"
                  onClick={() => scrollToEnd()}
                  className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-surface-line bg-surface-overlay p-2 text-ink-secondary shadow-pop hover:text-ink-primary"
                >
                  <ArrowDown size={14} />
                </button>
              )}
            </div>

            {/* Composer */}
            <div className="shrink-0 border-t border-surface-line bg-surface-raised/50 px-4 py-3">
              <div className="mx-auto max-w-3xl">
                {attachments.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {attachments.map((a, i) => (
                      <span key={`${a.name}-${i}`} className="flex items-center gap-1.5 rounded-md border border-surface-line bg-surface-base px-2 py-1 text-2xs text-ink-secondary">
                        <Paperclip size={10} className="text-accent" />
                        <span className="max-w-[160px] truncate">{a.name}</span>
                        <span className="mono-num text-ink-faint">{a.sizeKB} KB</span>
                        <button aria-label={`Remove ${a.name}`} onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}>
                          <X size={11} className="text-ink-faint hover:text-state-err" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <Tooltip content="Attach files (UI demo — no analysis happens)" side="top">
                    <IconButton label="Attach files" onClick={() => fileRef.current?.click()}>
                      <Paperclip size={15} />
                    </IconButton>
                  </Tooltip>
                  <input ref={fileRef} type="file" multiple hidden onChange={onAttach} aria-hidden="true" />
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    rows={1}
                    placeholder="Message NEXUS… (Enter to send, Shift+Enter for newline)"
                    aria-label="Message input"
                    className="field max-h-32 min-h-[38px] flex-1 resize-none py-2.5 text-sm"
                  />
                  {live && thinking && streamingId !== undefined ? (
                    <Button
                      variant="danger"
                      icon={<Square size={12} />}
                      disabled={stopping || liveStatus[streamingId] === 'loading'}
                      onClick={() => void stop()}
                    >
                      {stopping
                        ? 'Stopping…'
                        : liveStatus[streamingId] === 'loading'
                          ? 'Loading…'
                          : 'Stop'}
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      icon={<Send size={14} />}
                      disabled={thinking || (live && !activeModel) || (!draft.trim() && attachments.length === 0)}
                      onClick={send}
                    >
                      Send
                    </Button>
                  )}
                </div>
                <p className="mt-1.5 text-center text-2xs text-ink-faint">
                  {live
                    ? `Local engine${liveModel ? ` · ${liveModel.name}` : ''} · offline · nothing leaves this machine`
                    : `${online ? 'Online (simulated)' : 'Offline mode'} · replies are simulated · nothing leaves this machine`}
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Context rail: session info */}
      <aside className="hidden w-[260px] shrink-0 overflow-y-auto border-l border-surface-line bg-surface-raised/40 2xl:block">
        {active && (
          <>
            <ContextPanelCard title={live && usage ? 'Context usage (measured)' : live ? 'Context usage (estimated)' : 'Context usage (simulated)'}>
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="mono-num text-xl font-bold text-ink-primary">{contextUsed}</span>
                  <span className="text-2xs text-ink-faint">
                    {live && usage ? 'tokens' : '≈ tokens'} / {Math.round(contextMax / 1024)}k{' '}
                    {live && !usage && !engineCap ? 'model max' : 'window'}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-line/70">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${Math.min(100, (contextUsed / contextMax) * 100)}%` }}
                  />
                </div>
                <p className="text-2xs text-ink-faint">
                  {live
                    ? usage
                      ? 'Counted by the engine in its usage frame after each answer.'
                      : 'Estimated from message length — the engine reports exact tokens when an answer completes.'
                    : 'Estimated from message length only — no tokenizer runs in Phase 1.'}
                </p>
              </div>
            </ContextPanelCard>
            <ContextPanelCard title="Conversation">
              <div className="space-y-0.5">
                <KeyValue k="Agent" v={MOCK_AGENTS.find((a) => a.id === active.agentId)?.name ?? '—'} />
                <KeyValue k="Model" v={displayModel} />
                <KeyValue k="Messages" v={String(active.messages.length)} mono />
                <KeyValue k="Updated" v={timeAgo(new Date(active.updatedAt))} />
                {live && <KeyValue k="History sent" v="latest turn only" />}
              </div>
            </ContextPanelCard>
            <ContextPanelCard title="Agents in this chat">
              <ul className="space-y-2">
                <li className="flex items-center gap-2 text-xs text-ink-secondary">
                  <Bot size={13} className="text-accent" /> {MOCK_AGENTS.find((a) => a.id === active.agentId)?.name}
                </li>
                <li className="flex items-center gap-2 text-xs text-ink-secondary">
                  <UserRound size={13} className="text-violet" /> You
                </li>
              </ul>
            </ContextPanelCard>
          </>
        )}
      </aside>

      {/* Rename dialog */}
      <Modal
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title="Rename conversation"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!renameValue.trim()}
              onClick={() => {
                update((prev) => prev.map((c) => (c.id === renaming ? { ...c, title: renameValue.trim() } : c)));
                setRenaming(null);
                toast('Conversation renamed', 'success');
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Input label="Title" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} error={!renameValue.trim() ? 'Title cannot be empty' : null} />
      </Modal>

      {/* Settings dialog */}
      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Conversation settings" subtitle="Prototype controls — they do not affect a real model">
        {active && (
          <div className="space-y-4">
            <Input label="Temperature (simulated)" type="number" min={0} max={2} step={0.1} defaultValue={0.7} hint="Stored in frontend state only." />
            <Input label="System prompt (this conversation)" defaultValue="You are NEXUS, a personal local AI assistant." hint="Simulated effect." />
            <Select
              label="Context strategy"
              options={[
                { value: 'truncate', label: 'Truncate oldest turns' },
                { value: 'summarize', label: 'Summarize older turns' },
                { value: 'rag', label: 'Retrieve from memory/KB' },
              ]}
              defaultValue="summarize"
              hint="Future backend behavior — shown here to define the UX contract."
            />
            <KeyValue k="Conversation ID" v={active.id} mono />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={clearConfirm}
        title="Clear this conversation?"
        message={
          <>
            All {active?.messages.length ?? 0} messages in <strong>{active?.title}</strong> will be removed from
            prototype state. This cannot be undone (simulated).
          </>
        }
        confirmLabel="Clear messages"
        danger
        onCancel={() => setClearConfirm(false)}
        onConfirm={() => {
          mutateActive((c) => ({ ...c, messages: [], updatedAt: new Date().toISOString() }));
          setClearConfirm(false);
          toast('Conversation cleared (frontend state only)', 'success');
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function MessageBubble({
  message,
  status,
  copied,
  onCopy,
  onRegenerate,
}: {
  message: ChatMessage;
  status?: 'loading' | 'streaming' | 'done' | 'stopped' | 'error';
  copied: boolean;
  onCopy: () => void;
  onRegenerate?: () => void;
}) {
  const isUser = message.role === 'user';
  return (
    <div className="group flex gap-3">
      <div
        className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
          isUser ? 'border-violet/30 bg-violet/10 text-violet' : 'border-accent/30 bg-accent/10 text-accent',
        )}
      >
        {isUser ? <UserRound size={14} /> : <Bot size={14} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold text-ink-secondary">{isUser ? 'You' : 'NEXUS'}</span>
          <span className="mono-num text-2xs text-ink-faint">{clockTime(new Date(message.ts))}</span>
          {!isUser && message.modelId && (
            <span className="hidden truncate text-2xs text-ink-faint sm:inline">{modelName(message.modelId)}</span>
          )}
        </div>

        {message.attachments?.map((a) => (
          <div key={a.name} className="mt-1.5 flex w-fit items-center gap-2 rounded-md border border-surface-line bg-surface-base px-2.5 py-1.5 text-2xs text-ink-secondary">
            <FileText size={12} className="text-accent" />
            {a.name}
            <span className="mono-num text-ink-faint">{a.sizeKB} KB</span>
          </div>
        ))}

        <div
          className={cn(
            'mt-1 rounded-card border px-3.5 py-2.5',
            isUser ? 'border-surface-line bg-surface-raised' : 'border-accent/15 bg-surface-raised/70',
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-primary">{message.content}</p>
          ) : (
            <>
              {status === 'loading' && !message.content ? (
                <span className="text-xs text-ink-faint">Waiting for the engine…</span>
              ) : (
                <Markdown source={message.content} />
              )}
              {status === 'streaming' && (
                <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-accent align-middle" />
              )}
            </>
          )}
        </div>

        {status === 'stopped' && (
          <p className="mt-1 text-2xs text-state-warn">Stopped — this answer is incomplete.</p>
        )}
        {status === 'error' && (
          <p className="mt-1 text-2xs text-state-err">Generation failed — see the message above.</p>
        )}

        <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <Tooltip content={copied ? 'Copied' : 'Copy message'} side="bottom" delay={100}>
            <IconButton label="Copy message" onClick={onCopy}>
              {copied ? <Check size={13} className="text-state-ok" /> : <Copy size={13} />}
            </IconButton>
          </Tooltip>
          {onRegenerate && (
            <Tooltip content="Regenerate response" side="bottom" delay={100}>
              <IconButton label="Regenerate response" onClick={onRegenerate}>
                <RefreshCw size={13} />
              </IconButton>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}
