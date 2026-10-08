import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { fontVariables } from "./fonts";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

/** Used for URLs that match no route at all (e.g. unknown /dashboard paths). */
export default function GlobalNotFound() {
  return (
    <html lang="en" className={fontVariables}>
      <body className="flex min-h-dvh flex-col items-center justify-center bg-white px-6 text-center font-sans text-ink-900">
        <p className="font-serif text-7xl italic text-brand-600">404</p>
        <h1 className="mt-4 text-2xl font-semibold">Page not found</h1>
        <p className="mt-2 text-ink-600">The page you&apos;re looking for doesn&apos;t exist or has moved.</p>
        <Link href="/" className="mt-8 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700">
          Back to home
        </Link>
      </body>
    </html>
  );
}
