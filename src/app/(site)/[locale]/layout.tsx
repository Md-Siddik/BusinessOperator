import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "../../globals.css";
import { fontVariables } from "../../fonts";
import { LANGUAGE_CODES } from "@/config/languages";
import { siteConfig } from "@/config/site";
import { getPublicContext } from "@/features/site/context";

export const revalidate = 300;
export const dynamicParams = false;

export function generateStaticParams() {
  return LANGUAGE_CODES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const { t } = await getPublicContext(locale);
  return {
    metadataBase: new URL(siteConfig.url),
    title: { default: t("meta.pages.home.title"), template: `%s · ${siteConfig.name}` },
    description: t("meta.siteDescription"),
    applicationName: siteConfig.name,
  };
}

export const viewport: Viewport = { themeColor: "#ffffff", width: "device-width", initialScale: 1 };

/** Root layout for the public, localized website: correct <html lang> per locale. */
export default async function LocaleRootLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await getPublicContext(locale);
  return (
    <html lang={locale} className={fontVariables}>
      <body className="min-h-dvh bg-white font-sans text-ink-900">{children}</body>
    </html>
  );
}
