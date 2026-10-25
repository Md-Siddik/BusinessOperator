import assert from "node:assert/strict";
import mongoose from "mongoose";
import { authenticate } from "@/features/auth/service";
import { beginLogin } from "@/features/auth/verification";
import { connectToDatabase } from "@/lib/db/connect";
import { setEmailProvider } from "@/lib/email/provider";
import { isActiveSessionUser, loadSessionUser } from "@/lib/auth/actor";
import { signSession, verifySession } from "@/lib/auth/token";

async function main() {
  const accounts = JSON.parse(process.env.LOGIN_TEST_ACCOUNTS!) as { email: string; password: string; verifiedAt: string }[];
  setEmailProvider({ id: "no-login-email", isLive: true, send: async () => { throw new Error("Login must not send email"); } });
  await connectToDatabase();
  for (const account of accounts) {
    const user = await authenticate({ email: account.email, password: account.password });
    assert.equal(await beginLogin(user), null);
    assert.equal(user.emailVerifiedAt!.toISOString(), account.verifiedAt);
    const token = await signSession({ sub: String(user._id), role: user.role, sv: user.sessionVersion ?? 0 });
    assert(isActiveSessionUser((await loadSessionUser(await verifySession(token)))!));
  }
  console.log("PASS: fresh process, all roles, password-only sessions, no email");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => mongoose.disconnect());
