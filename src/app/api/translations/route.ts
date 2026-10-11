import { revalidatePath } from "next/cache";
import { readJson, route } from "@/lib/api/handler";
import { listTranslationRows, saveTranslation } from "@/features/translations/service";

export const GET = route({ internal: true, staff: true, permission: "content.manage" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  return listTranslationRows(actor, sp.get("locale") ?? "de", sp.get("namespace") ?? "", sp.get("q") ?? undefined);
});

export const PUT = route({ internal: true, staff: true, permission: "content.manage" }, async ({ req, actor }) => {
  await saveTranslation(actor, await readJson(req));
  revalidatePath("/", "layout");
  return { ok: true };
});
