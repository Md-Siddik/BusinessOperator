import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { can, canAssignRole, effectivePermissions, PERMISSIONS, type Actor } from "@/lib/permissions";
import { scoreCompany, hasDigitalOpportunity } from "@/features/companies/scoring";
import { leadScoringSettingsSchema } from "@/features/settings/schemas";
import { createTranslator, deepMerge, flattenMessages } from "@/lib/i18n/translator";
import { getBaseMessages } from "@/lib/i18n/dictionaries";
import { LANGUAGE_CODES, localizedPath } from "@/config/languages";
import { COUNTRY_CODES, getCountry } from "@/config/countries";
import { classifyIndustry, profileForIndustry } from "@/config/industries";
import { renderTemplate, textToHtml } from "@/lib/email/render";
import { createUnsubscribeToken, verifyUnsubscribeToken } from "@/lib/email/unsubscribe";
import { signSession, verifySession } from "@/lib/auth/token";

const actor = (role: Actor["role"], permissions = effectivePermissions(role)): Actor => ({ id: "1", role, permissions, name: "x", email: "x@y.z" });

describe("RBAC", () => {
  it("owner has every permission; clients have none", () => {
    for (const p of PERMISSIONS) expect(can(actor("OWNER"), p)).toBe(true);
    for (const p of PERMISSIONS) expect(can(actor("CLIENT", ["companies.read"] as never), p)).toBe(false);
  });
  it("staff (staff workspace) only hold client-data and website permissions", () => {
    const s = actor("STAFF");
    expect(can(s, "chat.manage")).toBe(true);
    expect(can(s, "tickets.manage")).toBe(true);
    expect(can(s, "content.manage")).toBe(true);
    expect(can(s, "clients.manage")).toBe(false);
    for (const p of ["companies.read", "companies.export", "outreach.manage", "outreach.approve", "registry.sync", "settings.manage", "audit.view"] as const) {
      expect(can(s, p)).toBe(false);
      expect(can(actor("ADMIN"), p)).toBe(false);
    }
    expect(can(actor("ADMIN"), "clients.manage")).toBe(true);
  });
  it("owner-dashboard permissions stored on an old ADMIN/STAFF account are never effective", () => {
    // Website maintenance (incl. public service management) only — never company intelligence, CRM, outreach, users or system settings.
    expect([...effectivePermissions("ADMIN", [...PERMISSIONS])].sort()).toEqual(["analytics.view", "chat.manage", "clients.manage", "content.manage", "projects.manage", "services.manage", "tickets.manage", "users.manage"]);
    expect(effectivePermissions("STAFF", ["companies.read", "outreach.manage"])).toEqual([]);
  });
  it("only the owner assigns privileged roles; Super Admin can assign STAFF", () => {
    expect(canAssignRole(actor("OWNER"), "ADMIN")).toBe(true);
    expect(canAssignRole(actor("ADMIN", [...PERMISSIONS]), "ADMIN")).toBe(false);
    expect(canAssignRole(actor("ADMIN", [...PERMISSIONS]), "STAFF")).toBe(true);
  });
  it("ignores unknown stored permissions", () => {
    expect(effectivePermissions("ADMIN", ["tickets.manage", "hack.everything"])).toEqual(["tickets.manage"]);
  });
});

describe("Lead scoring", () => {
  const settings = leadScoringSettingsSchema.parse({});
  const now = new Date("2026-10-01T12:00:00Z");
  it("explains every point and clamps to 0–100", () => {
    const r = scoreCompany({ registrationDate: new Date("2026-09-20"), industry: "technology", email: "a@b.c", phone: "+47 1", legalForm: "AS", signals: { hiring: true } }, settings, now);
    expect(r.breakdown.map((b) => b.ruleId)).toEqual(expect.arrayContaining(["newly_registered", "relevant_industry", "no_website", "email_available", "phone_available", "hiring", "digital_opportunity", "limited_company"]));
    expect(r.score).toBe(Math.min(100, r.breakdown.reduce((s, b) => s + b.points, 0)));
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.qualified).toBe(true);
  });
  it("respects disabled rules and thresholds", () => {
    const custom = leadScoringSettingsSchema.parse({ qualifiedThreshold: 90, rules: settings.rules.map((r) => ({ ...r, enabled: r.id === "email_available" })) });
    const r = scoreCompany({ email: "a@b.c", website: "https://x.example" }, custom, now);
    expect(r.breakdown).toHaveLength(1);
    expect(r.qualified).toBe(false);
  });
  it("digital opportunity only from observable gaps", () => {
    expect(hasDigitalOpportunity({ website: null })).toBe(true);
    expect(hasDigitalOpportunity({ website: "https://a.example" })).toBe(false);
    expect(hasDigitalOpportunity({ website: "https://a.example", auditSummary: { score: 30 } })).toBe(true);
  });
});

describe("Internationalization", () => {
  const en = flattenMessages(JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages/en.json"), "utf8")));
  it.each(LANGUAGE_CODES.filter((c) => c !== "en"))("%s dictionary has every English key", (code) => {
    const dict = flattenMessages(JSON.parse(fs.readFileSync(path.join(process.cwd(), `messages/${code}.json`), "utf8")));
    const missing = Object.keys(en).filter((k) => !(k in dict));
    expect(missing).toEqual([]);
  });
  it("falls back to English for missing keys and never renders raw key paths", () => {
    const merged = deepMerge({ home: { hero: { titleStart: "EN start", titleEnd: "EN end" } } }, { home: { hero: { titleStart: "DE start" } } });
    const { t } = createTranslator(merged);
    expect(t("home.hero.titleStart")).toBe("DE start");
    expect(t("home.hero.titleEnd")).toBe("EN end");
    const unknown = t("home.hero.doesNotExist");
    expect(unknown).not.toContain(".");
    expect(unknown).toBe("Does not exist");
  });
  it("interpolates variables", () => {
    expect(createTranslator({ a: "Hi {name}" }).t("a", { name: "Ola" })).toBe("Hi Ola");
  });
  it("locale dictionaries are merged over English", () => {
    const de = getBaseMessages("de") as { nav: { services: string } };
    expect(de.nav.services).toBe("Leistungen");
    expect(getBaseMessages("xx")).toBe(getBaseMessages("en"));
  });
  it("English uses clean URLs; other languages are prefixed (language switching)", () => {
    expect(localizedPath("en", "/services")).toBe("/services");
    expect(localizedPath("en", "/")).toBe("/");
    expect(localizedPath("de", "/services")).toBe("/de/services");
    expect(localizedPath("no", "/")).toBe("/no");
  });
  it("keeps country and language as separate systems", () => {
    expect(COUNTRY_CODES).toContain("SE");
    expect(LANGUAGE_CODES).not.toContain("se" as never);
    expect(getCountry("FI")?.suggestedLanguages).toEqual(["fi", "sv", "en"]);
  });
});

describe("Industry configuration", () => {
  it("classifies NACE codes by longest prefix", () => {
    expect(classifyIndustry("47.910")).toBe("ecommerce");
    expect(classifyIndustry("47.710")).toBe("retail");
    expect(classifyIndustry("62.010")).toBe("technology");
    expect(classifyIndustry("25.620")).toBe("manufacturing");
    expect(classifyIndustry("18.120")).toBe("printing");
    expect(classifyIndustry(undefined)).toBe("other");
  });
  it("hiring companies get the recruitment bundle", () => {
    expect(profileForIndustry("technology", true).key).toBe("hiring");
    expect(profileForIndustry("retail").key).toBe("ecommerce");
  });
});

describe("Email templates", () => {
  it("never invents facts: missing variables are empty and reported", () => {
    const r = renderTemplate("Hi {{contactName}}, welcome {{companyName}} ({{website}})", { companyName: "Acme AS" });
    expect(r.output).toBe("Hi, welcome Acme AS ()");
    expect(r.missing).toEqual(["contactName", "website"]);
  });
  it("supports neutral fallbacks", () => {
    expect(renderTemplate("Hi {{contactName|there}},", {}).output).toBe("Hi there,");
  });
  it("escapes HTML", () => {
    expect(textToHtml("<script>x</script>")).not.toContain("<script>");
  });
});

describe("Tokens", () => {
  it("unsubscribe tokens are signed and tamper-proof", () => {
    const token = createUnsubscribeToken("Someone@Example.com");
    expect(verifyUnsubscribeToken(token)).toBe("someone@example.com");
    expect(verifyUnsubscribeToken(token.replace(/.$/, (c) => (c === "a" ? "b" : "a")))).toBeNull();
    expect(verifyUnsubscribeToken("garbage")).toBeNull();
  });
  it("session JWTs verify and reject tampering", async () => {
    const jwt = await signSession({ sub: "abc", role: "STAFF", sv: 2 });
    expect(await verifySession(jwt)).toMatchObject({ sub: "abc", role: "STAFF", sv: 2 });
    const [h, p, s] = jwt.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: "abc", role: "OWNER", sv: 2 })).toString("base64url")}.${s}`;
    expect(await verifySession(forged)).toBeNull();
    expect(p).toBeTruthy();
  });
});

describe("Chat widget texts", () => {
  it("every widget label is translated in every language (server layouts read these keys)", async () => {
    const { DEFAULT_CHAT_LABELS } = await import("@/components/chat/chat-widget-labels");
    const keys = Object.keys(DEFAULT_CHAT_LABELS);
    expect(keys.length).toBeGreaterThan(10);
    for (const code of LANGUAGE_CODES) {
      const t = createTranslator(getBaseMessages(code)).t;
      for (const k of keys) expect(t(`chatWidget.${k}`), `${code} chatWidget.${k}`).toBeTruthy();
      expect(t("nav.signup")).toBeTruthy();
    }
  });
});
