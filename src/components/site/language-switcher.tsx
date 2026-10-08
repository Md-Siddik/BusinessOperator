"use client";

import { usePathname } from "next/navigation";
import { Check, ChevronDown, Globe } from "lucide-react";
import { LANGUAGES, LANGUAGE_CODES, localizedPath } from "@/config/languages";
import { Dropdown } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";

/** Strip a locale prefix from the current browser path. */
function basePath(pathname: string) {
  const [, first, ...rest] = pathname.split("/");
  if ((LANGUAGE_CODES as string[]).includes(first ?? "")) return `/${rest.join("/")}`;
  return pathname || "/";
}

/** Native language names (never flags alone — flags are countries, not languages). */
export function LanguageSwitcher({ locale, enabled, label, compact }: { locale: string; enabled: string[]; label: string; compact?: boolean }) {
  const pathname = usePathname();
  const path = basePath(pathname);
  const current = LANGUAGES.find((l) => l.code === locale) ?? LANGUAGES[0];
  const languages = LANGUAGES.filter((l) => enabled.includes(l.code));
  return (
    <Dropdown
      label={label}
      trigger={({ open, toggle, id }) => (
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={id}
          aria-label={`${label}: ${current.nativeName}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-100 hover:text-ink-900"
        >
          <Globe className="h-4 w-4 text-ink-500" aria-hidden />
          <span>{compact ? current.code.toUpperCase() : current.nativeName}</span>
          <ChevronDown className={cn("h-3.5 w-3.5 text-ink-400 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      )}
    >
      {(close) =>
        languages.map((l) => (
          <a
            key={l.code}
            role="menuitem"
            href={localizedPath(l.code, path)}
            hrefLang={l.hreflang}
            lang={l.code}
            onClick={close}
            aria-current={l.code === locale ? "true" : undefined}
            className={cn("flex items-center justify-between gap-6 rounded-lg px-3 py-2 text-sm hover:bg-ink-50 focus:bg-ink-50 focus:outline-none", l.code === locale ? "font-medium text-brand-700" : "text-ink-700")}
          >
            <span>
              {l.nativeName}
              <span className="ml-2 text-xs text-ink-400">{l.code.toUpperCase()}</span>
            </span>
            {l.code === locale && <Check className="h-4 w-4" aria-hidden />}
          </a>
        ))
      }
    </Dropdown>
  );
}
