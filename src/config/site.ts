/**
 * Central brand configuration. Never hard-code the domain or contact details
 * elsewhere — import from here. Values can be overridden via environment.
 */
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");

export const siteConfig = {
  name: "ExploreTechify",
  legalName: process.env.NEXT_PUBLIC_LEGAL_NAME || "ExploreTechify",
  domain: process.env.NEXT_PUBLIC_SITE_DOMAIN || "exploretechify.com",
  url: siteUrl,
  positioning: "Digital & Business Operations Partner",
  tagline: "You run the business. We run the digital side.",
  logo: { text: "ExploreTechify", mark: "ET" },
  contact: {
    email: process.env.NEXT_PUBLIC_CONTACT_EMAIL || "hello@exploretechify.com",
    phone: process.env.NEXT_PUBLIC_CONTACT_PHONE || "",
    address: process.env.NEXT_PUBLIC_CONTACT_ADDRESS || "",
  },
  social: {
    linkedin: process.env.NEXT_PUBLIC_SOCIAL_LINKEDIN || "",
    x: process.env.NEXT_PUBLIC_SOCIAL_X || "",
    instagram: process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM || "",
  },
} as const;

export function absoluteUrl(path = "/") {
  return `${siteConfig.url}${path.startsWith("/") ? path : `/${path}`}`;
}
