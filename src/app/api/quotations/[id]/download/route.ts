import { route } from "@/lib/api/handler";
import { audit } from "@/lib/audit";
import { getQuotation, renderQuotationHtml } from "@/features/quotations/service";
import { getSetting } from "@/features/settings/service";

type P = { id: string };

/** Download the quotation as a self-contained HTML document (print → PDF). Nothing is sent. */
export const GET = route<P>({ internal: true, permission: "companies.read" }, async ({ actor, params }) => {
  const { quotation, company } = await getQuotation(actor, params.id);
  const general = await getSetting("general");
  const html = renderQuotationHtml(quotation, company, { companyName: general.companyName, contactEmail: general.contactEmail, address: general.address });
  await audit(actor, "quotation.downloaded", { entityType: "Quotation", entityId: params.id });
  const name = `quotation-${quotation.number}-${company.companyName.replace(/[^\w]+/g, "-").toLowerCase()}.html`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } });
});
