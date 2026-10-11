import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "../../globals.css";
import { fontVariables } from "../../fonts";
import { LANGUAGE_CODES, localizedPath } from "@/config/languages";
import { siteConfig } from "@/config/site";
import { getPublicContext } from "@/features/site/context";
import { ChatWidget } from "@/components/chat/chat-widget";
import { DEFAULT_CHAT_LABELS, type ChatWidgetLabels } from "@/components/chat/chat-widget-labels";

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
    <html lang={locale} className={fontVariables}>
      <body className="min-h-dvh bg-white font-sans text-ink-900">
        {children}
        {/* Bottom-right live chat — messaging requires a client account (signup or login). */}
        <ChatWidget labels={chatLabels} signupHref={localizedPath(locale, "/signup")} loginHref={localizedPath(locale, "/login")} />
      </body>
    </html>
  );
}
