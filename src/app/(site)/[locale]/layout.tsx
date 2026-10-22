import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "../../globals.css";
import "../../site-theme.css";
import { siteFontVariables } from "../../fonts";
import { LANGUAGE_CODES, localizedPath } from "@/config/languages";
import { siteConfig } from "@/config/site";
import { getPublicContext } from "@/features/site/context";
import { ChatWidget } from "@/components/chat/chat-widget";
import { DEFAULT_CHAT_LABELS, type ChatWidgetLabels } from "@/components/chat/chat-widget-labels";
import { SiteAnalytics } from "@/components/site/site-analytics";
import { DEFAULT_SITE_THEME, SITE_THEME_SCRIPT } from "@/components/site/theme";

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
  const { t } = await getPublicContext(locale);
  const chatLabels = Object.fromEntries(Object.keys(DEFAULT_CHAT_LABELS).map((k) => [k, t(`chatWidget.${k}`)])) as ChatWidgetLabels;
  return (
    // Mixed by default; the head script applies a saved choice before first paint (hence suppressHydrationWarning).
    <html lang={locale} className={siteFontVariables} data-site-theme={DEFAULT_SITE_THEME} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SITE_THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh font-sans text-ink-900">
        {children}
        {/* Bottom-right live chat — messaging requires a client account (signup or login). */}
        <ChatWidget labels={chatLabels} signupHref={localizedPath(locale, "/signup")} loginHref={localizedPath(locale, "/login")} />
        {/* Consent banner + page-view beacon (Owner-only Website Analytics). Never blocks rendering. */}
        <SiteAnalytics labels={{ title: t("cookieConsent.title"), text: t("cookieConsent.text"), accept: t("cookieConsent.accept"), decline: t("cookieConsent.decline") }} />
      </body>
    </html>
  );
}
