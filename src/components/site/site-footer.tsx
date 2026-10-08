import Link from "next/link";
import { Mail, Phone } from "lucide-react";
import { localizedPath } from "@/config/languages";
import { SERVICE_CATEGORIES } from "@/config/services";
import { siteConfig } from "@/config/site";
import type { Translator } from "@/lib/i18n/translator";
import type { SettingValue } from "@/features/settings/schemas";
import { Logo } from "./logo";

export function SiteFooter({ locale, t, general }: { locale: string; t: Translator["t"]; general: SettingValue<"general"> }) {
  const lp = (p: string) => localizedPath(locale, p);
  const year = new Date().getFullYear();
  const socials = Object.entries(general.social).filter(([, url]) => url);
  return (
    <footer className="border-t border-ink-200 bg-ink-50/60">
      <div className="container-page grid gap-10 py-14 md:grid-cols-12">
        <div className="md:col-span-4">
          <Logo href={lp("/")} label={general.logoText} />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-600">{t("footer.tagline")}</p>
          <p className="mt-4 text-xs text-ink-500">{t("footer.responseNote")}</p>
        </div>
        <div className="md:col-span-3">
          <h2 className="text-sm font-semibold text-ink-900">{t("footer.servicesTitle")}</h2>
          <ul className="mt-4 space-y-2.5 text-sm">
            {SERVICE_CATEGORIES.map((c) => (
              <li key={c.slug}>
                <Link href={lp(`/services/${c.slug}`)} className="text-ink-600 hover:text-ink-900">
                  {t(`services.categories.${c.key}.name`)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="md:col-span-2">
          <h2 className="text-sm font-semibold text-ink-900">{t("footer.companyTitle")}</h2>
          <ul className="mt-4 space-y-2.5 text-sm">
            {[
              ["/how-we-work", "nav.howWeWork"],
              ["/work", "nav.work"],
              ["/about", "nav.about"],
              ["/contact", "nav.contact"],
              ["/login", "nav.clientLogin"],
            ].map(([href, key]) => (
              <li key={href}>
                <Link href={lp(href!)} className="text-ink-600 hover:text-ink-900">
                  {t(key!)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="md:col-span-3">
          <h2 className="text-sm font-semibold text-ink-900">{t("footer.contactTitle")}</h2>
          <ul className="mt-4 space-y-2.5 text-sm text-ink-600">
            <li>
              <a href={`mailto:${general.contactEmail}`} className="inline-flex items-center gap-2 hover:text-ink-900">
                <Mail className="h-4 w-4" aria-hidden /> {general.contactEmail}
              </a>
            </li>
            {general.contactPhone && (
              <li>
                <a href={`tel:${general.contactPhone.replace(/\s/g, "")}`} className="inline-flex items-center gap-2 hover:text-ink-900">
                  <Phone className="h-4 w-4" aria-hidden /> {general.contactPhone}
                </a>
              </li>
            )}
            {general.address && <li>{general.address}</li>}
            {socials.length > 0 && (
              <li className="flex gap-3 pt-1">
                {socials.map(([network, url]) => (
                  <a key={network} href={url} rel="noopener noreferrer" target="_blank" className="capitalize hover:text-ink-900">
                    {network}
                  </a>
                ))}
              </li>
            )}
          </ul>
        </div>
      </div>
      <div className="border-t border-ink-200">
        <div className="container-page flex flex-wrap items-center justify-between gap-2 py-5 text-xs text-ink-500">
          <p>
            © {year} {general.companyName || siteConfig.legalName}. {t("footer.rights")}
          </p>
          <p>{siteConfig.domain}</p>
        </div>
      </div>
    </footer>
  );
}
