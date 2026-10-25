import Link from "next/link";
import { CookieSettingsButton } from "./site-analytics";
import { Mail, Phone } from "lucide-react";
import { localizedPath } from "@/config/languages";
import { siteConfig } from "@/config/site";
import type { Translator } from "@/lib/i18n/translator";
import type { SettingValue } from "@/features/settings/schemas";
import { Logo } from "./logo";
import { SocialSection } from "./social-section";

/** Services come from Service Management (featured first); the full list is one click away. */
export function SiteFooter({ locale, t, general, services = [] }: { locale: string; t: Translator["t"]; general: SettingValue<"general">; services?: { slug: string; name: string }[] }) {
  const lp = (p: string) => localizedPath(locale, p);
  const year = new Date().getFullYear();
  return (
    <footer className="bg-night-950 text-ink-300">
      <SocialSection t={t} social={general.social} />
      <div className="container-page grid gap-10 py-16 md:grid-cols-12">
        <div className="md:col-span-4">
          <Logo href={lp("/")} label={general.logoText} light />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-300">{t("footer.tagline")}</p>
          <p className="mt-4 text-xs text-ink-400">{t("footer.responseNote")}</p>
        </div>
        <div className="md:col-span-3">
          <h2 className="text-sm font-semibold text-white">{t("footer.servicesTitle")}</h2>
          <ul className="mt-4 space-y-2.5 text-sm">
            {services.map((s) => (
              <li key={s.slug}>
                <Link href={lp(`/services/${s.slug}`)} className="text-ink-300 transition-colors hover:text-white">
                  {s.name}
                </Link>
              </li>
            ))}
            <li>
              <Link href={lp("/services")} className="font-medium text-white transition-colors hover:text-brand-200">
                {t("servicePages.ui.allServices")}
              </Link>
            </li>
          </ul>
        </div>
        <div className="md:col-span-2">
          <h2 className="text-sm font-semibold text-white">{t("footer.companyTitle")}</h2>
          <ul className="mt-4 space-y-2.5 text-sm">
            {[
              ["/how-we-work", "nav.howWeWork"],
              ["/work", "nav.work"],
              ["/about", "nav.about"],
              ["/contact", "nav.contact"],
              ["/login", "nav.clientLogin"],
            ].map(([href, key]) => (
              <li key={href}>
                <Link href={lp(href!)} className="text-ink-300 transition-colors hover:text-white">
                  {t(key!)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="md:col-span-3">
          <h2 className="text-sm font-semibold text-white">{t("footer.contactTitle")}</h2>
          <ul className="mt-4 space-y-2.5 text-sm text-ink-300">
            <li>
              <a href={`mailto:${general.contactEmail}`} className="inline-flex min-w-0 items-center gap-2 break-all hover:text-white">
                <Mail className="h-4 w-4 shrink-0" aria-hidden /> {general.contactEmail}
              </a>
            </li>
            {general.contactPhone && (
              <li>
                <a href={`tel:${general.contactPhone.replace(/\s/g, "")}`} className="inline-flex items-center gap-2 hover:text-white">
                  <Phone className="h-4 w-4" aria-hidden /> {general.contactPhone}
                </a>
              </li>
            )}
            {general.address && <li>{general.address}</li>}
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="container-page flex flex-wrap items-center justify-between gap-2 py-5 text-xs text-ink-400">
          <p>
            © {year} {general.companyName || siteConfig.legalName}. {t("footer.rights")}
          </p>
          <span className="flex items-center gap-4">
            <CookieSettingsButton label={t("cookieConsent.settings")} />
            <a href={`https://${siteConfig.domain}/`} className="hover:text-white">
              {siteConfig.domain}
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
