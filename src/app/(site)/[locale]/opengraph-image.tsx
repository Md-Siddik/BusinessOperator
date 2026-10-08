import { ImageResponse } from "next/og";
import { getBaseMessages } from "@/lib/i18n/dictionaries";
import { getPath } from "@/lib/i18n/translator";
import { siteConfig } from "@/config/site";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = siteConfig.tagline;

/** Localized Open Graph image generated at build time. */
export default async function OgImage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const m = getBaseMessages(locale);
  const start = getPath(m, "home.hero.titleStart") as string;
  const end = getPath(m, "home.hero.titleEnd") as string;
  const eyebrow = getPath(m, "home.hero.eyebrow") as string;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "linear-gradient(135deg, #151d45 0%, #203392 100%)", color: "white", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, fontWeight: 600 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: "#3d66f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>ET</div>
          {siteConfig.name}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 24, letterSpacing: 4, textTransform: "uppercase", color: "#94b1fd" }}>{eyebrow}</div>
          <div style={{ fontSize: 66, fontWeight: 700, marginTop: 20, lineHeight: 1.1 }}>{start}</div>
          <div style={{ fontSize: 66, fontWeight: 700, color: "#c0d1ff", lineHeight: 1.1 }}>{end}</div>
        </div>
        <div style={{ fontSize: 24, color: "#c0d1ff" }}>{siteConfig.domain}</div>
      </div>
    ),
    size,
  );
}
