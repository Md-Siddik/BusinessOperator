import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../globals.css";
import { fontVariables } from "../fonts";
import { siteConfig } from "@/config/site";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: { default: siteConfig.name, template: `%s · ${siteConfig.name}` },
  robots: { index: false, follow: false },
};

/** Root layout for the authenticated application (dashboard + client portal). */
export default function AppRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body className="min-h-dvh bg-ink-50 font-sans text-ink-900">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
