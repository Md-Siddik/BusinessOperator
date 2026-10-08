import { revalidatePath } from "next/cache";
import { readJson, route } from "@/lib/api/handler";
import { Errors } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { getSetting, updateSetting } from "@/features/settings/service";
import { SETTING_SCHEMAS, type SettingKey } from "@/features/settings/schemas";
import { rescoreCompanies } from "@/features/companies/service";

function parseKey(key: string): SettingKey {
  if (!(key in SETTING_SCHEMAS)) throw Errors.notFound();
  return key as SettingKey;
}

export const GET = route<{ key: string }>({ internal: true }, async ({ params }) => getSetting(parseKey(params.key)));

/**
 * Settings updates. General/language settings need content.manage or settings.manage
 * (they shape the public site); everything else requires settings.manage.
 */
export const PUT = route<{ key: string }>({ internal: true }, async ({ req, actor, params }) => {
  const key = parseKey(params.key);
  const allowed = key === "general" || key === "languages" ? can(actor, "settings.manage") || can(actor, "content.manage") : can(actor, "settings.manage");
  if (!allowed) throw Errors.forbidden();
  const value = await updateSetting(key, await readJson(req), actor);
  if (key === "general" || key === "languages") revalidatePath("/", "layout");
  if (key === "leadScoring") await rescoreCompanies({});
  return value;
});
