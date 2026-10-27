/**
 * Email deliverability checks.
 *   npm run email:check                         → SPF / DKIM / DMARC of the sending domain (DNS only, sends nothing)
 *   npm run email:check -- --send a@x.com b@y.com → also send the real verification-code email (test code)
 *                                                  through the configured provider to these inboxes
 * Then look in each inbox (Gmail: "Show original" → SPF/DKIM/DMARC = PASS; note Primary / Promotions / Spam).
 * No database is used and no account is touched.
 */
import { loadEnvConfig } from "@next/env";
import { randomInt } from "node:crypto";

loadEnvConfig(process.cwd());

async function main() {
  const args = process.argv.slice(2);
  const { checkSenderDomain, verificationEmail } = await import("../src/lib/email/deliverability");
  const { defaultFromAddress, emailProviderSetupProblems, getEmailProvider, providerSenderIdentity } = await import("../src/lib/email/provider");
  const from = defaultFromAddress();
  const identity = providerSenderIdentity();
  console.info(`Provider: ${process.env.EMAIL_PROVIDER || "console"} · From: ${identity?.name ? `${identity.name} <${from}>` : from}`);
  for (const p of emailProviderSetupProblems()) console.warn(`  ⚠ ${p}`);
  if (identity?.name && /[_]|\s{2,}/.test(identity.name)) console.warn(`  ⚠ Display name "${identity.name}" contains underscores — use a plain name such as "ExploreTechify" (EMAIL_FROM_NAME).`);
  const report = await checkSenderDomain(from);
  console.info(`\nDomain ${report.domain}`);
  for (const c of report.checks) {
    console.info(`  ${c.status === "pass" ? "✅" : c.status === "warn" ? "⚠️ " : c.status === "missing" ? "❌" : "❔"} ${c.name}: ${c.detail}${c.found ? `\n       found: ${c.found}` : ""}${c.fix ? `\n       fix:   ${c.fix}` : ""}`);
  }

  const sendIdx = args.indexOf("--send");
  if (sendIdx < 0) return;
  const to = args.slice(sendIdx + 1).filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
  if (!to.length) throw new Error("Give at least one address after --send.");
  const provider = getEmailProvider();
  if (!provider.isLive) throw new Error("EMAIL_PROVIDER is console — nothing would be delivered.");
  const { randomUUID } = await import("node:crypto");
  for (const address of to) {
    const mail = verificationEmail({ code: String(randomInt(100000, 1000000)), purpose: "VERIFY", name: null });
    try {
      const r = await provider.send({ to: address, from, fromName: "ExploreTechify", subject: mail.subject, text: mail.text, html: mail.html, replyTo: process.env.EMAIL_REPLY_TO || undefined, headers: { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All", "X-Entity-Ref-ID": randomUUID() } });
      console.info(`\n📨 ${address}: accepted by the provider (id ${r.id}). Check the inbox and note the folder.`);
    } catch (err) {
      console.error(`\n❌ ${address}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
