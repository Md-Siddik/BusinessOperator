"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Check, CheckCheck, Clock, FileText, MessageSquarePlus, Paperclip, Search, Send, X } from "lucide-react";
import { CONVERSATION_STATUSES, CONVERSATION_TOPICS, PRIORITIES, UPLOAD_LIMITS } from "@/lib/constants";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { RealtimeEvent } from "@/lib/realtime";
import { formatBytes, formatDateTime, formatShortTime, humanize } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/data";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { useRealtimeEvents } from "@/components/app/live-counts";
import { useWorkspaceBase } from "@/hooks/use-workspace-base";

export type ChatMode = "client" | "internal";

export type ConversationSummary = {
  _id: string;
  subject: string;
  topic: string;
  status: string;
  priority: string;
  lastMessageAt: string;
  lastMessagePreview?: string;
  lastMessageFromClient?: boolean;
  unreadCount: number;
  organizationId?: { _id: string; name: string } | string;
  assignedTo?: { _id: string; name: string } | string | null;
  isDemo?: boolean;
};

export type ChatMessage = {
  _id: string;
  conversationId: string;
  senderId: string | null;
  senderName?: string;
  senderRole: string;
  body: string;
  system?: boolean;
  attachments: { _id: string; name: string; mimeType?: string; size?: number }[];
  readBy: string[];
  createdAt: string;
};

type Thread = { conversation: ConversationSummary & { participants?: { userId: { _id: string; name: string; role: string } | string; role: string }[] }; messages: ChatMessage[] };

const orgName = (c: ConversationSummary) => (typeof c.organizationId === "object" && c.organizationId ? c.organizationId.name : "");
const assigneeName = (c: ConversationSummary) => (typeof c.assignedTo === "object" && c.assignedTo ? c.assignedTo.name : null);
const assigneeId = (c: ConversationSummary) => (typeof c.assignedTo === "object" && c.assignedTo ? c.assignedTo._id : (c.assignedTo as string | null | undefined) ?? "");

export function ChatWorkspace({
  mode,
  me,
  initialConversations,
  staff = [],
  organizations = [],
  availability,
  canAssign = false,
  client,
  composeForClient = false,
}: {
  mode: ChatMode;
  me: { id: string; name: string };
  initialConversations: ConversationSummary[];
  staff?: { id: string; name: string }[];
  organizations?: { id: string; name: string }[];
  availability?: string;
  canAssign?: boolean;
  /** Internal inbox filtered to one client organization (?client=). */
  client?: { id: string; name: string };
  /** Open "New conversation" for that client right away (&new=1). */
  composeForClient?: boolean;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState<string | null>(search.get("c"));
  const [thread, setThread] = useState<Thread | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [clientFilter, setClientFilter] = useState(client ?? null);
  const [composerOpen, setComposerOpen] = useState(composeForClient);
  const workspaceBase = useWorkspaceBase();
  const basePath = mode === "client" ? "/portal/messages" : `${workspaceBase}/messages`;
  /** Inbox URL, keeping the client filter so a reload shows the same view. */
  const urlFor = useCallback((conversationId?: string) => {
    const params = new URLSearchParams();
    if (clientFilter) params.set("client", clientFilter.id);
    if (conversationId) params.set("c", conversationId);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }, [basePath, clientFilter]);

  const refreshList = useCallback(async (q = query, status = statusFilter) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (clientFilter) params.set("organizationId", clientFilter.id);
    try {
      setConversations(await apiFetch<ConversationSummary[]>(`/api/conversations?${params.toString()}`));
    } catch {
      /* keep the current list */
    }
  }, [query, statusFilter, clientFilter]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => void refreshList(query, statusFilter), 300);
    return () => clearTimeout(t);
  }, [query, statusFilter, refreshList]);

  const openConversation = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setLoadingThread(true);
      router.replace(urlFor(id), { scroll: false });
      try {
        const t = await apiFetch<Thread>(`/api/conversations/${id}`);
        setThread(t);
        setConversations((list) => list.map((c) => (c._id === id ? { ...c, unreadCount: 0 } : c)));
      } catch (e) {
        toast.error(e instanceof ApiError && e.status === 404 ? "Conversation not found" : "Could not open the conversation");
        setSelectedId(null);
      } finally {
        setLoadingThread(false);
      }
    },
    [urlFor, router, toast],
  );

  useEffect(() => {
    const initial = search.get("c");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deep links (?c=) open the conversation once on mount
    if (initial) void openConversation(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRealtime = useCallback(
    (event: RealtimeEvent) => {
      if (event.type === "message.created") {
        const msg = event.message as ChatMessage;
        const isMine = msg.senderId === me.id;
        setConversations((list) => {
          const existing = list.find((c) => c._id === event.conversationId);
          if (!existing) {
            void refreshList();
            return list;
          }
          const updated = {
            ...existing,
            lastMessageAt: msg.createdAt,
            lastMessagePreview: msg.body || (msg.attachments.length ? `📎 ${msg.attachments.map((a) => a.name).join(", ")}` : ""),
            unreadCount: event.conversationId === selectedId || isMine ? existing.unreadCount : existing.unreadCount + 1,
          };
          return [updated, ...list.filter((c) => c._id !== event.conversationId)];
        });
        if (event.conversationId === selectedId) {
          setThread((t) => (t && !t.messages.some((m) => m._id === msg._id) ? { ...t, messages: [...t.messages, msg] } : t));
          if (!isMine) void apiFetch(`/api/conversations/${event.conversationId}/read`, { body: {} }).catch(() => undefined);
        }
      }
      if (event.type === "message.read" && event.conversationId === selectedId && event.userId !== me.id) {
        setThread((t) => (t ? { ...t, messages: t.messages.map((m) => (m.readBy.includes(event.userId) ? m : { ...m, readBy: [...m.readBy, event.userId] })) } : t));
      }
      if (event.type === "conversation.updated") {
        const patch = event.conversation as Partial<ConversationSummary>;
        setConversations((list) => list.map((c) => (c._id === event.conversationId ? { ...c, ...patch } : c)));
        setThread((t) => (t && t.conversation._id === event.conversationId ? { ...t, conversation: { ...t.conversation, ...patch } } : t));
      }
    },
    [me.id, refreshList, selectedId],
  );
  useRealtimeEvents(onRealtime);

  const selected = thread?.conversation;
  const showList = !selectedId;

  return (
    <div className="flex h-[calc(100dvh-10.5rem)] min-h-[32rem] overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-card">
      {/* Conversation list */}
      <section aria-label="Conversations" className={cn("flex w-full flex-col border-r border-ink-200 md:w-80 md:shrink-0 lg:w-96", !showList && "hidden md:flex")}>
        <div className="space-y-3 border-b border-ink-100 p-3">
          <div className="flex gap-2">
            <label className="relative flex-1">
              <span className="sr-only">Search conversations</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={mode === "internal" ? "Search client, company, text, topic" : "Search conversations"} className="h-9 pl-9" />
            </label>
            <Button size="icon" onClick={() => setComposerOpen(true)} aria-label="New conversation" title="New conversation">
              <MessageSquarePlus className="h-4 w-4" />
            </Button>
          </div>
          {mode === "internal" && (
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status" className="text-xs">
              <option value="">All statuses</option>
              {CONVERSATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
          )}
          {clientFilter && (
            <p className="flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs text-brand-800">
              <span className="min-w-0 truncate">
                Client: <span className="font-semibold">{clientFilter.name}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setClientFilter(null);
                  router.replace(selectedId ? `${basePath}?c=${selectedId}` : basePath, { scroll: false });
                }}
                className="shrink-0 rounded p-0.5 hover:bg-brand-100"
                aria-label="Show all clients"
                title="Show all clients"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </p>
          )}
        </div>
        <ul className="scroll-thin flex-1 overflow-y-auto">
          {conversations.length === 0 && <li className="px-4 py-10 text-center text-sm text-ink-500">No conversations yet.</li>}
          {conversations.map((c) => (
            <li key={c._id}>
              <button
                type="button"
                onClick={() => void openConversation(c._id)}
                aria-current={selectedId === c._id ? "true" : undefined}
                className={cn("flex w-full gap-3 border-b border-ink-50 px-4 py-3 text-left transition-colors hover:bg-ink-50", selectedId === c._id && "bg-brand-50/70 hover:bg-brand-50")}
              >
                <Avatar name={mode === "internal" ? orgName(c) : c.subject} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={cn("truncate text-sm", c.unreadCount ? "font-semibold text-ink-900" : "font-medium text-ink-800")}>{mode === "internal" ? orgName(c) || c.subject : c.subject}</span>
                    <time className="shrink-0 text-[11px] text-ink-400" dateTime={c.lastMessageAt}>
                      {formatShortTime(c.lastMessageAt)}
                    </time>
                  </span>
                  {mode === "internal" && <span className="block truncate text-xs text-ink-600">{c.subject}</span>}
                  <span className="flex items-center justify-between gap-2">
                    <span className={cn("truncate text-xs", c.unreadCount ? "text-ink-800" : "text-ink-500")}>{c.lastMessagePreview}</span>
                    {c.unreadCount > 0 && (
                      <span className="shrink-0 rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold leading-5 text-white" aria-label={`${c.unreadCount} unread`}>
                        {c.unreadCount}
                      </span>
                    )}
                  </span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-1">
                    <StatusBadge status={c.status} />
                    {c.priority !== "NORMAL" && <StatusBadge status={c.priority} />}
                    {mode === "internal" && <span className="text-[11px] text-ink-400">{assigneeName(c) ?? "Unassigned"}</span>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Thread */}
      <section aria-label="Conversation" className={cn("flex min-w-0 flex-1 flex-col", showList && "hidden md:flex")}>
        {!selectedId ? (
          <EmptyState className="m-auto" icon={MessageSquarePlus} title="Select a conversation" description={availability ?? "Choose a conversation or start a new one."} action={<Button onClick={() => setComposerOpen(true)}>New conversation</Button>} />
        ) : loadingThread || !selected ? (
          <div className="m-auto">
            <Spinner className="h-6 w-6 text-brand-600" label="Loading conversation" />
          </div>
        ) : (
          <ThreadView
            key={selected._id}
            mode={mode}
            me={me}
            thread={thread!}
            staff={staff}
            canAssign={canAssign}
            availability={availability}
            onBack={() => {
              setSelectedId(null);
              setThread(null);
              router.replace(urlFor(), { scroll: false });
            }}
            onSent={(msg) => setThread((t) => (t && !t.messages.some((m) => m._id === msg._id) ? { ...t, messages: [...t.messages, msg] } : t))}
            onUpdated={(patch) => {
              setThread((t) => (t ? { ...t, conversation: { ...t.conversation, ...patch } } : t));
              setConversations((list) => list.map((c) => (c._id === selected._id ? { ...c, ...patch } : c)));
            }}
          />
        )}
      </section>

      <NewConversationModal
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        mode={mode}
        organizations={organizations}
        defaultOrganizationId={clientFilter?.id}
        onCreated={(id) => {
          setComposerOpen(false);
          void refreshList().then(() => openConversation(id));
        }}
      />
    </div>
  );
}

function ThreadView({
  mode,
  me,
  thread,
  staff,
  canAssign,
  availability,
  onBack,
  onSent,
  onUpdated,
}: {
  mode: ChatMode;
  me: { id: string; name: string };
  thread: Thread;
  staff: { id: string; name: string }[];
  canAssign: boolean;
  availability?: string;
  onBack: () => void;
  onSent: (m: ChatMessage) => void;
  onUpdated: (patch: Partial<ConversationSummary>) => void;
}) {
  const toast = useToast();
  const c = thread.conversation;
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [thread.messages.length]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!body.trim() && !files.length) return;
    setSending(true);
    try {
      let msg: ChatMessage;
      if (files.length) {
        const fd = new FormData();
        fd.set("body", body);
        files.forEach((f) => fd.append("files", f));
        msg = await apiFetch<ChatMessage>(`/api/conversations/${c._id}/messages`, { formData: fd });
      } else {
        msg = await apiFetch<ChatMessage>(`/api/conversations/${c._id}/messages`, { body: { body } });
      }
      onSent(msg);
      setBody("");
      setFiles([]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Message not sent");
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

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files, ...Array.from(list)].slice(0, UPLOAD_LIMITS.maxFilesPerMessage);
    const tooBig = next.find((f) => f.size > UPLOAD_LIMITS.maxBytes);
    if (tooBig) {
      toast.error(`${tooBig.name} is larger than 10 MB`);
      return;
    }
    setFiles(next);
  }

  async function update(patch: Record<string, unknown>) {
    try {
      await apiFetch(`/api/conversations/${c._id}`, { method: "PATCH", body: patch });
      const assigned = "assignedTo" in patch ? staff.find((s) => s.id === patch.assignedTo) : undefined;
      onUpdated({ ...patch, ...("assignedTo" in patch && { assignedTo: assigned ? { _id: assigned.id, name: assigned.name } : null }) } as Partial<ConversationSummary>);
      toast.success("Conversation updated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-4 py-3">
        <button type="button" onClick={onBack} className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 md:hidden" aria-label="Back to conversations">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-ink-900">{c.subject}</h2>
          <p className="truncate text-xs text-ink-500">
            {mode === "internal" && `${orgName(c)} · `}
            {humanize(c.topic)}
            {mode === "client" && availability && ` · ${availability}`}
          </p>
        </div>
        {mode === "internal" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={c.status} onChange={(e) => void update({ status: e.target.value })} aria-label="Status" className="w-40 text-xs">
              {CONVERSATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
            <Select value={c.priority} onChange={(e) => void update({ priority: e.target.value })} aria-label="Priority" className="w-28 text-xs">
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {humanize(p)}
                </option>
              ))}
            </Select>
            {canAssign && (
              <Select value={assigneeId(c)} onChange={(e) => void update({ assignedTo: e.target.value || null })} aria-label="Assigned to" className="w-40 text-xs">
                <option value="">Unassigned</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <StatusBadge status={c.status} />
            {c.status !== "CLOSED" && (
              <Button size="xs" variant="ghost" onClick={() => void update({ status: "CLOSED" })}>
                Close
              </Button>
            )}
          </div>
        )}
      </header>

      <div ref={scrollRef} className="scroll-thin flex-1 space-y-3 overflow-y-auto bg-ink-50/50 px-4 py-5" aria-live="polite" aria-relevant="additions">
        {thread.messages.map((m, i) => {
          const mine = m.senderId === me.id;
          const prev = thread.messages[i - 1];
          const showName = !mine && !m.system && prev?.senderId !== m.senderId;
          if (m.system) {
            return (
              <div key={m._id} className="flex justify-center">
                <p className="max-w-md rounded-xl bg-white px-4 py-2 text-center text-xs text-ink-500 ring-1 ring-ink-200">
                  <Clock className="mr-1 inline h-3 w-3" aria-hidden /> {m.body}
                </p>
              </div>
            );
          }
          const seen = mine && m.readBy.some((id) => id !== me.id);
          return (
            <div key={m._id} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
              {showName && (
                <p className="mb-1 px-1 text-xs text-ink-500">
                  {m.senderName ?? "Team"}
                  {m.senderRole !== "CLIENT" && mode === "client" && <span className="ml-1 text-brand-600">· ExploreTechify</span>}
                </p>
              )}
              <div className={cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-soft sm:max-w-[70%]", mine ? "rounded-br-md bg-brand-600 text-white" : "rounded-bl-md bg-white text-ink-800 ring-1 ring-ink-200")}>
                {m.body && <p className="whitespace-pre-wrap break-words leading-relaxed">{m.body}</p>}
                {m.attachments.length > 0 && (
                  <ul className={cn("space-y-1.5", m.body && "mt-2")}>
                    {m.attachments.map((a) => (
                      <li key={a._id}>
                        <a href={`/api/conversations/${c._id}/attachments/${a._id}`} target="_blank" rel="noopener noreferrer" className={cn("flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs", mine ? "bg-white/15 hover:bg-white/25" : "bg-ink-50 hover:bg-ink-100")}>
                          <FileText className="h-4 w-4 shrink-0" aria-hidden />
                          <span className="truncate">{a.name}</span>
                          {a.size ? <span className="shrink-0 opacity-70">{formatBytes(a.size)}</span> : null}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="mt-1 flex items-center gap-1 px-1 text-[11px] text-ink-400">
                <time dateTime={m.createdAt} title={formatDateTime(m.createdAt)}>
                  {formatShortTime(m.createdAt)}
                </time>
                {mine && (seen ? <CheckCheck className="h-3.5 w-3.5 text-brand-500" aria-label="Seen" /> : <Check className="h-3.5 w-3.5" aria-label="Sent" />)}
              </p>
            </div>
          );
        })}
      </div>

      <form onSubmit={send} className="border-t border-ink-100 p-3">
        {files.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-2">
            {files.map((f, i) => (
              <li key={i} className="flex items-center gap-1.5 rounded-lg bg-ink-100 px-2.5 py-1 text-xs text-ink-700">
                <Paperclip className="h-3.5 w-3.5" aria-hidden /> {f.name}
                <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="text-ink-400 hover:text-ink-700">
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <input ref={fileRef} type="file" multiple hidden accept={UPLOAD_LIMITS.allowedExtensions.join(",")} onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }} />
          <Button type="button" variant="ghost" size="icon" onClick={() => fileRef.current?.click()} aria-label="Attach files" title="Attach (images, PDF, documents · max 10 MB)">
            <Paperclip className="h-4 w-4" />
          </Button>
          <label className="flex-1">
            <span className="sr-only">Message</span>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={onKeyDown} rows={1} placeholder="Type a message… (Enter to send, Shift+Enter for a new line)" className="max-h-40 min-h-10 resize-none py-2" maxLength={10_000} />
          </label>
          <Button type="submit" loading={sending} disabled={!body.trim() && !files.length} aria-label="Send">
            {!sending && <Send className="h-4 w-4" aria-hidden />} <span className="hidden sm:inline">Send</span>
          </Button>
        </div>
      </form>
    </>
  );
}

function NewConversationModal({ open, onClose, mode, organizations, defaultOrganizationId, onCreated }: { open: boolean; onClose: () => void; mode: ChatMode; organizations: { id: string; name: string }[]; defaultOrganizationId?: string; onCreated: (id: string) => void }) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setErrors({});
    try {
      const res = await apiFetch<{ conversationId: string }>("/api/conversations", { formData: new FormData(e.currentTarget) });
      (e.target as HTMLFormElement).reset();
      onCreated(res.conversationId);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors ?? {});
        toast.error(err.message);
      }
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="New conversation" description={mode === "client" ? "Our team will reply here. You'll get a notification when they do." : "Start a conversation with a client organization."}>
      <form onSubmit={submit} className="space-y-4">
        {mode === "internal" && (
          <Field label="Client" error={errors.organizationId}>
            {(p) => (
              <Select {...p} key={defaultOrganizationId ?? "any"} name="organizationId" required defaultValue={defaultOrganizationId}>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <Field label="Subject" error={errors.subject}>
            {(p) => <Input {...p} name="subject" required maxLength={200} />}
          </Field>
          <Field label="Topic" error={errors.topic}>
            {(p) => (
              <Select {...p} name="topic" defaultValue="GENERAL">
                {CONVERSATION_TOPICS.map((t) => (
                  <option key={t} value={t}>
                    {humanize(t)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Message" error={errors.body}>
          {(p) => <Textarea {...p} name="body" rows={5} required maxLength={10_000} />}
        </Field>
        <Field label="Attachments" optional="optional" hint="Images, PDF, Word, Excel, PowerPoint, text — up to 10 MB each, max 5 files.">
          {(p) => <input {...p} type="file" name="files" multiple accept={UPLOAD_LIMITS.allowedExtensions.join(",")} className="block w-full text-sm text-ink-600 file:mr-3 file:rounded-lg file:border-0 file:bg-ink-100 file:px-3 file:py-2 file:text-sm file:font-medium" />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            Send
          </Button>
        </div>
      </form>
    </Modal>
  );
}

