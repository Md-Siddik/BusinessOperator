import Link from "next/link";
import { ArrowUpRight, ExternalLink, Film, PlayCircle } from "lucide-react";
import { localizedPath } from "@/config/languages";
import type { PublicCaseStudy } from "@/features/content/service";
import type { Translator } from "@/lib/i18n/translator";
import { videoEmbed } from "@/lib/media";
import { Badge } from "@/components/ui/badge";
import { SectionHeading } from "./sections";

type T = Translator["t"];

/**
 * Portfolio building blocks for the public site. Only published case studies are shown,
 * examples always carry the "Example" badge, and nothing is rendered that the Owner did
 * not enter — no invented clients, results or testimonials.
 */
export function WorkCard({ c, locale, t }: { c: PublicCaseStudy; locale: string; t: T }) {
  return (
    <article className="group flex flex-col overflow-hidden rounded-3xl border border-ink-200 bg-white shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lifted">
      {c.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Owner-provided https image; dimensions unknown in advance.
        <img src={c.thumbnailUrl} alt="" loading="lazy" className="aspect-[16/9] w-full border-b border-ink-100 bg-ink-50 object-cover" />
      ) : (
        <div className="flex aspect-[16/9] items-center justify-center border-b border-ink-100 bg-gradient-to-br from-ink-50 to-brand-50/60" aria-hidden>
          <span className="text-sm font-semibold tracking-tight text-ink-400">{c.clientName}</span>
        </div>
      )}
      <div className="flex flex-1 flex-col p-6">
        <div className="flex flex-wrap items-center gap-2">
          {c.isExample && <Badge tone="demo">{t("work.exampleBadge")}</Badge>}
          {c.industry && <Badge>{t(`industries.${c.industry}`)}</Badge>}
          {c.videoUrl && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-700">
              <PlayCircle className="h-3.5 w-3.5" aria-hidden /> {t("portfolio.video.watch")}
            </span>
          )}
        </div>
        <h3 className="mt-4 text-xl font-semibold tracking-tight text-ink-900">{c.title}</h3>
        {c.summary && (
          <p className="mt-2 text-sm leading-relaxed text-ink-600">
            <span className="font-medium text-ink-800">{t("portfolio.whatWasBuilt")}: </span>
            {c.summary}
          </p>
        )}
        {c.challenge && (
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-600">
            <span className="font-medium text-ink-800">{t("portfolio.goal")}: </span>
            {c.challenge}
          </p>
        )}
        {c.services.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-1.5" aria-label={t("portfolio.servicesProvided")}>
            {c.services.slice(0, 4).map((s) => (
              <li key={s} className="rounded-full bg-ink-50 px-2.5 py-1 text-xs text-ink-600">
                {t(`serviceItems.${s}`)}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-2 pt-5">
          <Link href={localizedPath(locale, `/work/${c.slug}`)} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-800">
            {t("work.readCase")} <ArrowUpRight className="h-4 w-4" aria-hidden />
            <span className="sr-only">: {c.title}</span>
          </Link>
          {c.projectUrl && (
            <a href={c.projectUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-ink-700 hover:text-ink-900">
              {t("portfolio.viewProject")} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

/** A responsive 16:9 player; embeds load lazily and only from the hosts allowed in the CSP. */
export function VideoPlayer({ url, title }: { url: string; title: string }) {
  const embed = videoEmbed(url);
  if (!embed) return null;
  return (
    <div className="aspect-video w-full overflow-hidden rounded-2xl border border-ink-200 bg-night-950">
      {embed.kind === "iframe" ? (
        <iframe src={embed.src} title={title} loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" className="h-full w-full" />
      ) : (
        <video controls preload="metadata" className="h-full w-full" aria-label={title}>
          <source src={embed.src} type={embed.type} />
        </video>
      )}
    </div>
  );
}

/** Video portfolio. Without published videos it shows a clearly marked placeholder — never fake footage. */
export function VideoShowcase({ cases, t }: { cases: PublicCaseStudy[]; t: T }) {
  const videos = cases.filter((c) => c.videoUrl).slice(0, 4);
  return (
    <section className="border-y border-ink-100 bg-[#f5f7fb] py-16 sm:py-24" aria-labelledby="video-showcase">
      <div className="container-page">
        <SectionHeading eyebrow={t("portfolio.video.eyebrow")} title={<span id="video-showcase">{t("portfolio.video.title")}</span>} subtitle={t("portfolio.video.subtitle")} />
        {videos.length ? (
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {videos.map((c) => (
              <figure key={c.slug}>
                <VideoPlayer url={c.videoUrl!} title={t("portfolio.video.videoOf", { title: c.title })} />
                <figcaption className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-700">
                  <span className="font-semibold text-ink-900">{c.title}</span>
                  {c.isExample && <Badge tone="demo">{t("work.exampleBadge")}</Badge>}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="flex aspect-video flex-col items-center justify-center rounded-2xl border border-dashed border-ink-300 bg-white p-6 text-center" aria-hidden={i > 0}>
                {i === 0 ? (
                  <>
                    <Film className="h-8 w-8 text-brand-500" aria-hidden />
                    <span className="mt-3 rounded-full border border-ink-200 bg-ink-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500">{t("portfolio.video.placeholderBadge")}</span>
                    <p className="mt-3 text-base font-semibold text-ink-900">{t("portfolio.video.placeholderTitle")}</p>
                    <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-600">{t("portfolio.video.placeholderText")}</p>
                  </>
                ) : (
                  <PlayCircle className="h-10 w-10 text-ink-300" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
