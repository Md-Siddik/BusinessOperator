import "server-only";
import { Types } from "mongoose";
import { z } from "zod";
import { Company, Contact, CrmActivity, Quotation, ServicePackage, nextSequence, type CompanyDoc, type ContactDoc, type QuotationDoc, type ServicePackageDoc } from "@/models";
import { QUOTATION_STATUSES } from "@/models/Quotation";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { can, isInternal, type Actor } from "@/lib/permissions";
import { parseObjectId } from "@/lib/validation";
import { canManageLead } from "@/features/companies/service";
import { isDirectChannel } from "@/features/research/contacts";
import { checkSuppression } from "@/features/outreach/suppression";
import { getSetting } from "@/features/settings/service";

/**
 * Quotation drafts for MANUAL communication — never sent by the system.
 *  - only confirmed company details and an eligible, usable recipient contact
 *  - prices only from the owner-approved package; missing values stay explicit placeholders
 */

function assertAccess(actor: Actor) {
  if (!isInternal(actor) || !can(actor, "companies.read")) throw Errors.forbidden();
}

/** Contacts that may be chosen as quotation recipients (eligibility + suppression + usability). */
export async function eligibleRecipients(company: CompanyDoc) {
  if (company.eligibility?.status !== "CLEARED" || company.marketingProtected) return [];
  const contacts = await Contact.find({ companyId: company._id, type: { $in: ["EMAIL", "PHONE", "MOBILE"] } }).lean<ContactDoc[]>();
  const out: ContactDoc[] = [];
  for (const c of contacts.filter(isDirectChannel)) {
    if (c.type === "EMAIL" && (await checkSuppression(c.value)).suppressed) continue;
    out.push(c);
  }
  return out;
}

const createSchema = z.object({ packageId: z.string().optional(), recipientContactId: z.string().optional() });

export async function createQuotation(actor: Actor, companyId: string, input: unknown) {
  assertAccess(actor);
  const d = createSchema.parse(input);
  const company = await Company.findById(parseObjectId(companyId)).lean<CompanyDoc>();
  if (!company) throw Errors.notFound();
  if (!canManageLead(actor, company)) throw Errors.forbidden("This lead is assigned to someone else.");
  const pkg = d.packageId ? await ServicePackage.findById(parseObjectId(d.packageId)).lean<ServicePackageDoc>() : null;
  const recipients = await eligibleRecipients(company);
  const recipient = d.recipientContactId ? recipients.find((r) => String(r._id) === d.recipientContactId) : undefined;
  if (d.recipientContactId && !recipient) throw Errors.badRequest("That contact is not an eligible recipient (eligibility review, suppression or verification).");
  const general = await getSetting("general");
  const q = await Quotation.create({
    number: await nextSequence("quotation"),
    companyId: company._id,
    countryCode: company.countryCode,
    packageId: pkg?._id,
    title: pkg ? `${pkg.name} — ${company.companyName}` : `Proposal — ${company.companyName}`,
    recipient: recipient ? { contactId: recipient._id, name: recipient.personName ?? company.contactPerson?.name ?? undefined, email: recipient.type === "EMAIL" ? recipient.value : undefined, phone: recipient.type !== "EMAIL" ? recipient.value : undefined } : {},
    currency: pkg?.currency ?? "EUR",
    items: (pkg?.lineItems ?? []).map((li) => ({ description: li.description ?? "", quantity: li.quantity ?? 1, unitPrice: li.unitPrice ?? null, unit: li.unit })),
    deliverables: pkg?.deliverables ?? [],
    timeline: pkg?.timeline,
    terms: pkg?.terms,
    validUntil: new Date(Date.now() + 30 * 86_400_000),
    notes: `Prepared by ${actor.name}, ${general.companyName}.`,
    status: "DRAFT",
    createdBy: actor.id,
  });
  if (["NEW", "RESEARCHING", "CONTACT_AVAILABLE", "QUALIFIED"].includes(company.lead?.stage ?? "NEW")) {
    await Company.updateOne({ _id: company._id }, { $set: { "lead.stage": "QUOTATION_DRAFTED", "lead.stageChangedAt": new Date(), "lead.saved": true } });
  }
  await CrmActivity.create({ companyId: company._id, countryCode: company.countryCode, type: "SYSTEM", body: `Quotation #${q.number} drafted${pkg ? ` (${pkg.name})` : ""}`, actorId: actor.id });
  await audit(actor, "quotation.created", { entityType: "Quotation", entityId: String(q._id), countryCode: company.countryCode });
  return q.toObject();
}

const updateSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  recipientContactId: z.string().nullable().optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  items: z.array(z.object({ description: z.string().trim().min(1).max(300), quantity: z.number().min(0).max(100_000), unitPrice: z.number().min(0).max(100_000_000).nullable(), unit: z.string().trim().max(30).optional() })).max(30).optional(),
  deliverables: z.array(z.string().trim().max(300)).max(30).optional(),
  timeline: z.string().trim().max(200).optional(),
  terms: z.string().trim().max(5000).optional(),
  validUntil: z.coerce.date().optional(),
  notes: z.string().trim().max(3000).optional(),
  status: z.enum(QUOTATION_STATUSES).optional(),
});

export async function getQuotation(actor: Actor, id: string) {
  assertAccess(actor);
  const q = await Quotation.findById(parseObjectId(id)).lean<QuotationDoc>();
  if (!q) throw Errors.notFound();
  const company = await Company.findById(q.companyId).lean<CompanyDoc>();
  if (!company) throw Errors.notFound();
  const recipients = await eligibleRecipients(company);
  return { quotation: q, company, recipients };
}

export async function updateQuotation(actor: Actor, id: string, input: unknown) {
  assertAccess(actor);
  const d = updateSchema.parse(input);
  const q = await Quotation.findById(parseObjectId(id)).lean<QuotationDoc>();
  if (!q) throw Errors.notFound();
  const company = await Company.findById(q.companyId).lean<CompanyDoc>();
  if (!company || !canManageLead(actor, company)) throw Errors.forbidden();
  const set: Record<string, unknown> = { ...d };
  delete set.recipientContactId;
  if (d.recipientContactId !== undefined) {
    if (d.recipientContactId === null) set.recipient = {};
    else {
      const r = (await eligibleRecipients(company)).find((x) => String(x._id) === d.recipientContactId);
      if (!r) throw Errors.badRequest("That contact is not an eligible recipient.");
      set.recipient = { contactId: r._id, name: r.personName ?? company.contactPerson?.name, email: r.type === "EMAIL" ? r.value : undefined, phone: r.type !== "EMAIL" ? r.value : undefined };
    }
  }
  if (d.status === "READY" || d.status === "SHARED_MANUALLY") {
    const items = d.items ?? q.items;
    if (items.some((i) => i.unitPrice === null || i.unitPrice === undefined)) throw Errors.badRequest("Fill in every price (owner-approved) before marking the quotation ready.");
  }
  await Quotation.updateOne({ _id: q._id }, { $set: set });
  if (d.status === "SHARED_MANUALLY") await CrmActivity.create({ companyId: q.companyId, countryCode: q.countryCode, type: "SYSTEM", body: `Quotation #${q.number} marked as shared manually`, actorId: actor.id });
  await audit(actor, "quotation.updated", { entityType: "Quotation", entityId: id, metadata: { fields: Object.keys(d) } });
  return Quotation.findById(q._id).lean<QuotationDoc>();
}

export async function listQuotations(actor: Actor, opts: { companyId?: string } = {}) {
  assertAccess(actor);
  return Quotation.find(opts.companyId ? { companyId: new Types.ObjectId(opts.companyId) } : {})
    .sort({ createdAt: -1 })
    .limit(200)
    .populate("companyId", "companyName countryCode")
    .lean<(QuotationDoc & { companyId: { _id: Types.ObjectId; companyName: string; countryCode: string } | null })[]>();
}

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Self-contained HTML document (print → PDF from the browser). Placeholders stay visible. */
export function renderQuotationHtml(q: QuotationDoc, company: CompanyDoc, from: { companyName: string; contactEmail?: string; address?: string }) {
  const money = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: q.currency || "EUR" }).format(n);
  const rows = q.items
    .map((i) => {
      const total = i.unitPrice === null || i.unitPrice === undefined ? null : (i.quantity ?? 1) * i.unitPrice;
      return `<tr><td>${esc(i.description)}</td><td class="n">${esc(i.quantity ?? 1)} ${esc(i.unit ?? "")}</td><td class="n">${i.unitPrice === null || i.unitPrice === undefined ? '<span class="ph">[price to be confirmed]</span>' : money(i.unitPrice)}</td><td class="n">${total === null ? '<span class="ph">—</span>' : money(total)}</td></tr>`;
    })
    .join("");
  const known = q.items.filter((i) => i.unitPrice !== null && i.unitPrice !== undefined);
  const sum = known.reduce((a, i) => a + (i.quantity ?? 1) * (i.unitPrice ?? 0), 0);
  const incomplete = known.length !== q.items.length;
  const addr = [company.address, [company.postalCode, company.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quotation #${esc(q.number)} — ${esc(company.companyName)}</title>
<style>body{font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#121722;max-width:800px;margin:40px auto;padding:0 24px}h1{font-size:22px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border-bottom:1px solid #dfe3ea;padding:8px;text-align:left;vertical-align:top}.n{text-align:right;white-space:nowrap}.ph{color:#b45309;font-style:italic}.muted{color:#6b7588}.box{border:1px solid #dfe3ea;border-radius:8px;padding:12px 16px;margin:16px 0}@media print{.noprint{display:none}}</style></head><body>
<p class="noprint muted">Draft for manual sending — print or save as PDF. Not sent by ExploreTechify.</p>
<h1>${esc(q.title)}</h1><p class="muted">Quotation #${esc(q.number)} · ${esc(new Date(q.createdAt).toISOString().slice(0, 10))}${q.validUntil ? ` · valid until ${esc(new Date(q.validUntil).toISOString().slice(0, 10))}` : ""}</p>
<div class="box"><strong>To</strong><br>${esc(company.companyName)}${company.registrationNumber ? ` (${esc(company.registrationNumber)})` : ""}<br>${esc(addr)}${q.recipient?.name ? `<br>Attn: ${esc(q.recipient.name)}` : ""}${q.recipient?.email ? `<br>${esc(q.recipient.email)}` : ""}${q.recipient?.phone ? `<br>${esc(q.recipient.phone)}` : ""}</div>
<div class="box"><strong>From</strong><br>${esc(from.companyName)}${from.address ? `<br>${esc(from.address)}` : ""}${from.contactEmail ? `<br>${esc(from.contactEmail)}` : ""}</div>
<table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">Total</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="ph">[line items to be added]</td></tr>'}</tbody>
<tfoot><tr><th colspan="3" class="n">Total${incomplete ? " (excluding unpriced items)" : ""}</th><th class="n">${money(sum)}</th></tr></tfoot></table>
${q.deliverables.length ? `<h2>Deliverables</h2><ul>${q.deliverables.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
<h2>Timeline</h2><p>${q.timeline ? esc(q.timeline) : '<span class="ph">[timeline to be confirmed]</span>'}</p>
<h2>Terms</h2><p>${q.terms ? esc(q.terms).replace(/\n/g, "<br>") : '<span class="ph">[terms to be confirmed]</span>'}</p>
${q.notes ? `<p class="muted">${esc(q.notes)}</p>` : ""}</body></html>`;
}
