"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Menu, X } from "lucide-react";
import { localizedPath } from "@/config/languages";
import { ButtonLink } from "@/components/ui/button";
import { Drawer } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { LanguageSwitcher } from "./language-switcher";

export type HeaderLabels = {
  home: string;
  services: string;
  howWeWork: string;
  about: string;
  work: string;
  contact: string;
  clientLogin: string;
  signup: string;
  cta: string;
  language: string;
  openMenu: string;
  closeMenu: string;
  mainNavigation: string;
};

export function SiteHeader({ locale, labels, enabledLanguages }: { locale: string; labels: HeaderLabels; enabledLanguages: string[] }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  const lp = (p: string) => localizedPath(locale, p);
  const nav = [
    { href: lp("/services"), label: labels.services },
    { href: lp("/how-we-work"), label: labels.howWeWork },
    { href: lp("/work"), label: labels.work },
    { href: lp("/about"), label: labels.about },
    { href: lp("/contact"), label: labels.contact },
  ];
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className={cn("sticky top-0 z-40 border-b transition-colors duration-200", scrolled ? "border-ink-200/70 bg-white/85 backdrop-blur-md" : "border-transparent bg-white")}>
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Logo href={lp("/")} />
        <nav aria-label={labels.mainNavigation} className="hidden items-center gap-1 lg:flex">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} aria-current={isActive(n.href) ? "page" : undefined} className={cn("rounded-lg px-3 py-2 text-sm font-medium transition-colors", isActive(n.href) ? "text-ink-900" : "text-ink-600 hover:text-ink-900")}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1.5">
          <div className="hidden sm:block">
            <LanguageSwitcher locale={locale} enabled={enabledLanguages} label={labels.language} compact />
          </div>
          <Link href={lp("/login")} className="hidden rounded-lg px-3 py-2 text-sm font-medium text-ink-700 hover:text-ink-900 md:inline-flex">
            {labels.clientLogin}
          </Link>
          <ButtonLink href={lp("/signup")} size="sm" variant="outline" className="hidden md:inline-flex">
            {labels.signup}
          </ButtonLink>
          <ButtonLink href={lp("/contact")} size="sm" className="hidden sm:inline-flex">
            {labels.cta}
          </ButtonLink>
          <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-ink-700 hover:bg-ink-100 lg:hidden" onClick={() => setOpen(true)} aria-label={labels.openMenu} aria-expanded={open}>
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>

      <Drawer open={open} onClose={() => setOpen(false)} side="right" label={labels.mainNavigation}>
        <div className="flex h-16 items-center justify-between border-b border-ink-100 px-5">
          <Logo href={lp("/")} />
          <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-ink-500 hover:bg-ink-100" aria-label={labels.closeMenu}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-4" aria-label={labels.mainNavigation}>
          <Link href={lp("/")} onClick={() => setOpen(false)} className="rounded-lg px-3 py-3 text-base font-medium text-ink-800 hover:bg-ink-50">
            {labels.home}
          </Link>
          {nav.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-3 text-base font-medium text-ink-800 hover:bg-ink-50">
              {n.label}
            </Link>
          ))}
          <Link href={lp("/login")} onClick={() => setOpen(false)} className="rounded-lg px-3 py-3 text-base font-medium text-ink-800 hover:bg-ink-50">
            {labels.clientLogin}
          </Link>
          <Link href={lp("/signup")} onClick={() => setOpen(false)} className="rounded-lg px-3 py-3 text-base font-medium text-ink-800 hover:bg-ink-50">
            {labels.signup}
          </Link>
        </nav>
        <div className="space-y-3 border-t border-ink-100 p-4">
          <LanguageSwitcher locale={locale} enabled={enabledLanguages} label={labels.language} />
          <ButtonLink href={lp("/contact")} className="w-full" onClick={() => setOpen(false)}>
            {labels.cta} <ArrowRight className="h-4 w-4" />
          </ButtonLink>
        </div>
      </Drawer>
    </header>
  );
}
