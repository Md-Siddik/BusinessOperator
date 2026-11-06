import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAcraSgProvider } from "@/features/registry/providers/acra-sg";
import { createSsmMyProvider } from "@/features/registry/providers/ssm-my";
import { clearBulkCache } from "@/features/registry/bulk-file";
import { ensureCountries } from "@/features/countries/service";
import { runDueSyncs, syncDate } from "@/features/registry/sync";
import { Company, Country } from "@/models";
import { addDays, todayIn } from "@/lib/dates/country-time";

const dataset = "d_af2042c77ffaf0db5d75561ce9ef5688";
const today = todayIn("Asia/Singapore");
const oldDay = addDays(today, -40);
const publishedAt = `${today}T00:00:00Z`;
function source(csv: string, ready = true) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/metadata")) return Response.json({ code: 0, data: { collectionMetadata: { childDatasets: [dataset], lastUpdatedAt: publishedAt } } });
    if (url.endsWith("/initiate-download")) return Response.json({ code: 0 });
    if (url.endsWith("/poll-download")) return Response.json({ code: 0, data: ready ? { url: "https://data.gov.sg/fixture.csv" } : {} });
    if (url === "https://data.gov.sg/fixture.csv") return new Response(init?.method === "HEAD" ? null : csv, { headers: { ETag: "test-publication-1", "Last-Modified": new Date(publishedAt).toUTCString() } });
    throw new Error(`Unexpected source request: ${url}`);
  });
}
const header = "uen,entity_name,registration_incorporation_date,entity_status_description";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); clearBulkCache(); });

describe("Singapore monthly publication and scheduled imports", () => {
  it("imports late monthly records through the daily scheduler with original dates and idempotency", async () => {
    vi.stubGlobal("fetch", source(`${header}\n202600099A,Monthly fixture,${oldDay},LIVE COMPANY`));
    await ensureCountries();
    await Country.updateMany({}, { $set: { syncEnabled: false } });
    await Country.updateOne({ code: "SG" }, { $set: { enabled: true, syncEnabled: true, providerId: "acra-sg", lastSuccessAt: new Date(), lastSyncAt: new Date(0) } });
    const runs = await runDueSyncs();
    expect(runs.find((r) => r.country === "SG")?.status).toBe("SUCCESS");
    const c = await Company.findOne({ countryCode: "SG", sourceId: "202600099A" });
    expect(c?.registrationDay).toBe(oldDay); expect(c?.sourcePublishedAt?.toISOString()).toBe(publishedAt.replace("Z", ".000Z"));
    expect(c?.sourceFetchedAt).toBeTruthy();
    await syncDate("SG", oldDay);
    expect(await Company.countDocuments({ countryCode: "SG", sourceId: "202600099A" })).toBe(1);
  });
  it("returns successful zero results for a day without new records and filters dates", async () => {
    vi.stubGlobal("fetch", source(`${header}\n202600100A,Old fixture,${oldDay},LIVE COMPANY`));
    const p = createAcraSgProvider();
    const result = await p.getRegistrations!(today, today, { limit: 10 });
    expect(result).toMatchObject({ companies: [], complete: true, total: 0 });
  });
  it("reports truncation honestly and deduplicates UENs", async () => {
    const row = `202600101A,Duplicate fixture,${today},LIVE COMPANY`;
    vi.stubGlobal("fetch", source(`${header}\n${row}\n${row}\n202600102A,Other fixture,${today},LIVE COMPANY`));
    expect(await createAcraSgProvider().getRegistrations!(today, today, { limit: 1 })).toMatchObject({ complete: false, total: 2 });
  });
  it("reports incomplete download preparation instead of a successful empty import", async () => {
    vi.stubGlobal("fetch", source(header, false));
    await expect(createAcraSgProvider().getRegistrations!(today, today, { limit: 10 })).rejects.toThrow("preparing");
  }, 30_000);
  it("rejects unauthorized upstream access without treating it as empty data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Forbidden", { status: 403 })));
    expect((await createAcraSgProvider().checkStatus()).state).toBe("UNAVAILABLE");
  });
});

describe("Malaysia authorized file ingestion", () => {
  it("filters actual incorporation dates and handles empty and repeated licensed files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ssm-test-"));
    const path = join(directory, "export.json");
    vi.stubEnv("MALAYSIA_SSM_EXPORT_PATH", path); vi.stubEnv("MALAYSIA_SSM_EXPORT_AUTHORIZED", "true");
    try {
      const data = { sourceUrl: "https://www.ssm.com.my/", publishedAt, records: [{ registrationNumber: "202601000002", name: "Licensed fixture", registrationDay: oldDay }] };
      await writeFile(path, JSON.stringify(data));
      const p = createSsmMyProvider();
      expect((await p.getRegistrations!(today, today, { limit: 10 })).companies).toHaveLength(0);
      expect((await p.getRegistrations!(oldDay, today, { limit: 10 })).companies).toHaveLength(1);
      await writeFile(path, JSON.stringify({ ...data, records: [] }));
      expect(await p.getRegistrations!(oldDay, today, { limit: 10 })).toMatchObject({ complete: true, total: 0 });
      await writeFile(path, "invalid");
      expect((await p.checkStatus()).state).toBe("UNAVAILABLE");
    } finally { await rm(directory, { recursive: true }); }
  });
});
