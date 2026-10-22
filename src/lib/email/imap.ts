import "server-only";
import { ImapFlow } from "imapflow";

/**
 * Read access to the Zoho mailbox (ZOHO_SMTP_USER) over IMAP, for the Owner's
 * Client Mail page and new-email notifications. Reuses the SMTP credentials by
 * default; IMAP access must be enabled in Zoho Mail → Settings → Mail Accounts → IMAP.
 *
 *   ZOHO_IMAP_HOST     default: ZOHO_SMTP_HOST with "smtp" → "imap" (smtp.zoho.eu → imap.zoho.eu)
 *   ZOHO_IMAP_PORT     default 993 (SSL)
 *   ZOHO_IMAP_USER     default ZOHO_SMTP_USER
 *   ZOHO_IMAP_PASSWORD default ZOHO_SMTP_PASSWORD
 */
export type ImapConfig = { host: string; port: number; user: string; password: string };

export function zohoImapConfig(env: Record<string, string | undefined> = process.env): { config?: ImapConfig; problems: string[] } {
  const v = (name: string) => env[name]?.trim() ?? "";
  const host = v("ZOHO_IMAP_HOST") || v("ZOHO_SMTP_HOST").replace(/^smtp/i, "imap");
  const port = Number(v("ZOHO_IMAP_PORT") || 993);
  const user = v("ZOHO_IMAP_USER") || v("ZOHO_SMTP_USER");
  const password = env.ZOHO_IMAP_PASSWORD || env.ZOHO_SMTP_PASSWORD || "";
  const problems: string[] = [];
  if (!host) problems.push("Missing on the server: ZOHO_IMAP_HOST (or ZOHO_SMTP_HOST).");
  if (!user || !password) problems.push("Missing on the server: ZOHO_SMTP_USER / ZOHO_SMTP_PASSWORD (or ZOHO_IMAP_USER / ZOHO_IMAP_PASSWORD).");
  if (!Number.isInteger(port) || port <= 0) problems.push("ZOHO_IMAP_PORT must be a port number (993 for SSL).");
  if (host && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) problems.push("ZOHO_IMAP_HOST must be a hostname only (no scheme or port).");
  if (problems.length) return { problems };
  return { config: { host, port, user, password }, problems: [] };
}

/**
 * Maps an IMAP failure to a message safe to show — never server text or credentials.
 */
export function imapErrorMessage(err: unknown): string {
  const e = err as { authenticationFailed?: boolean; code?: string; responseStatus?: string };
  if (e?.authenticationFailed || e?.responseStatus === "NO") return "Zoho refused the sign-in. Check the mailbox password (use an application-specific password if 2FA is on) and that IMAP access is enabled in Zoho Mail settings.";
  if (e?.code === "ENOTFOUND" || e?.code === "ECONNREFUSED") return "Could not reach the IMAP server. Check ZOHO_IMAP_HOST for your Zoho data centre.";
  if (e?.code === "ETIMEDOUT" || e?.code === "ETIMEOUT") return "The IMAP server did not answer in time. Try again shortly.";
  return "Could not read the mailbox right now. Try again shortly.";
}

/** Opens a connection, runs `fn` with INBOX locked, and always logs out. */
export async function withInbox<T>(config: ImapConfig, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.password },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
  // A dropped socket emits "error"; without a listener it would crash the process.
  client.on("error", () => undefined);
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      return await fn(client);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}
