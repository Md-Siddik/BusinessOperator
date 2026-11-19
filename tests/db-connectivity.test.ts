import { afterEach, describe, expect, it, vi } from "vitest";
import mongoose, { mongo } from "mongoose";
import { NextRequest } from "next/server";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as diagnostics } from "@/app/api/internal/network-diagnostics/route";
import { databaseFailureCategory } from "@/lib/db/errors";
import { User } from "@/models";

type MongoState = { conn?: typeof mongoose; promise?: Promise<typeof mongoose> };
const state = () => (globalThis as unknown as { __etMongo: MongoState }).__etMongo;
const TOKEN = "diagnostic-token-diagnostic-token-0123456789";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function named(name: string, message: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { name }, extra);
}

/** Simulate a cold function whose MongoDB connection attempt fails with `error`. */
async function withFailingConnect<T>(error: Error, run: () => Promise<T>) {
  const previous = { ...state() };
  state().conn = undefined;
  state().promise = undefined;
  const connect = vi.spyOn(mongoose, "connect").mockRejectedValue(error);
  try { return await run(); }
  finally { connect.mockRestore(); Object.assign(state(), previous); }
}

function loginRequest() {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.20" },
    body: JSON.stringify({ email: "existing-owner@example.test", password: "synthetic-test-input" }),
  });
}

describe("database connectivity failures during login", () => {
  const cases: [string, Error, string][] = [
    ["Atlas IP Access List rejection (server selection timeout)",
      named("MongooseServerSelectionError", "Could not connect to any servers in your MongoDB Atlas cluster. cluster0.example.mongodb.net:27017 IP that isn't whitelisted"),
      "database_network"],
    ["rejected database credentials",
      new mongo.MongoServerError({ message: "bad auth : authentication failed for user app-user", code: 18 }),
      "database_authentication"],
    ["SRV/DNS lookup failure",
      named("Error", "querySrv ENOTFOUND _mongodb._tcp.cluster0.example.mongodb.net", { code: "ENOTFOUND" }),
      "database_connect"],
  ];
  for (const [label, error, category] of cases) {
    it(`returns 503, never invalid credentials, for ${label}`, async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const lookup = vi.spyOn(User, "findOne");
      const response = await withFailingConnect(error, () => login(loginRequest(), { params: Promise.resolve({}) }));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: { code: "UNAVAILABLE", message: "Service temporarily unavailable." } });
      expect(lookup).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith("[api.database]", expect.objectContaining({ stage: "database_connect", path: "/api/auth/login", category }));
      const logged = JSON.stringify(log.mock.calls);
      for (const secret of ["example.mongodb.net", "app-user", "existing-owner@example.test", "synthetic-test-input"]) expect(logged).not.toContain(secret);
    });
  }

  it("retries on the next request after a failed connection attempt", async () => {
    await withFailingConnect(named("MongooseServerSelectionError", "timeout"), async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect((await login(loginRequest(), { params: Promise.resolve({}) })).status).toBe(503);
      expect(state().promise).toBeUndefined();
    });
  });

  it("still reports wrong credentials as 401 when the database is reachable", async () => {
    const response = await login(loginRequest(), { params: Promise.resolve({}) });
    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toBe("Invalid email or password.");
  });

  it("does not classify ordinary errors as database failures", () => {
    expect(databaseFailureCategory(new Error("boom"))).toBeUndefined();
    expect(databaseFailureCategory(new mongo.MongoServerError({ message: "dup", code: 11000 }))).toBeUndefined();
  });
});

describe("network diagnostics endpoint", () => {
  const call = (token?: string) => diagnostics(new NextRequest("http://localhost/api/internal/network-diagnostics", {
    headers: { "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200)}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
  }));

  it("is hidden when no token is configured", async () => {
    vi.stubEnv("NETWORK_DIAGNOSTICS_TOKEN", "");
    expect((await call(TOKEN)).status).toBe(404);
  });

  it("is hidden for a missing or wrong token", async () => {
    vi.stubEnv("NETWORK_DIAGNOSTICS_TOKEN", TOKEN);
    expect((await call()).status).toBe(404);
    expect((await call(`${TOKEN}x`)).status).toBe(404);
  });

  it("refuses a short token configuration", async () => {
    vi.stubEnv("NETWORK_DIAGNOSTICS_TOKEN", "short");
    expect((await call("short")).status).toBe(404);
  });

  it("reports the observed outbound IP and database reachability without secrets", async () => {
    vi.stubEnv("NETWORK_DIAGNOSTICS_TOKEN", TOKEN);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ip: "203.0.113.7" })));
    const response = await call(TOKEN);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ status: "ok", outboundIp: { address: "203.0.113.7", version: "IPv4" }, database: { reachable: true, stage: "ping" } });
    const text = JSON.stringify(body);
    expect(text).not.toContain(process.env.MONGODB_URI!);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(process.env.AUTH_SECRET!);
  });

  it("reports a blocked database and a failed IP lookup as degraded", async () => {
    vi.stubEnv("NETWORK_DIAGNOSTICS_TOKEN", TOKEN);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const response = await withFailingConnect(named("MongooseServerSelectionError", "cluster0.example.mongodb.net blocked"), () => call(TOKEN));
    const body = await response.json();
    expect(body).toMatchObject({ status: "degraded", outboundIp: { address: null, error: "lookup_failed" }, database: { reachable: false, stage: "connect", category: "database_network" } });
    expect(JSON.stringify(body)).not.toContain("example.mongodb.net");
  });
});
