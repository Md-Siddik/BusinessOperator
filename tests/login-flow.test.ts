import { beforeAll, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { User, type UserDoc } from "@/models";
import { setEmailProvider, type OutgoingEmail } from "@/lib/email/provider";
import { loadSessionUser } from "@/lib/auth/actor";
import { verifySession, signSession } from "@/lib/auth/token";

// Only Next's request-local cookie access is replaced. Routes, hashing, signed
// tokens, session loading, rate limits, verification and MongoDB are real.
const browser = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<typeof import("@/lib/auth/session")>()),
  getSessionUser: async () => loadSessionUser(await verifySession(browser.token)),
  setSessionCookie: async (payload: Parameters<typeof signSession>[0]) => { browser.token = await signSession(payload); },
  clearSessionCookie: async () => { browser.token = undefined; },
}));

import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as verify } from "@/app/api/auth/verify/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as refresh } from "@/app/api/auth/refresh/route";
import { GET as me } from "@/app/api/auth/me/route";
import { proxy } from "@/proxy";

const sent: OutgoingEmail[] = [];
beforeAll(() => setEmailProvider({ id: "login-test", isLive: true, send: async mail => { sent.push(mail); return { id: String(sent.length) }; } }));
let requestId = 0;
const context = { params: Promise.resolve({}) };
function request(path: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `login-flow-${++requestId}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

it("registers once, then logs every role in/out five times with no codes, including a new process and browser", async () => {
  const accounts: { email: string; password: string; verifiedAt: string }[] = [];
  for (const role of ["OWNER", "ADMIN", "STAFF", "CLIENT"] as const) {
    const email = `flow-${role.toLowerCase()}@example.test`;
    const password = "Verified-login-password-123";
    browser.token = undefined;
    const registered = await signup(request("/api/auth/signup", { name: "Login Flow", email, password }), context);
    expect(registered.status).toBe(200);
    const mail = sent.find(item => item.to === email)!;
    expect(mail).toBeTruthy();
    const code = mail.text.match(/code is ([0-9]{6})/)![1];
    expect((await verify(request("/api/auth/verify", { email, code }), context)).status).toBe(200);
    const verified = await User.findOne({ email }).lean<UserDoc>();
    expect(verified!.emailVerifiedAt).toBeTruthy();
    // Role assignment is fixture setup, after real ownership verification.
    await User.updateOne({ _id: verified!._id }, { $set: { role } });
    const before = sent.length;
    for (let cycle = 0; cycle < 5; cycle++) {
      expect((await logout(request("/api/auth/logout", {}), context)).status).toBe(200);
      expect(browser.token).toBeUndefined();
      const response = await login(request("/api/auth/login", { email, password }), context);
      expect(response.status).toBe(200);
      const result = await response.json();
      const home = role === "OWNER" ? "/dashboard" : role === "CLIENT" ? "/portal" : "/staff";
      expect(result).toEqual({ redirect: home });
      expect(browser.token).toBeTruthy();
      expect((await verifySession(browser.token))?.mf).toBe(false);
      expect((await me(request("/api/auth/me"), context)).status).toBe(200);
      const renewal = request("/api/auth/refresh", {});
      renewal.cookies.set("et_session", browser.token!);
      expect((await refresh(renewal, context)).status).toBe(200);
      expect((await verifySession(browser.token))?.mf).toBe(false);
      const page = new NextRequest(`http://localhost${home}`, { headers: { cookie: `et_session=${browser.token}` } });
      expect((await proxy(page)).headers.get("x-middleware-next")).toBe("1");
      expect(sent).toHaveLength(before);
      expect((await User.findById(verified!._id).lean<UserDoc>())!.emailVerifiedAt).toEqual(verified!.emailVerifiedAt);
    }
    const bad = await login(request("/api/auth/login", { email, password: "incorrect" }), context);
    expect(bad.status).toBe(401);
    expect(sent).toHaveLength(before);
    accounts.push({ email, password, verifiedAt: verified!.emailVerifiedAt!.toISOString() });
  }
  // A fresh Node process has no cached auth modules, cookies or frontend state.
  const child = await promisify(execFile)(process.execPath, ["--conditions=react-server", "--import", "tsx", "tests/fixtures/password-login-process.ts"], {
    env: { ...process.env, LOGIN_TEST_ACCOUNTS: JSON.stringify(accounts) }, timeout: 30_000,
  });
  expect(child.stdout).toContain("PASS: fresh process, all roles, password-only sessions, no email");
  expect(sent.filter(mail => accounts.some(account => account.email === mail.to))).toHaveLength(4);
});

it("does not send a code or create a session for an unfinished registration during login", async () => {
  const email = "unfinished-login@example.test", password = "Unfinished-password-123";
  browser.token = undefined;
  await signup(request("/api/auth/signup", { name: "Unfinished", email, password }), context);
  const before = sent.length;
  const response = await login(request("/api/auth/login", { email, password }), context);
  expect(await response.json()).toEqual({ registrationRequired: true, email });
  expect(browser.token).toBeUndefined();
  expect(sent).toHaveLength(before);
  expect((await me(request("/api/auth/me"), context)).status).toBe(401);
});
