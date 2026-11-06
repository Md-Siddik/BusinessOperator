import { afterEach, describe, expect, it, vi } from "vitest";
import { mongo } from "mongoose";
import { Country, RegistrySync } from "@/models";
import { ensureCountries } from "@/features/countries/service";
import { getRegistryProvider } from "@/features/registry/providers";
import { startSync } from "@/features/registry/sync";
import { safeFailure } from "@/lib/diagnostics";
import { errorResponse } from "@/lib/api/handler";
import { createHttpClient, ProviderHttpError } from "@/features/registry/http";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("production sync regressions", () => {
  it("reports quota failure at the write stage before calling the registry", async () => {
    await ensureCountries();
    await Country.updateOne({ code: "NO" }, { $set: { enabled: true, providerId: "brreg" } });
    const quota = new mongo.MongoServerError({ message: "over your space quota SECRET_RECORD", code: 8000 });
    vi.spyOn(RegistrySync, "create").mockRejectedValueOnce(quota);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const schedule = vi.fn();
    const failure = await startSync({ countryCode: "NO", kind: "TODAY", trigger: "MANUAL" }, schedule).catch(e => e);
    expect(failure).toBe(quota);
    expect(errorResponse(failure).status).toBe(503);
    expect(schedule).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("[registry.sync]", expect.objectContaining({ stage: "create_sync_run", category: "database_capacity", errorCode: 8000 }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET_RECORD");
  });

  it("schedules the run once and completes a controlled empty sync in the isolated test database", async () => {
    const provider = getRegistryProvider("brreg")!;
    const fetch = vi.spyOn(provider as Required<typeof provider>, "getRegistrations").mockResolvedValue({ companies: [], total: 0, complete: true });
    let task: (() => Promise<void>) | undefined;
    const schedule = vi.fn((work: () => Promise<void>) => { task = work; });
    const result = await startSync({ countryCode: "NO", kind: "TODAY", trigger: "MANUAL" }, schedule);
    expect(fetch).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledOnce();
    expect((await startSync({ countryCode: "NO", kind: "TODAY", trigger: "MANUAL" }, schedule)).alreadyRunning).toBe(true);
    expect(schedule).toHaveBeenCalledOnce();
    await task!();
    expect((await RegistrySync.findById(result.syncId))?.status).toBe("SUCCESS");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("logs upstream status without URLs or response records", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("SECRET_RECORD", { status: 429 })));
    const client = createHttpClient({ name: "test-quota-provider", minIntervalMs: 0, maxRetries: 0 });
    await expect(client.json("https://example.test/?key=SECRET_KEY")).rejects.toBeInstanceOf(ProviderHttpError);
    expect(log).toHaveBeenCalledWith("[registry.http]", expect.objectContaining({ upstreamStatus: 429, durationMs: expect.any(Number) }));
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/SECRET_RECORD|SECRET_KEY/);
    expect(JSON.stringify(safeFailure(new Error("SECRET_RECORD")))).not.toContain("SECRET_RECORD");
  });
});
