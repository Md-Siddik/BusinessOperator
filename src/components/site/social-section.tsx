import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import type { CSSProperties } from "react";
import { SOCIAL_PLATFORMS, socialUrl } from "@/config/social";
import type { SettingValue } from "@/features/settings/schemas";
import type { Translator } from "@/lib/i18n/translator";
import { cn } from "@/lib/utils";
import styles from "./social-section.module.css";

export function SocialSection({ social, t }: { social: SettingValue<"general">["social"]; t: Translator["t"] }) {
  const networks = SOCIAL_PLATFORMS.flatMap((platform) => {
    const href = socialUrl(social[platform.key]);
    return href ? [{ ...platform, href }] : [];
  });
  if (!networks.length) return null;
  return (
    <section aria-labelledby="social-title" data-design="dark" className="border-y border-white/10 bg-night-950">
      <div className="container-page grid gap-9 py-14 sm:gap-10 sm:py-20 lg:grid-cols-12 lg:items-center lg:gap-12 lg:py-24">
        <div className="min-w-0 lg:col-span-4">
          <p className="text-[11px] font-semibold uppercase leading-5 tracking-[0.14em] text-signal-300">{t("footer.socialEyebrow")}</p>
          <h2 id="social-title" className="mt-4 max-w-md text-balance text-[2rem] font-semibold leading-[1.12] tracking-[-0.03em] text-white sm:text-4xl">{t("footer.socialTitle")}</h2>
          <p className="mt-5 max-w-md text-pretty text-[15px] leading-7 text-ink-300">{t("footer.socialSubtitle")}</p>
        </div>
        <ul className={cn(styles.grid, "min-w-0 lg:col-span-8")}>
          {networks.map(({ key, label, color, href }) => {
            const style = { "--social-accent": color } as CSSProperties;
            const content = (
              <>
                <span className="flex items-center gap-3.5">
                  <span className={styles.logo}>
                    <Image src={`/icons/social/${key}.svg`} alt="" aria-hidden width={26} height={26} className={styles.logoImage} />
                  </span>
                  <span className="min-w-0 flex-1 text-[17px] font-semibold tracking-tight text-white">{label}</span>
                  <span aria-hidden className={styles.arrow}><ArrowUpRight className="h-4 w-4" /></span>
                </span>
                <span className={cn(styles.description, "mt-4 block text-pretty text-sm leading-6 text-ink-300")}>{new URL(href).hostname}</span>
                <span className="mt-auto flex items-center justify-between gap-3 border-t border-white/[0.07] pt-3.5 text-xs font-medium text-ink-300">
                  <span className="pt-0.5">{t("footer.socialOpen")}</span>
                  <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", styles.status)} />
                </span>
              </>
            );
            return (
              <li key={key} className="min-w-0">
                <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label}: ${t("footer.socialOpen")}`} className={cn(styles.card, styles.link)} style={style}>{content}</a>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
