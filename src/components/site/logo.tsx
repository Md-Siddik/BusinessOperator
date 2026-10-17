import Link from "next/link";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-8 w-8", className)} aria-hidden>
      <rect width="32" height="32" rx="9" fill="#151d45" />
      <path d="M9 10.5h9.5M9 16h7M9 21.5h9.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="22.5" cy="16" r="3" fill="#6189f8" />
    </svg>
  );
}

export function Logo({ href = "/", className, label = siteConfig.logo.text, light }: { href?: string; className?: string; label?: string; light?: boolean }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5 rounded-lg", className)} aria-label={`${siteConfig.name} — home`}>
      {/* On dark backgrounds the navy mark gets a hairline outline so it stays visible. */}
      <LogoMark className={light ? "rounded-[9px] ring-1 ring-white/20" : undefined} />
      <span className={cn("text-[15px] font-semibold tracking-tight", light ? "text-white" : "text-ink-900")}>{label}</span>
    </Link>
  );
}
