import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { getPublicContext } from "@/features/site/context";
import { siteConfig } from "@/config/site";

export default async function MarketingLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { t, enabledLanguages, general } = await getPublicContext(locale);
  const labels = {
    home: t("nav.home"),
    services: t("nav.services"),
    howWeWork: t("nav.howWeWork"),
    about: t("nav.about"),
    work: t("nav.work"),
    contact: t("nav.contact"),
    clientLogin: t("nav.clientLogin"),
    cta: t("cta.letsWorkTogether"),
    language: t("nav.language"),
    openMenu: t("nav.openMenu"),
    closeMenu: t("nav.closeMenu"),
    mainNavigation: t("nav.mainNavigation"),
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
      <SiteHeader locale={locale} labels={labels} enabledLanguages={enabledLanguages} />
      <main id="main">{children}</main>
      <SiteFooter locale={locale} t={t} general={general} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd).replace(/</g, "\\u003c") }} />
    </>
  );
}
