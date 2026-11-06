import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ApiError, formErrorMessage } from "@/lib/api/client";
import { errorResponse } from "@/lib/api/handler";
import { DatabaseUnavailableError, isDatabaseConfigured } from "@/lib/db/connect";
import { Errors } from "@/lib/errors";
import { signSession } from "@/lib/auth/token";
import messages from "../messages/en.json";
import { mongo, models } from "mongoose";
import { NextRequest } from "next/server";
import { POST as login } from "@/app/api/auth/login/route";
import { User } from "@/models";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("login failure reporting", () => {
  const unavailable = messages.auth.login.unavailable;
  it("retains the credential error only for a rejected password", async () => {
    const response = errorResponse(Errors.unauthorized("Invalid email or password."));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const error = await apiFetch("/api/auth/login", { body: {} }).catch(e => e);
    expect(error).toMatchObject({ status: 401 });
    expect(formErrorMessage(error, unavailable)).toBe(messages.auth.login.invalid);
  });
  it("does not label database or server failures as invalid credentials", async () => {
    const response = errorResponse(new DatabaseUnavailableError());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const error = await apiFetch("/api/auth/login", { body: {} }).catch(e => e);
    expect(error).toMatchObject({ status: 503 });
    expect(formErrorMessage(error, unavailable)).toBe(unavailable);
    expect(formErrorMessage(new ApiError(500, "Internal error"), unavailable)).toBe(unavailable);
    expect(formErrorMessage(new Error("Unexpected response"), unavailable)).toBe(unavailable);
  });
  it("reports a full database before password lookup without bypassing rate limiting", async () => {
    const quota = new mongo.MongoServerError({ message: "you are over your space quota, using 513 MB of 512 MB", code: 8000 });
    vi.spyOn(models.AuthRateLimit, "findOneAndUpdate").mockImplementationOnce(() => { throw quota; });
    const lookup = vi.spyOn(User, "findOne");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = new NextRequest("http://localhost/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "existing-owner@example.test", password: "synthetic-test-input" }),
    });
    const response = await login(request, { params: Promise.resolve({}) });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "UNAVAILABLE", message: "Service temporarily unavailable." } });
    expect(lookup).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("[db] Storage quota exceeded; database writes are unavailable.");
  });
  it("keeps network, origin and rate-limit failures distinguishable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const error = await apiFetch("/api/auth/login", { body: {} }).catch(e => e);
    expect(error).toMatchObject({ status: 0 });
    expect(formErrorMessage(error, unavailable)).toContain("Network error");
    expect(formErrorMessage(new ApiError(403, "Cross-site request blocked"), unavailable)).toBe("Cross-site request blocked");
    expect(formErrorMessage(new ApiError(429, "Please wait"), unavailable)).toBe("Please wait");
  });
});

describe("authentication configuration safeguards", () => {
  it("refuses an implicit local database in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("MONGODB_URI", "");
    vi.stubEnv("ALLOW_LOCAL_DB", "false");
    expect(isDatabaseConfigured()).toBe(false);
  });
  it("refuses to issue production sessions without a valid signing secret", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("AUTH_SECRET", "");
    await expect(signSession({ sub: "existing-account", role: "OWNER", sv: 0 })).rejects.toThrow("AUTH_SECRET must be set");
  });
});
