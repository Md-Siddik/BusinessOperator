import { EmailMessage } from "@/models";
import { absoluteUrl, siteConfig } from "@/config/site";
import { defaultFromAddress, getEmailProvider } from "./provider";
import { textToHtml } from "./render";

/**
 * Transactional email — account, ticket and chat notifications. Kept strictly
 * separate from outreach: no campaign, no approval queue, no marketing content.
 */
type TransactionalInput = { to: string; toName?: string; subject: string; text: string; sensitive?: boolean };

export async function sendTransactionalEmail(input: TransactionalInput) {
  const provider = getEmailProvider();
  const from = defaultFromAddress();
  const record = await EmailMessage.create({
    kind: "TRANSACTIONAL",
    to: input.to,
    toName: input.toName,
    from,
    subject: input.subject,
    body: input.sensitive ? "[Security message redacted]" : input.text,
    status: "APPROVED",
    provider: provider.id,
    simulated: !provider.isLive,
  });
  try {
    const result = await provider.send({
      to: input.to,
      toName: input.toName,
      from,
      fromName: siteConfig.name,
      subject: input.subject,
      text: input.text,
      html: textToHtml(input.text),
    });
    await EmailMessage.updateOne({ _id: record._id }, { status: "SENT", sentAt: new Date(), providerMessageId: result.id });
    return { accepted: provider.isLive, simulated: !provider.isLive };
  } catch (err) {
    console.error("[email] transactional send failed", err);
    await EmailMessage.updateOne({ _id: record._id }, { status: "FAILED", error: String(err).slice(0, 500) });
    return { accepted: false, simulated: !provider.isLive };
  }
}

const sign = `\n\n— ${siteConfig.name}\n${siteConfig.tagline}`;

export const transactionalTemplates = {
  signupReceived: (name: string) => ({
    subject: `We received your ${siteConfig.name} account request`,
    text: `Hi ${name},\n\nThanks for creating an account. Our team reviews every new account before activation — we'll email you as soon as your workspace is ready.${sign}`,
  }),
  accountApproved: (name: string) => ({
    subject: `Your ${siteConfig.name} workspace is ready`,
    text: `Hi ${name},\n\nYour account has been approved. You can now sign in to your client workspace:\n${absoluteUrl("/login")}${sign}`,
  }),
  passwordReset: (name: string, url: string) => ({
    subject: "Reset your password",
    text: `Hi ${name},\n\nUse the link below to choose a new password. It expires in one hour.\n${url}\n\nIf you didn't request this, you can ignore this email.${sign}`,
  }),
  newSignupForStaff: (company: string, email: string) => ({
    subject: `New client signup: ${company}`,
    text: `${company} (${email}) created a client account and is awaiting approval.\n\nReview: ${absoluteUrl("/dashboard/clients?status=PENDING_APPROVAL")}`,
  }),
  newClientMessageForStaff: (company: string, subject: string, conversationId: string) => ({
    subject: `New message from ${company}`,
    text: `${company} sent a message in "${subject}".\n\nOpen the inbox: ${absoluteUrl(`/dashboard/messages?c=${conversationId}`)}`,
  }),
  newReplyForClient: (name: string, subject: string, conversationId: string) => ({
    subject: `New reply: ${subject}`,
    text: `Hi ${name},\n\nOur team replied to your conversation "${subject}".\n\nRead it in your workspace: ${absoluteUrl(`/portal/messages?c=${conversationId}`)}${sign}`,
  }),
  ticketUpdated: (name: string, number: number, title: string, status: string, kind: string) => ({
    subject: `${kind === "REQUEST" ? "Request" : "Ticket"} #${number} updated`,
    text: `Hi ${name},\n\n"${title}" is now: ${status.replace(/_/g, " ").toLowerCase()}.\n\nView it in your workspace: ${absoluteUrl(kind === "REQUEST" ? "/portal/requests" : "/portal/tickets")}${sign}`,
  }),
};
