import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../globals.css";
import "../site-theme.css";
import { DEFAULT_SITE_THEME, SITE_THEME_SCRIPT } from "@/components/site/theme";
import { fontVariables } from "../fonts";
import { siteConfig } from "@/config/site";
import { ToastProvider } from "@/components/ui/toast";
import { RolePreviewBar } from "@/components/app/role-preview";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: { default: siteConfig.name, template: `%s · ${siteConfig.name}` },
  robots: { index: false, follow: false },
};

/** Root layout for the authenticated application (dashboard + client portal). */
export default async function AppRootLayout({ children }: { children: ReactNode }) {
  // "View as Role": the indicator follows the Owner through every workspace page while previewing.
  const preview = await getSessionUser()
    .then((u) => u?.preview ?? null)
    .catch(() => null);
  return (
    <html lang="en" className={fontVariables} data-site-theme={DEFAULT_SITE_THEME} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SITE_THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-ink-50 font-sans text-ink-900">
        <ToastProvider>
          {children}
          {preview && <RolePreviewBar label={preview.label} />}
        </ToastProvider>
      </body>
    </html>
  );
}
