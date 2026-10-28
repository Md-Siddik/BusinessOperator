import { readJson, route } from "@/lib/api/handler";
import { deleteLeadAssignment, updateLeadAssignment } from "@/features/marketer/owner-table";

type P = { id: string };
const limit = { bucket: "lead-owner-edit", limit: 240, windowMs: 60_000 };

/** Owner: edit one record { companyName?, contactPerson?, contactRole?, phone?, website?, outreachStatus?, status? } (strict). */
export const PATCH = route<P>({ team: true, permission: "marketerTable.manage", rateLimit: limit }, async ({ req, actor, params }) => updateLeadAssignment(actor, params.id, await readJson(req)));

/** Owner: delete one record (the Company record is not touched). */
export const DELETE = route<P>({ team: true, permission: "marketerTable.manage", rateLimit: limit }, async ({ actor, params }) => deleteLeadAssignment(actor, params.id));
