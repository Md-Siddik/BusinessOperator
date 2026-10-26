import { Suspense, type ReactNode } from "react";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/token";
import { SessionHeader } from "@/components/site/session-header";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { getPublicContext } from "@/features/site/context";
import { siteConfig } from "@/config/site";
import { listPublicServices } from "@/features/service-catalog/service";

export default async function MarketingLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Missing/expired cookies need no database or browser request.
  const payload = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  const { t, enabledLanguages, general } = await getPublicContext(locale);
  // Footer: featured services first, then the rest, at most six (the full list is one click away).
  const services = await listPublicServices(locale);
  const footerServices = [...services.filter((s) => s.featured), ...services.filter((s) => !s.featured)].slice(0, 6).map((s) => ({ slug: s.slug, name: s.shortTitle || s.name }));
  const labels = {
    home: t("nav.home"),
    services: t("nav.services"),
    howWeWork: t("nav.howWeWork"),
    about: t("nav.about"),
    contact: t("nav.contact"),
    clientLogin: t("nav.clientLogin"),
    signup: t("nav.signup"),
    cta: t("cta.letsWorkTogether"),
    language: t("nav.language"),
    openMenu: t("nav.openMenu"),
    closeMenu: t("nav.closeMenu"),
    mainNavigation: t("nav.mainNavigation"),
    theme: { label: t("theme.label"), dark: t("theme.dark"), light: t("theme.light"), mixed: t("theme.mixed") },
  };
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: general.companyName,
    url: siteConfig.url,
    email: general.contactEmail,
    slogan: general.tagline,
    description: t("meta.siteDescription"),
    sameAs: Object.values(general.social).filter(Boolean),
  };
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-lifted">
        {t("nav.skipToContent")}
      </a>
      {payload ? (
        <Suspense fallback={<SiteHeader locale={locale} labels={labels} enabledLanguages={enabledLanguages} initialAuth={{ kind: "unresolved" }} />}>
          <SessionHeader locale={locale} labels={labels} enabledLanguages={enabledLanguages} />
        </Suspense>
      ) : <SiteHeader locale={locale} labels={labels} enabledLanguages={enabledLanguages} initialAuth={{ kind: "signed-out" }} />}
      <main id="main">{children}</main>
      <SiteFooter locale={locale} t={t} general={general} services={footerServices} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd).replace(/</g, "\\u003c") }} />
    </>
  );
}
