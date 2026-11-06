import { afterEach, describe, expect, it, vi } from "vitest";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import { configureMongoDns, hasExplicitMongoDatabase } from "@/lib/db/configuration";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe("MongoDB connection configuration", () => {
  it("keeps system DNS unless explicitly configured", () => {
    const set = vi.spyOn(dns, "setServers").mockImplementation(() => undefined);
    vi.stubEnv("MONGODB_DNS_SERVERS", "");
    configureMongoDns(); expect(set).not.toHaveBeenCalled();
  });
  it("applies validated process-local resolvers without changing the URI or TLS", () => {
    const set = vi.spyOn(dns, "setServers").mockImplementation(() => undefined);
    const setPromises = vi.spyOn(dnsPromises, "setServers").mockImplementation(() => undefined);
    vi.spyOn(dns, "getServers").mockReturnValue(["127.0.0.1"]);
    vi.spyOn(dnsPromises, "getServers").mockReturnValue(["127.0.0.1"]);
    configureMongoDns("1.1.1.1, 8.8.8.8");
    expect(set).toHaveBeenCalledWith(["1.1.1.1", "8.8.8.8"]);
    expect(setPromises).toHaveBeenCalledWith(["1.1.1.1", "8.8.8.8"]);
  });
  it("repairs a promise resolver initialized before the callback resolver was configured", () => {
    const set = vi.spyOn(dns, "setServers").mockImplementation(() => undefined);
    const setPromises = vi.spyOn(dnsPromises, "setServers").mockImplementation(() => undefined);
    vi.spyOn(dns, "getServers").mockReturnValue(["1.1.1.1", "8.8.8.8"]);
    vi.spyOn(dnsPromises, "getServers").mockReturnValue(["127.0.0.1"]);
    configureMongoDns("1.1.1.1,8.8.8.8");
    expect(set).not.toHaveBeenCalled();
    expect(setPromises).toHaveBeenCalledWith(["1.1.1.1", "8.8.8.8"]);
  });
  it("rejects malformed resolvers without exposing their values", () => {
    const set = vi.spyOn(dns, "setServers").mockImplementation(() => undefined);
    expect(() => configureMongoDns("secret.invalid")).toThrow("one to three DNS server IP addresses");
    expect(() => configureMongoDns("1.1.1.1,")).toThrow();
    expect(set).not.toHaveBeenCalled();
  });
  it("requires explicit database names for SRV and standard replica-set URIs", () => {
    expect(hasExplicitMongoDatabase("mongodb+srv://user:pass@cluster.example/")).toBe(false);
    expect(hasExplicitMongoDatabase("mongodb+srv://user:pass@cluster.example/?retryWrites=true")).toBe(false);
    expect(hasExplicitMongoDatabase("mongodb+srv://user:pass@cluster.example/ExploreTechify?retryWrites=true")).toBe(true);
    expect(hasExplicitMongoDatabase("mongodb://host1:27017,host2:27017/ExploreTechify?tls=true")).toBe(true);
  });
});
