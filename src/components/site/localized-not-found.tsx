"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LANGUAGE_CODES, localizedPath } from "@/config/languages";

export function LocalizedNotFound({ strings }: { strings: Record<string, { title: string; text: string; back: string }> }) {
  const first = usePathname().split("/")[1] ?? "";
  const locale = (LANGUAGE_CODES as string[]).includes(first) ? first : "en";
  const s = strings[locale] ?? strings.en!;
  return (
    <section className="container-page flex min-h-[60vh] flex-col items-center justify-center py-24 text-center">
      <p className="font-serif text-7xl italic text-brand-600">404</p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-ink-900">{s.title}</h1>
      <p className="mt-3 max-w-md text-ink-600">{s.text}</p>
      <Link href={localizedPath(locale, "/")} className="mt-8 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700">
        {s.back}
      </Link>
    </section>
  );
}
