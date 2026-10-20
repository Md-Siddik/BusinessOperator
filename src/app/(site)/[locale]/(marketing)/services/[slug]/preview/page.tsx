import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getActor } from "@/lib/auth/session";
import { isStaffMember } from "@/lib/permissions";
import { getPublicContext } from "@/features/site/context";
import { listCaseStudiesForServices } from "@/features/content/service";
import { getPreviewService, listPublicServices } from "@/features/service-catalog/service";
import { ServiceLanding } from "@/components/site/service-landing";

type Params = { params: Promise<{ locale: string; slug: string }> };

/** Always rendered per request for the signed-in editor; never cached, never indexed. */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

/**
 * Service preview (Service Management → Preview): the real landing page, including inactive
 * drafts, for users with `services.manage` only. Everyone else gets a 404 — the preview never
 * reveals that a draft exists.
 */
export default async function ServicePreviewPage({ params }: Params) {
  const { locale, slug } = await params;
  const actor = await getActor();
  const service = await getPreviewService(actor, slug, locale);
  if (!service) notFound();
  const { t } = await getPublicContext(locale);
  const [cases, all] = await Promise.all([listCaseStudiesForServices(service.portfolioServices, locale), listPublicServices(locale)]);
  const related = service.related.map((s) => all.find((x) => x.slug === s)).filter((x): x is NonNullable<typeof x> => !!x);
  const base = isStaffMember(actor) ? "/staff" : "/dashboard";
  return <ServiceLanding service={service} related={related} locale={locale} t={t} cases={cases} preview editHref={service.id ? `${base}/service-management/${service.id}` : `${base}/service-management`} />;
}
