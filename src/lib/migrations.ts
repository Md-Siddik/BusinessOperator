import "server-only";
import type { Types } from "mongoose";
import { Company, Contact, ContactRequest, Service, SystemSetting, type ContactDoc } from "@/models";
import { classifyContactValue } from "@/lib/company-fields";
import { LANGUAGE_CODES } from "@/config/languages";
import { SERVICE_PAGES } from "@/config/service-pages";
import { getBaseMessages } from "@/lib/i18n/dictionaries";
import { createTranslator } from "@/lib/i18n/translator";
import { defaultServiceRecord, defaultTranslation } from "@/features/service-catalog/view";

/**
 * Safe, idempotent schema migrations (tracked in SystemSetting "__migrations").
 * Each step only fills missing fields — never overwrites existing values.
 */
const STEPS: { id: string; run: (log: (m: string) => void) => Promise<void> }[] = [
  {
    id: "2026-10-auth-budget-v1",
    async run(log) {
      const { default: mongoose } = await import("mongoose");
      await mongoose.connection.db!.collection("authratelimits").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      log("Authentication rate-limit expiry index created.");
    },
  },
  {
    id: "2026-10-verified-inquiries-v1",
    async run(log) {
      await ContactRequest.collection.createIndex({ submissionKey: 1 }, { unique: true, sparse: true });
      await ContactRequest.collection.createIndex({ userId: 1 });
      await ContactRequest.collection.createIndex({ email: 1, createdAt: -1 });
      log("Inquiry ownership and idempotency indexes created; existing records and verification status preserved.");
    },
  },
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
  {
    id: "2026-10-service-catalogue-v1",
    /**
     * Seed the public service catalogue from the services the website already presented
     * (src/config/service-pages.ts + "servicePages.*" in the dictionaries). Only when the
     * collection is empty; no prices are invented (amounts stay empty). Norwegian and any
     * other written translation become per-language overrides.
     */
    async run(log) {
      if (await Service.exists({})) return log("services: catalogue already exists — nothing seeded");
      const en = createTranslator(getBaseMessages("en")).raw;
      const docs = SERVICE_PAGES.map((page, i) => {
        const base = defaultServiceRecord(page, en, i);
        const enText = JSON.stringify(defaultTranslation(page, en));
        const translations: Record<string, unknown> = {};
        for (const locale of LANGUAGE_CODES.filter((l) => l !== "en")) {
          const tr = defaultTranslation(page, createTranslator(getBaseMessages(locale)).raw);
          if (JSON.stringify(tr) !== enText) translations[locale] = tr; // only real translations, not English copies
        }
        return { ...base, translations };
      });
      await Service.insertMany(docs);
      log(`services: seeded ${docs.length} services from the existing landing pages`);
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
