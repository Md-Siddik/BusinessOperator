"use client";
import { QuickAuth } from "@/components/site/quick-auth";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { usePathname } from "next/navigation";
import { ArrowLeft, Loader2, MessageCircle, Send, X } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useRealtime } from "@/hooks/use-realtime";
import type { RealtimeEvent } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { DEFAULT_CHAT_LABELS, type ChatWidgetLabels } from "./chat-widget-labels";

/**
 * Floating live chat (bottom-right). Messaging requires an account:
 *  - anonymous visitors are asked to sign up or log in
 *  - clients (including accounts awaiting approval) chat with the team in one thread
 *  - team members (owner / admin / staff) see client conversations and answer them in place
 * Live: new messages arrive instantly over the server-sent event stream; a light polling
 * fallback keeps the chat live even if a proxy or host blocks the stream.
 * Availability is the configured working-hours text — never a fake "online" indicator.
 */

type Availability = { text: string; withinHours: boolean };
type Session =
  | { state: "anonymous"; availability: Availability }
  | { state: "team"; id: string; name: string; inboxHref: string; availability: Availability }
  | { state: "client"; id: string; name: string; pending: boolean; availability: Availability };

type Msg = { _id: string; conversationId: string; senderId: string | null; senderName?: string; senderRole: string; body: string; system?: boolean; createdAt: string };
type ConversationRow = {
  _id: string;
  subject: string;
  status: string;
  lastMessageAt: string;
  lastMessagePreview?: string;
  lastMessageFromClient?: boolean;
  unreadCount: number;
  organizationId?: { _id: string; name: string } | string;
};

const WIDGET_SUBJECT = "Website chat";
/** Auth pages already are the signup / login step — the floating button would only cover the form. */
const AUTH_PAGE_RE = /^(\/[a-z]{2})?\/(login|signup|forgot-password|reset-password)\/?$/;
/** Polling fallback (the event stream is the primary, instant channel). */
const POLL_OPEN_MS = 4_000;
const POLL_CLOSED_MS = 20_000;

const orgName = (c: ConversationRow) => (typeof c.organizationId === "object" && c.organizationId ? c.organizationId.name : "Client");
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const mergeMessages = (current: Msg[], incoming: Msg[]) => {
  const byId = new Map(current.map((m) => [m._id, m]));
  for (const m of incoming) byId.set(m._id, m);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};

export function ChatWidget({ labels = DEFAULT_CHAT_LABELS, inboxHref = "/portal/messages" }: { labels?: ChatWidgetLabels; signupHref?: string; loginHref?: string; inboxHref?: string }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelId = "et-chat-panel";
  const hideOnAuthPage = AUTH_PAGE_RE.test(usePathname() ?? "");

  const signedIn = session?.state === "client" || session?.state === "team";
  const isTeam = session?.state === "team";
  const myId = signedIn ? session.id : null;

  // Who is visiting (cheap; decides the mode and whether to show an unread badge).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/chat/session", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: Session | null) => {
        if (!cancelled && s) setSession(s);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshUnread = useCallback(() => {
    fetch("/api/messages/unread", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { messages: number } | null) => d && setUnread(d.messages))
      .catch(() => undefined);
  }, []);

  const loadList = useCallback(async () => {
    const list = await apiFetch<ConversationRow[]>("/api/conversations?limit=30");
    setConversations(list);
    return list;
  }, []);

  /** Load one thread (also marks it read on the server). `quiet` = background refresh. */
  const loadThread = useCallback(async (id: string, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const thread = await apiFetch<{ messages: Msg[] }>(`/api/conversations/${id}`);
      setConversationId(id);
      setMessages((current) => (quiet ? mergeMessages(current, thread.messages) : thread.messages));
      setConversations((list) => list.map((c) => (c._id === id ? { ...c, unreadCount: 0 } : c)));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  // Opening the panel: clients go straight to their thread, team members see the conversation list.
  const openPanel = useCallback(async () => {
    if (!signedIn) return;
    setError(null);
    try {
      if (isTeam) {
        setLoading(true);
        await loadList();
        setLoading(false);
      } else {
        const list = await loadList();
        const current = list.find((c) => c.status !== "CLOSED") ?? list[0];
        if (current) await loadThread(current._id);
        else {
          setConversationId(null);
          setMessages([]);
        }
      }
      refreshUnread();
    } catch {
      setLoading(false);
      setError(labels.error);
    }
  }, [signedIn, isTeam, loadList, loadThread, refreshUnread, labels.error]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load data when the panel opens / the visitor is known
    if (open) void openPanel();
  }, [open, openPanel]);

  useEffect(() => {
     
    if (signedIn) refreshUnread();
  }, [signedIn, refreshUnread]);

  useEffect(() => {
    if (open && (conversationId || !isTeam)) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, conversationId, isTeam]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open]);

  // Instant channel: server-sent events.
  const onEvent = useCallback(
    (event: RealtimeEvent) => {
      if (event.type !== "message.created" || !myId) return;
      const msg = event.message as Msg;
      if (open && event.conversationId === conversationId) {
        setMessages((list) => mergeMessages(list, [msg]));
        if (msg.senderId !== myId) void fetch(`/api/conversations/${event.conversationId}/read`, { method: "POST", credentials: "same-origin" }).catch(() => undefined);
      } else if (open && (isTeam || !conversationId)) {
        void loadList().catch(() => undefined);
      }
      if (msg.senderId !== myId) refreshUnread();
    },
    [myId, open, conversationId, isTeam, loadList, refreshUnread],
  );
  useRealtime(onEvent, signedIn);

  // Fallback channel: polling keeps the chat live even if the event stream is blocked.
  useEffect(() => {
    if (!signedIn) return;
    const tick = () => {
      if (document.visibilityState === "hidden") return;
      if (!open) return refreshUnread();
      if (conversationId) void loadThread(conversationId, true).catch(() => undefined);
      else void loadList().catch(() => undefined);
    };
    const timer = setInterval(tick, open ? POLL_OPEN_MS : POLL_CLOSED_MS);
    return () => clearInterval(timer);
  }, [signedIn, open, conversationId, loadThread, loadList, refreshUnread]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      if (conversationId) {
        const msg = await apiFetch<Msg>(`/api/conversations/${conversationId}/messages`, { body: { body } });
        setMessages((list) => mergeMessages(list, [msg]));
      } else if (!isTeam) {
        const form = new FormData();
        form.set("subject", WIDGET_SUBJECT);
        form.set("topic", "GENERAL");
        form.set("body", body);
        const res = await apiFetch<{ conversationId: string; message: Msg }>("/api/conversations", { formData: form });
        setConversationId(res.conversationId);
        setMessages([res.message]);
      }
      setText("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : labels.error);
      if (err instanceof ApiError && err.status === 401) {
        setMessages([]); setConversationId(null);
        void fetch("/api/chat/session", { credentials: "same-origin", cache: "no-store" }).then((r) => r.json()).then(setSession).catch(() => undefined);
        window.dispatchEvent(new Event("auth-changed"));
      }
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open]);

  if (hideOnAuthPage) return null;

  const activeConversation = conversations.find((c) => c._id === conversationId);
  const showThread = session?.state === "client" || (isTeam && !!conversationId);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {open && (
        <div id={panelId} role="dialog" aria-label={labels.title} className="flex max-h-[min(36rem,calc(100dvh-7rem))] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-lifted sm:w-[380px]">
          <header className="flex items-start justify-between gap-3 bg-ink-900 px-4 py-3 text-white">
            <div className="flex min-w-0 items-start gap-2">
              {isTeam && conversationId && (
                <button
                  type="button"
                  onClick={() => {
                    setConversationId(null);
                    setMessages([]);
                    void loadList().catch(() => undefined);
                  }}
                  className="-ml-1 mt-0.5 rounded-lg p-1 text-white/80 hover:bg-white/10 hover:text-white"
                  aria-label={labels.back}
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                </button>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{isTeam ? (activeConversation ? orgName(activeConversation) : labels.teamTitle) : labels.title}</p>
                {session && <p className="mt-0.5 truncate text-xs text-white/70">{isTeam && activeConversation ? activeConversation.subject : session.availability.text}</p>}
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-white/80 hover:bg-white/10 hover:text-white" aria-label={labels.close}>
              <X className="h-4 w-4" aria-hidden />
            </button>
          </header>

          {!session ? (
            <div className="flex flex-1 items-center justify-center p-8">
              <Loader2 className="h-5 w-5 animate-spin text-ink-400" aria-hidden />
            </div>
          ) : session.state === "anonymous" ? (
            <div className="space-y-4 p-5">
              <QuickAuth onComplete={() => {
                void fetch("/api/chat/session", { credentials: "same-origin", cache: "no-store" })
                  .then((r) => r.json()).then(setSession).catch(() => setError(labels.error));
              }} />
              <label className="block text-sm text-ink-600">Draft message
                <textarea value={text} maxLength={10000} onChange={(e) => setText(e.target.value)} className="mt-1 w-full rounded-lg border border-ink-200 p-2" />
              </label>
            </div>
          ) : !showThread ? (
            // Team: conversation list
            <>
              <div className="scroll-thin flex-1 overflow-y-auto">
                {loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-ink-400" aria-hidden />
                  </div>
                ) : conversations.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-ink-500">{labels.noConversations}</p>
                ) : (
                  <ul className="divide-y divide-ink-100">
                    {conversations.map((c) => (
                      <li key={c._id}>
                        <button type="button" onClick={() => void loadThread(c._id).catch(() => setError(labels.error))} className="block w-full px-4 py-3 text-left hover:bg-ink-50">
                          <div className="flex items-center justify-between gap-2">
                            <span className={cn("truncate text-sm", c.unreadCount ? "font-semibold text-ink-900" : "font-medium text-ink-800")}>{orgName(c)}</span>
                            <span className="flex shrink-0 items-center gap-1.5">
                              <span className="text-[11px] text-ink-400">{timeOf(c.lastMessageAt)}</span>
                              {c.unreadCount > 0 && <span className="min-w-5 rounded-full bg-brand-600 px-1.5 text-center text-[11px] font-bold leading-5 text-white">{c.unreadCount}</span>}
                            </span>
                          </div>
                          <p className="truncate text-xs text-ink-500">{c.subject}</p>
                          {c.lastMessagePreview && <p className={cn("truncate text-xs", c.lastMessageFromClient && c.status !== "CLOSED" ? "text-ink-800" : "text-ink-500")}>{c.lastMessagePreview}</p>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="border-t border-ink-200 px-4 py-2.5">
                {error && (
                  <p className="mb-1 text-xs text-red-600" role="alert">
                    {error}
                  </p>
                )}
                <a href={session.inboxHref} className="text-xs font-medium text-brand-700 hover:underline">
                  {labels.fullInbox}
                </a>
              </div>
            </>
          ) : (
            // Thread (client's own conversation, or the conversation a team member opened)
            <>
              {session.state === "client" && session.pending && <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">{labels.pending}</p>}
              <div ref={listRef} className="scroll-thin flex-1 space-y-2 overflow-y-auto bg-ink-50/60 px-3 py-3" aria-live="polite">
                {loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-ink-400" aria-hidden />
                  </div>
                ) : messages.length === 0 ? (
                  <p className="px-2 py-8 text-center text-sm text-ink-500">{labels.empty}</p>
                ) : (
                  messages.map((m) => {
                    const mine = m.senderId === myId;
                    return (
                      <div key={m._id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                        <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm", mine ? "rounded-br-md bg-brand-600 text-white" : m.system ? "bg-white text-ink-600 ring-1 ring-ink-200" : "rounded-bl-md bg-white text-ink-800 ring-1 ring-ink-200")}>
                          {!mine && <p className="mb-0.5 text-[11px] font-semibold text-ink-500">{m.senderName ?? labels.team}</p>}
                          <p className="whitespace-pre-wrap break-words">{m.body}</p>
                          <p className={cn("mt-1 text-right text-[10px]", mine ? "text-white/70" : "text-ink-400")}>{timeOf(m.createdAt)}</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <form onSubmit={send} className="border-t border-ink-200 bg-white p-2.5">
                {error && (
                  <p className="mb-2 px-1 text-xs text-red-600" role="alert">
                    {error}
                  </p>
                )}
                <div className="flex items-end gap-2">
                  <label htmlFor="et-chat-input" className="sr-only">
                    {labels.placeholder}
                  </label>
                  <textarea
                    id="et-chat-input"
                    ref={inputRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={onKeyDown}
                    rows={1}
                    maxLength={10_000}
                    placeholder={labels.placeholder}
                    className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-100"
                  />
                  <button type="submit" disabled={!text.trim() || sending} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50" aria-label={labels.send}>
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                  </button>
                </div>
                {(session.state === "team" || !session.pending) && (
                  <a href={session.state === "team" ? `${session.inboxHref}${conversationId ? `?c=${conversationId}` : ""}` : inboxHref} className="mt-2 block px-1 text-xs text-brand-700 hover:underline">
                    {labels.fullInbox}
                  </a>
                )}
              </form>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? labels.close : isTeam ? "Message" : labels.open}
        className="relative inline-flex h-14 items-center gap-2 rounded-full bg-brand-600 px-5 text-sm font-semibold text-white shadow-lifted transition-colors hover:bg-brand-700 focus-visible:outline-offset-4"
      >
        {open ? <X className="h-5 w-5" aria-hidden /> : <MessageCircle className="h-5 w-5" aria-hidden />}
        <span className="hidden sm:inline">{open ? labels.close : isTeam ? "Message" : labels.open}</span>
        {!open && unread > 0 && (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1.5 text-center text-[11px] font-bold leading-5 text-white" aria-label={`${unread} unread`}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}
