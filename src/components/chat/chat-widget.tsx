"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { usePathname } from "next/navigation";
import { Loader2, MessageCircle, Send, X } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useRealtime } from "@/hooks/use-realtime";
import type { RealtimeEvent } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { DEFAULT_CHAT_LABELS, type ChatWidgetLabels } from "./chat-widget-labels";

/**
 * Floating chat (bottom-right) for clients. Messaging requires an account:
 * anonymous visitors are asked to sign up or log in. Signed-in clients (including
 * accounts awaiting approval) chat with the team in real time over the existing
 * conversation API and the server-sent event stream. Availability is the configured
 * working-hours text — never a fake "online" indicator.
 */
type Session =
  | { state: "anonymous"; availability: { text: string; withinHours: boolean } }
  | { state: "team"; name: string; inboxHref: string; availability: { text: string; withinHours: boolean } }
  | { state: "client"; id: string; name: string; pending: boolean; availability: { text: string; withinHours: boolean } };

type Msg = { _id: string; conversationId: string; senderId: string | null; senderName?: string; senderRole: string; body: string; system?: boolean; createdAt: string };
type ConversationRow = { _id: string; status: string; lastMessageAt: string };

const WIDGET_SUBJECT = "Website chat";
/** Auth pages already are the signup / login step — the floating button would only cover the form. */
const AUTH_PAGE_RE = /^(\/[a-z]{2})?\/(login|signup|forgot-password|reset-password)\/?$/;

export function ChatWidget({ labels = DEFAULT_CHAT_LABELS, signupHref = "/signup", loginHref = "/login", inboxHref = "/portal/messages" }: { labels?: ChatWidgetLabels; signupHref?: string; loginHref?: string; inboxHref?: string }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
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

  // Who is visiting (cheap; tells the button whether to show an unread badge).
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

  const isClient = session?.state === "client";

  const refreshUnread = useCallback(() => {
    fetch("/api/messages/unread", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { messages: number } | null) => d && setUnread(d.messages))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
     
    if (isClient) refreshUnread();
  }, [isClient, refreshUnread]);

  // Load (or find) the client's chat when the panel opens.
  const loadThread = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await apiFetch<ConversationRow[]>("/api/conversations?limit=20");
      const current = list.find((c) => c.status !== "CLOSED") ?? list[0];
      if (current) {
        const thread = await apiFetch<{ messages: Msg[] }>(`/api/conversations/${current._id}`);
        setConversationId(current._id);
        setMessages(thread.messages);
        setUnread(0);
      } else {
        setConversationId(null);
        setMessages([]);
      }
    } catch {
      setError(labels.error);
    } finally {
      setLoading(false);
    }
  }, [labels.error]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch the thread when the panel opens
    if (open && isClient) void loadThread();
  }, [open, isClient, loadThread]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, isClient]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open]);

  // Realtime: new replies appear instantly; the badge counts them while the panel is closed.
  const onEvent = useCallback(
    (event: RealtimeEvent) => {
      if (event.type !== "message.created" || session?.state !== "client") return;
      const msg = event.message as Msg;
      if (msg.senderId === session.id) return;
      if (open && event.conversationId === conversationId) {
        setMessages((list) => (list.some((m) => m._id === msg._id) ? list : [...list, msg]));
        void fetch(`/api/conversations/${event.conversationId}/read`, { method: "POST", credentials: "same-origin" }).catch(() => undefined);
      } else if (open && !conversationId) {
        void loadThread();
      } else {
        refreshUnread();
      }
    },
    [session, open, conversationId, loadThread, refreshUnread],
  );
  useRealtime(onEvent, isClient);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      if (conversationId) {
        const msg = await apiFetch<Msg>(`/api/conversations/${conversationId}/messages`, { body: { body } });
        setMessages((list) => (list.some((m) => m._id === msg._id) ? list : [...list, msg]));
      } else {
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
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={labels.title}
          className="flex max-h-[min(36rem,calc(100dvh-7rem))] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-lifted sm:w-[380px]"
        >
          <header className="flex items-start justify-between gap-3 bg-ink-900 px-4 py-3 text-white">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{labels.title}</p>
              {session && <p className="mt-0.5 text-xs text-white/70">{session.availability.text}</p>}
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
              <p className="text-base font-semibold text-ink-900">{labels.signupTitle}</p>
              <p className="text-sm leading-relaxed text-ink-600">{labels.signupText}</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <a href={signupHref} className="inline-flex h-10 flex-1 items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
                  {labels.signup}
                </a>
                <a href={loginHref} className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-ink-200 px-4 text-sm font-semibold text-ink-800 hover:bg-ink-50">
                  {labels.login}
                </a>
              </div>
            </div>
          ) : session.state === "team" ? (
            <div className="space-y-4 p-5">
              <p className="text-sm leading-relaxed text-ink-600">{labels.teamText}</p>
              <a href={session.inboxHref} className="inline-flex h-10 items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
                {labels.openInbox}
              </a>
            </div>
          ) : (
            <>
              {session.pending && <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">{labels.pending}</p>}
              <div ref={listRef} className="scroll-thin flex-1 space-y-2 overflow-y-auto bg-ink-50/60 px-3 py-3" aria-live="polite">
                {loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-ink-400" aria-hidden />
                  </div>
                ) : messages.length === 0 ? (
                  <p className="px-2 py-8 text-center text-sm text-ink-500">{labels.empty}</p>
                ) : (
                  messages.map((m) => {
                    const mine = m.senderId === session.id;
                    return (
                      <div key={m._id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                        <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm", mine ? "rounded-br-md bg-brand-600 text-white" : m.system ? "bg-white text-ink-600 ring-1 ring-ink-200" : "rounded-bl-md bg-white text-ink-800 ring-1 ring-ink-200")}>
                          {!mine && <p className="mb-0.5 text-[11px] font-semibold text-ink-500">{m.senderName ?? labels.team}</p>}
                          <p className="whitespace-pre-wrap break-words">{m.body}</p>
                          <p className={cn("mt-1 text-right text-[10px]", mine ? "text-white/70" : "text-ink-400")}>{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
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
                {!session.pending && (
                  <a href={inboxHref} className="mt-2 block px-1 text-xs text-brand-700 hover:underline">
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
        aria-label={open ? labels.close : labels.open}
        className="relative inline-flex h-14 items-center gap-2 rounded-full bg-brand-600 px-5 text-sm font-semibold text-white shadow-lifted transition-colors hover:bg-brand-700 focus-visible:outline-offset-4"
      >
        {open ? <X className="h-5 w-5" aria-hidden /> : <MessageCircle className="h-5 w-5" aria-hidden />}
        <span className="hidden sm:inline">{open ? labels.close : labels.open}</span>
        {!open && unread > 0 && (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1.5 text-center text-[11px] font-bold leading-5 text-white" aria-label={`${unread} unread`}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}
