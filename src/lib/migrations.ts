import "server-only";
import type { Types } from "mongoose";
import { Company, Contact, SystemSetting, type ContactDoc } from "@/models";
import { classifyContactValue } from "@/lib/company-fields";

/**
 * Safe, idempotent schema migrations (tracked in SystemSetting "__migrations").
 * Each step only fills missing fields — never overwrites existing values.
 */
const STEPS: { id: string; run: (log: (m: string) => void) => Promise<void> }[] = [
  {
    id: "2026-10-contact-research-v1",
    async run(log) {
      // Companies: date semantics + workflow defaults.
      const a = await Company.updateMany({ firstSeenAt: { $exists: false } }, [{ $set: { firstSeenAt: "$createdAt" } }]);
      const b = await Company.updateMany({ eventType: { $exists: false } }, { $set: { eventType: "NEW_ENTITY" } });
      const c = await Company.updateMany({ "eligibility.status": { $exists: false } }, { $set: { "eligibility.status": "NEEDS_REVIEW" } });
      await Company.updateMany({ marketingProtected: true, "eligibility.status": "NEEDS_REVIEW" }, { $set: { "eligibility.status": "RESTRICTED", "eligibility.reason": "Marketing restriction published by the source", "eligibility.at": new Date() } });
      const d = await Company.updateMany({ "research.status": { $exists: false } }, { $set: { "research.status": "NOT_STARTED", "research.attempts": 0 } });
      log(`companies: firstSeenAt ${a.modifiedCount}, eventType ${b.modifiedCount}, eligibility ${c.modifiedCount}, research ${d.modifiedCount}`);

      // Contacts: classification + ownership + verification defaults.
      const cursor = Contact.find({ usable: { $exists: false } }).lean<ContactDoc[]>().cursor();
      const touched = new Set<string>();
      let n = 0;
      for await (const k of cursor) {
        const set: Record<string, unknown> = { ownership: k.sourceKind === "REGISTRY" || k.sourceKind === "MANUAL" ? "CONFIRMED" : "LIKELY", review: "NONE", collectedAt: k.createdAt };
        if (k.type === "EMAIL" || k.type === "PHONE" || k.type === "MOBILE") {
          const cls = classifyContactValue(k.type, k.value);
          Object.assign(set, { usable: cls.usable, purpose: cls.purpose, unusableReason: cls.reason });
          if (k.type === "EMAIL") set.emailVerification = k.verified ? "SOURCE_CONFIRMED" : k.sourceKind === "REGISTRY" || k.sourceKind === "WEBSITE" || k.sourceKind === "MANUAL" ? "SOURCE_CONFIRMED" : "UNKNOWN";
          else set.phoneVerification = "PUBLISHED";
        } else set.usable = true;
        await Contact.updateOne({ _id: k._id }, { $set: set });
        touched.add(String(k.companyId));
        n++;
      }
      log(`contacts classified: ${n}`);
      const { recomputeCompanyContacts } = await import("@/features/research/contacts");
      for (const id of touched) await recomputeCompanyContacts(id as unknown as Types.ObjectId);
      log(`companies re-ranked: ${touched.size}`);
    },
  },
];

export async function runMigrations(log: (m: string) => void = (m) => console.info(`[migrate] ${m}`)) {
  const doc = await SystemSetting.findOne({ key: "__migrations" }).lean<{ value?: { done?: string[] } }>();
  const done = new Set(doc?.value?.done ?? []);
  for (const step of STEPS) {
    if (done.has(step.id)) continue;
    log(`running ${step.id}`);
    await step.run(log);
    done.add(step.id);
    await SystemSetting.updateOne({ key: "__migrations" }, { $set: { value: { done: [...done] } } }, { upsert: true });
  }
  return [...done];
}
