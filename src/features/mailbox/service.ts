import "server-only";
import type { Types } from "mongoose";
import type { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import { Checkpoint, Company, ContactRequest, Organization, User } from "@/models";
import { imapErrorMessage, withInbox, zohoImapConfig } from "@/lib/email/imap";
import { isOwner, type Actor } from "@/lib/permissions";
import { AppError, Errors } from "@/lib/errors";
import { notifyUsers } from "@/features/notifications/service";

/**
 * Client Mail — OWNER ONLY. Reads the Zoho INBOX live over IMAP; message bodies are
 * never stored. The worker polls for new mail and notifies the Owner (CLIENT_EMAIL).
 */

export type Address = { name?: string; address: string };
/** Who the sender is to us, matched by email address. */
export type SenderMatch = { kind: "CLIENT" | "COMPANY" | "ENQUIRY"; label: string; href: string };
export type MailSummary = { uid: number; from?: Address; subject: string; date?: string; seen: boolean; hasAttachments: boolean; sender?: SenderMatch };
export type MailAttachment = { index: number; filename: string; contentType: string; size: number };
export type MailMessage = {
  uid: number;
  from?: Address;
  to: Address[];
  cc: Address[];
  replyTo?: Address;
  subject: string;
  date?: string;
  text?: string;
  html?: string;
  attachments: MailAttachment[];
  sender?: SenderMatch;
};

function assertOwner(actor: Actor | null | undefined): asserts actor is Actor {
  if (!actor) throw Errors.unauthorized();
  if (!isOwner(actor)) throw Errors.forbidden();
}

export function mailboxStatus() {
  const { config, problems } = zohoImapConfig();
  return { configured: !!config, address: config?.user, problems };
}

function requireConfig() {
  const { config, problems } = zohoImapConfig();
  if (!config) throw Errors.badRequest(problems.join(" "));
  return config;
}

async function read<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const config = requireConfig();
  try {
    return await withInbox(config, fn);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw Errors.badRequest(imapErrorMessage(err));
  }
}

function addresses(value: AddressObject | AddressObject[] | undefined): Address[] {
  return (Array.isArray(value) ? value : value ? [value] : []).flatMap((a) => a.value).filter((a) => a.address).map((a) => ({ name: a.name || undefined, address: a.address!.toLowerCase() }));
}

/** Matches sender addresses to client accounts, registry companies and website enquiries (in that order). */
export async function matchSenders(emails: string[]): Promise<Map<string, SenderMatch>> {
  const list = [...new Set(emails.map((e) => e.toLowerCase()).filter(Boolean))];
  const out = new Map<string, SenderMatch>();
  if (!list.length) return out;
  const [users, companies, enquiries] = await Promise.all([
    User.find({ email: { $in: list }, role: "CLIENT" }).select("email name organizationId").lean<{ email: string; name: string; organizationId?: Types.ObjectId }[]>(),
    Company.find({ email: { $in: list } }).select("email companyName countryCode").lean<{ _id: Types.ObjectId; email: string; companyName: string; countryCode: string }[]>(),
    ContactRequest.find({ email: { $in: list } }).select("email name company").sort({ createdAt: -1 }).lean<{ email: string; name: string; company?: string }[]>(),
  ]);
  const orgs = await Organization.find({ _id: { $in: users.map((u) => u.organizationId).filter(Boolean) } }).select("name").lean<{ _id: Types.ObjectId; name: string }[]>();
  const orgName = new Map(orgs.map((o) => [String(o._id), o.name]));
  for (const e of enquiries) if (!out.has(e.email)) out.set(e.email, { kind: "ENQUIRY", label: e.company || e.name, href: "/dashboard/clients?tab=inquiries" });
  for (const c of companies) out.set(c.email, { kind: "COMPANY", label: c.companyName, href: `/dashboard/companies/${c.countryCode.toLowerCase()}/${c._id}` });
  for (const u of users) {
    const org = u.organizationId ? String(u.organizationId) : null;
    out.set(u.email, { kind: "CLIENT", label: (org && orgName.get(org)) || u.name, href: org ? `/dashboard/clients/${org}` : "/dashboard/clients" });
  }
  return out;
}

/** Newest first, one page of INBOX headers. */
export async function listMailbox(actor: Actor, opts: { page?: number; pageSize?: number } = {}) {
  assertOwner(actor);
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = opts.pageSize ?? 25;
  const { total, items } = await read(async (client) => {
    const total = client.mailbox ? client.mailbox.exists : 0;
    const end = total - (page - 1) * pageSize;
    const items: MailSummary[] = [];
    if (end >= 1) {
      const start = Math.max(1, end - pageSize + 1);
      for await (const m of client.fetch(`${start}:${end}`, { uid: true, envelope: true, flags: true, bodyStructure: true })) {
        const from = m.envelope?.from?.[0];
        items.push({
          uid: m.uid,
          from: from?.address ? { name: from.name || undefined, address: from.address.toLowerCase() } : undefined,
          subject: m.envelope?.subject || "(no subject)",
          date: m.envelope?.date ? new Date(m.envelope.date).toISOString() : undefined,
          seen: !!m.flags?.has("\\Seen"),
          hasAttachments: JSON.stringify(m.bodyStructure ?? {}).includes('"disposition":"attachment"'),
        });
      }
    }
    return { total, items: items.reverse() };
  });
  const matches = await matchSenders(items.map((i) => i.from?.address ?? ""));
  for (const i of items) i.sender = i.from ? matches.get(i.from.address) : undefined;
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

async function fetchParsed(uid: number) {
  if (!Number.isInteger(uid) || uid <= 0) throw Errors.notFound();
  return read(async (client) => {
    const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
    if (!msg || !msg.source) throw Errors.notFound();
    await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
    return simpleParser(msg.source);
  });
}

/** One message; opening it marks it read in Zoho too. */
export async function getMail(actor: Actor, uid: number): Promise<MailMessage> {
  assertOwner(actor);
  const p = await fetchParsed(uid);
  const from = addresses(p.from)[0];
  const sender = from ? (await matchSenders([from.address])).get(from.address) : undefined;
  return {
    uid,
    from,
    to: addresses(p.to),
    cc: addresses(p.cc),
    replyTo: addresses(p.replyTo)[0],
    subject: p.subject || "(no subject)",
    date: p.date?.toISOString(),
    text: p.text,
    html: typeof p.html === "string" ? p.html : undefined,
    attachments: p.attachments.filter((a) => !a.related).map((a, index) => ({ index, filename: a.filename || `attachment-${index + 1}`, contentType: a.contentType, size: a.size })),
    sender,
  };
}

export async function getMailAttachment(actor: Actor, uid: number, index: number) {
  assertOwner(actor);
  const p = await fetchParsed(uid);
  const a = p.attachments.filter((x) => !x.related)[index];
  if (!a) throw Errors.notFound();
  return { filename: a.filename || `attachment-${index + 1}`, contentType: a.contentType || "application/octet-stream", content: a.content };
}

/* ───────────── New-mail notifications (worker) ───────────── */

const CHECKPOINT = "mailbox:INBOX";
const POLL_MS = Number(process.env.MAILBOX_POLL_MS || 60_000);
const g = globalThis as unknown as { __etMailboxPolledAt?: number };

/**
 * Notifies the Owner about mail that arrived since the last check. The first run
 * (or a UIDVALIDITY change) only records the position, so old mail never floods in.
 */
export async function pollMailbox(log: (m: string) => void = () => undefined) {
  if (process.env.MAILBOX_POLL === "off") return;
  const { config } = zohoImapConfig();
  if (!config) return;
  if (g.__etMailboxPolledAt && Date.now() - g.__etMailboxPolledAt < POLL_MS) return;
  g.__etMailboxPolledAt = Date.now();

  const own = new Set([config.user, process.env.EMAIL_FROM_ADDRESS ?? ""].map((e) => e.trim().toLowerCase()));
  const saved = await Checkpoint.findOne({ key: CHECKPOINT }).lean<{ value: string }>();
  const [savedValidity, savedUid] = (saved?.value ?? "").split(":");

  const { validity, lastUid, fresh } = await withInbox(config, async (client) => {
    const box = client.mailbox;
    if (!box) return { validity: "", lastUid: 0, fresh: [] as MailSummary[] };
    const validity = String(box.uidValidity);
    const lastUid = Math.max(0, Number(box.uidNext) - 1);
    if (validity !== savedValidity || !savedUid) return { validity, lastUid, fresh: [] as MailSummary[] };
    const after = Number(savedUid);
    const fresh: MailSummary[] = [];
    if (lastUid > after) {
      for await (const m of client.fetch(`${after + 1}:*`, { uid: true, envelope: true }, { uid: true })) {
        const from = m.envelope?.from?.[0];
        // "n:*" always returns the newest message, even when it is older than n.
        if (m.uid <= after || !from?.address || own.has(from.address.toLowerCase())) continue;
        fresh.push({ uid: m.uid, from: { name: from.name || undefined, address: from.address.toLowerCase() }, subject: m.envelope?.subject || "(no subject)", seen: false, hasAttachments: false });
      }
    }
    return { validity, lastUid: Math.max(lastUid, after), fresh };
  });

  if (fresh.length) {
    const owners = (await User.find({ role: "OWNER", status: "ACTIVE" }).select("_id").lean<{ _id: Types.ObjectId }[]>()).map((u) => String(u._id));
    const matches = await matchSenders(fresh.map((m) => m.from!.address));
    for (const m of fresh.slice(-20)) {
      const match = matches.get(m.from!.address);
      const who = match?.label ?? m.from!.name ?? m.from!.address;
      await notifyUsers(owners, {
        type: "CLIENT_EMAIL",
        title: match?.kind === "CLIENT" ? `Client email from ${who}` : `New email from ${who}`,
        body: m.subject.slice(0, 200),
        link: `/dashboard/mailbox/${m.uid}`,
      });
    }
    log(`${fresh.length} new email(s)`);
  }
  if (validity) await Checkpoint.updateOne({ key: CHECKPOINT }, { $set: { value: `${validity}:${lastUid}` } }, { upsert: true });
}
