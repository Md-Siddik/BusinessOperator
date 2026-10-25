import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SocialSection } from "@/components/site/social-section";
import { generalSettingsSchema } from "@/features/settings/schemas";
import { SOCIAL_PLATFORMS, socialUrl } from "@/config/social";
import { clearSettingsCache, getSetting, updateSetting } from "@/features/settings/service";
import { createTranslator } from "@/lib/i18n/translator";
import { getBaseMessages } from "@/lib/i18n/dictionaries";
import { SystemSetting } from "@/models";
import { makeUser } from "./helpers";
const t = createTranslator(getBaseMessages("en")).t;
const render = (social: Record<string, unknown>) => renderToStaticMarkup(<SocialSection social={social as ReturnType<typeof generalSettingsSchema.parse>["social"]} t={t} />);
describe("dynamic social settings", () => {
  it.each([["whatsapp"], ["youtube"], ["facebook", "instagram", "youtube"], SOCIAL_PLATFORMS.map(p => p.key)])("renders configured platforms: %j", (...keys) => {
    const social = Object.fromEntries(keys.map(key => [key, "https://example.com/" + key]));
    const html = render(social);
    expect((html.match(/target="_blank"/g) ?? []).length).toBe(keys.length);
    for (const key of keys) expect(html).toContain('href="' + social[key] + '"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it("hides the entire section for missing or invalid links", () => {
    expect(render({})).toBe("");
    expect(render({ youtube: null, facebook: "javascript:alert(1)", instagram: " " })).toBe("");
    expect(socialUrl("https://user:password@example.com")).toBeUndefined();
  });
  it("trims values, normalizes WhatsApp numbers and rejects unsafe links", () => {
    const value = generalSettingsSchema.parse({ social: { youtube: "  https://youtube.com/@example  ", whatsapp: "+47 12345678" } });
    expect(value.social.youtube).toBe("https://youtube.com/@example");
    expect(value.social.whatsapp).toBe("https://wa.me/4712345678");
    for (const key of SOCIAL_PLATFORMS.map(p => p.key)) expect(generalSettingsSchema.safeParse({ social: { [key]: "javascript:alert(1)" } }).success).toBe(false);
  });
  it("keeps legacy social values and unrelated settings when reading", async () => {
    await SystemSetting.updateOne({ key: "general" }, { $set: { value: { companyName: "Existing Company", social: { facebook: "https://facebook.com/existing", x: "old-invalid-value", instagram: null } } } }, { upsert: true });
    clearSettingsCache();
    const value = await getSetting("general");
    expect(value.companyName).toBe("Existing Company");
    expect(value.social.facebook).toBe("https://facebook.com/existing");
    expect(value.social.x).toBe("old-invalid-value");
    expect(value.social.youtube).toBe("");
    expect(render(value.social)).not.toContain("old-invalid-value");
  });
  it("persists YouTube, preserves existing links, edits and removes links", async () => {
    const { actor } = await makeUser("OWNER");
    const value = generalSettingsSchema.parse({ social: { facebook: "https://facebook.com/existing", youtube: "https://youtube.com/@example" } });
    await updateSetting("general", value, actor);
    clearSettingsCache();
    expect((await getSetting("general")).social).toEqual(value.social);
    value.social.youtube = "https://youtube.com/@edited";
    await updateSetting("general", value, actor);
    expect(render((await getSetting("general")).social)).toContain(value.social.youtube);
    value.social.youtube = "";
    await updateSetting("general", value, actor);
    const saved = await getSetting("general");
    expect(saved.social.facebook).toBe(value.social.facebook);
    expect(render(saved.social)).not.toContain("YouTube");
  });
});
