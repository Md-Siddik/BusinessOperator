import { revalidatePath } from "next/cache";
import { readJson, route } from "@/lib/api/handler";
import { Errors } from "@/lib/errors";
import { can, isOwner } from "@/lib/permissions";
import { getSetting, updateSetting } from "@/features/settings/service";
import { SETTING_SCHEMAS, type SettingKey } from "@/features/settings/schemas";
import { rescoreCompanies } from "@/features/companies/service";

function parseKey(key: string): SettingKey {
  if (!(key in SETTING_SCHEMAS)) throw Errors.notFound();
  return key as SettingKey;
}

/** Staff (ADMIN/STAFF) may only read the website settings; everything else is owner configuration. */
const WEBSITE_KEYS: SettingKey[] = ["general", "languages"];

export const GET = route<{ key: string }>({ internal: true, staff: true }, async ({ actor, params }) => {
  const key = parseKey(params.key);
  if (!isOwner(actor) && !WEBSITE_KEYS.includes(key)) throw Errors.forbidden();
  return getSetting(key);
});

/**
 * Settings updates. General/language settings need content.manage or settings.manage
 * (they shape the public site); everything else requires settings.manage.
 */
export const PUT = route<{ key: string }>({ internal: true, staff: true }, async ({ req, actor, params }) => {
  const key = parseKey(params.key);
  const allowed = key === "general" || key === "languages" ? can(actor, "settings.manage") || can(actor, "content.manage") : can(actor, "settings.manage");
  if (!allowed) throw Errors.forbidden();
  const value = await updateSetting(key, await readJson(req), actor);
  if (key === "general" || key === "languages") revalidatePath("/", "layout");
  if (key === "leadScoring") await rescoreCompanies({});
  return value;
});
