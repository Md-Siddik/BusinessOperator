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
    <footer className="bg-night-950 text-ink-300">
      <div className="container-page grid gap-10 py-16 md:grid-cols-12">
        <div className="md:col-span-4">
          <Logo href={lp("/")} label={general.logoText} light />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-300">{t("footer.tagline")}</p>
          <p className="mt-4 text-xs text-ink-400">{t("footer.responseNote")}</p>
        </div>
        <div className="md:col-span-3">
          <h2 className="text-sm font-semibold text-white">{t("footer.servicesTitle")}</h2>
          <ul className="mt-4 space-y-2.5 text-sm">
            {SERVICE_CATEGORIES.map((c) => (
              <li key={c.slug}>
                <Link href={lp(`/services/${c.slug}`)} className="text-ink-300 transition-colors hover:text-white">
                  {t(`services.categories.${c.key}.name`)}
                </Link>
              </li>
            ))}
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
            {socials.length > 0 && (
              <li className="flex gap-3 pt-1">
                {socials.map(([network, url]) => (
                  <a key={network} href={url} rel="noopener noreferrer" target="_blank" className="capitalize hover:text-white">
                    {network}
                  </a>
                ))}
              </li>
            )}
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="container-page flex flex-wrap items-center justify-between gap-2 py-5 text-xs text-ink-400">
          <p>
            © {year} {general.companyName || siteConfig.legalName}. {t("footer.rights")}
          </p>
          <a href={`https://${siteConfig.domain}/`} className="hover:text-white">
            {siteConfig.domain}
          </a>
        </div>
      </div>
    </footer>
  );
}
