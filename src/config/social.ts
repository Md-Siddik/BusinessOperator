export const SOCIAL_PLATFORMS = [
  { key: "whatsapp", label: "WhatsApp", color: "#25D366" },
  { key: "facebook", label: "Facebook", color: "#1877F2" },
  { key: "discord", label: "Discord", color: "#5865F2" },
  { key: "linkedin", label: "LinkedIn", color: "#0A66C2" },
  { key: "x", label: "X (Twitter)", color: "#FFFFFF" },
  { key: "instagram", label: "Instagram", color: "#E4405F" },
  { key: "youtube", label: "YouTube", color: "#FF0033" },
] as const;
export function socialUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return;
  try {
    const url = new URL(value.trim());
    if (url.protocol === "https:" && !url.username && !url.password) return value.trim();
  } catch { /* Hide invalid links. */ }
}
