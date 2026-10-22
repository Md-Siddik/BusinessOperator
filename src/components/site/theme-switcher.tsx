"use client";

import { useSyncExternalStore } from "react";
import { Check, ChevronDown, Contrast, Moon, Sun, type LucideIcon } from "lucide-react";
import { Dropdown } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";
import { DEFAULT_SITE_THEME, SITE_THEME_STORAGE_KEY, SITE_THEMES, type SiteTheme } from "./theme";

export type ThemeLabels = { label: string; dark: string; light: string; mixed: string };

const ICONS: Record<SiteTheme, LucideIcon> = { dark: Moon, light: Sun, mixed: Contrast };

/** The theme lives on <html data-site-theme>; watch it so every switcher on the page stays in sync. */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-site-theme"] });
  return () => observer.disconnect();
}
function current(): SiteTheme {
  const t = document.documentElement.getAttribute("data-site-theme");
  return (SITE_THEMES as readonly string[]).includes(t ?? "") ? (t as SiteTheme) : DEFAULT_SITE_THEME;
}

function apply(theme: SiteTheme) {
  const root = document.documentElement;
  root.classList.add("theme-switching");
  root.setAttribute("data-site-theme", theme);
  window.setTimeout(() => root.classList.remove("theme-switching"), 350);
  try {
    localStorage.setItem(SITE_THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
}

function useSiteTheme() {
  return useSyncExternalStore(subscribe, current, () => DEFAULT_SITE_THEME);
}

/** Header dropdown: Dark (default), Light, Mixed. */
export function ThemeSwitcher({ labels }: { labels: ThemeLabels }) {
  const theme = useSiteTheme();
  const Icon = ICONS[theme];
  return (
    <Dropdown
      label={labels.label}
      trigger={({ open, toggle, id }) => (
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={id}
          aria-label={`${labels.label}: ${labels[theme]}`}
          className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-100 hover:text-ink-900"
        >
          <Icon className="h-4 w-4 text-ink-500" aria-hidden />
          <ChevronDown className={cn("h-3.5 w-3.5 text-ink-400 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      )}
    >
      {(close) =>
        SITE_THEMES.map((t) => {
          const ItemIcon = ICONS[t];
          return (
            <button
              key={t}
              type="button"
              role="menuitemradio"
              aria-checked={t === theme}
              onClick={() => {
                apply(t);
                close();
              }}
              className={cn("flex w-full items-center justify-between gap-6 rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-50 focus:bg-ink-50 focus:outline-none", t === theme ? "font-medium text-brand-700" : "text-ink-700")}
            >
              <span className="flex items-center gap-2.5">
                <ItemIcon className="h-4 w-4" aria-hidden />
                {labels[t]}
              </span>
              {t === theme && <Check className="h-4 w-4" aria-hidden />}
            </button>
          );
        })
      }
    </Dropdown>
  );
}

/** Mobile menu: the three modes as a segmented control. */
export function ThemeSegmented({ labels }: { labels: ThemeLabels }) {
  const theme = useSiteTheme();
  return (
    <div role="radiogroup" aria-label={labels.label} className="grid grid-cols-3 gap-1 rounded-xl border border-ink-200 bg-ink-50 p-1">
      {SITE_THEMES.map((t) => {
        const Icon = ICONS[t];
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={t === theme}
            onClick={() => apply(t)}
            className={cn("flex h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors", t === theme ? "bg-white text-ink-900 shadow-soft" : "text-ink-600 hover:text-ink-900")}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {labels[t]}
          </button>
        );
      })}
    </div>
  );
}
