import type { ReactNode } from "react";
import Link from "next/link";
import { Home } from "lucide-react";
import { localizedPath } from "@/config/languages";
import { Logo } from "@/components/site/logo";
import { LanguageSwitcher } from "@/components/site/language-switcher";
import { getPublicContext } from "@/features/site/context";

/** Minimal split layout for sign-in / sign-up / password pages. */
export default async function AuthLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { t, enabledLanguages } = await getPublicContext(locale);
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,34rem)]">
      <aside className="relative hidden overflow-hidden bg-brand-950 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute inset-0 opacity-[0.35] [background:radial-gradient(60rem_30rem_at_10%_-10%,#3d66f0,transparent),radial-gradient(40rem_30rem_at_110%_110%,#2849dc,transparent)]" aria-hidden />
        <Logo href={localizedPath(locale, "/")} light className="relative" />
        <div className="relative max-w-md">
          <p className="font-serif text-4xl leading-tight text-white italic">{t("home.hero.titleStart")}</p>
          <p className="mt-1 text-4xl font-semibold leading-tight tracking-tight text-white">{t("home.hero.titleEnd")}</p>
          <p className="mt-6 text-sm leading-relaxed text-brand-100/80">{t("home.hero.note")}</p>
        </div>
        <p className="relative text-xs text-brand-200/60">{t("footer.responseNote")}</p>
      </aside>
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center justify-between gap-3 px-6 py-5 sm:px-10">
          <Link href={localizedPath(locale, "/")} className="inline-flex min-h-10 items-center gap-2 rounded-lg text-sm font-medium text-ink-700 hover:text-brand-700">
            <Home className="h-4 w-4" aria-hidden />
            {t("nav.home")}
          </Link>
          <LanguageSwitcher locale={locale} enabled={enabledLanguages} label={t("nav.language")} compact />
        </div>
        <main id="main" className="flex flex-1 items-center justify-center px-6 pb-16 sm:px-10">
          <div className="w-full max-w-sm">{children}</div>
        </main>
      </div>
    </div>
  );
}
