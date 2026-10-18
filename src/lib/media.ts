/**
 * Portfolio media helpers (client-safe). Only https URLs are accepted, and videos only
 * from YouTube (privacy-enhanced embed), Vimeo or a direct .mp4 / .webm file — so a stored
 * URL can never become an arbitrary iframe. Hosts must match the CSP in next.config.ts.
 */
export const VIDEO_EMBED_HOSTS = ["https://www.youtube-nocookie.com", "https://player.vimeo.com"] as const;

export function isHttpsUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export type VideoEmbed = { kind: "iframe"; src: string } | { kind: "file"; src: string; type: "video/mp4" | "video/webm" };

/** Turns a YouTube / Vimeo page URL or a direct video file URL into something safe to render. */
export function videoEmbed(value: string | null | undefined): VideoEmbed | null {
  if (!isHttpsUrl(value)) return null;
  const url = new URL(value);
  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  const id = (s: string | null | undefined) => (s && /^[A-Za-z0-9_-]{6,20}$/.test(s) ? s : null);
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const v = id(url.searchParams.get("v")) ?? id(url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1]);
    return v ? { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${v}?rel=0` } : null;
  }
  if (host === "youtu.be") {
    const v = id(url.pathname.slice(1));
    return v ? { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${v}?rel=0` } : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const v = url.pathname.match(/(?:^|\/)(\d{6,12})(?:$|\/)/)?.[1];
    return v ? { kind: "iframe", src: `https://player.vimeo.com/video/${v}?dnt=1` } : null;
  }
  if (/\.mp4$/i.test(url.pathname)) return { kind: "file", src: url.toString(), type: "video/mp4" };
  if (/\.webm$/i.test(url.pathname)) return { kind: "file", src: url.toString(), type: "video/webm" };
  return null;
}
