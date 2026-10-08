import { beforeAll, describe, expect, it } from "vitest";
import { Company, EmailMessage, EmailTemplate, Organization, User, type CompanyDoc, type EmailMessageDoc, type UserDoc } from "@/models";
import { hashPassword } from "@/lib/auth/password";
import { isActiveSessionUser, loadSessionUser } from "@/lib/auth/actor";
import { validateUpload } from "@/lib/storage";
import { addSuppression, checkSuppression } from "@/features/outreach/suppression";
import { approveMessage, createDraftForCompany, sendApprovedMessage, submitForReview } from "@/features/outreach/service";
import { authenticate, signupClient } from "@/features/auth/service";
import { setOrganizationStatus } from "@/features/clients/service";
import { expectRejects, makeTenants } from "./helpers";

let t: Awaited<ReturnType<typeof makeTenants>>;
let templateId: string;

async function makeCompany(email: string) {
  return Company.create({ companyName: `Test ${email}`, countryCode: "NO", source: "test", sourceId: email, email, industry: "technology", lead: { stage: "QUALIFIED", score: 70 }, eligibility: { status: "CLEARED", reason: "test" }, isDemo: true });
}

beforeAll(async () => {
  t = await makeTenants();
  const tpl = await EmailTemplate.create({ name: "T", subject: "Hello {{companyName}}", body: "Hi {{contactName|there}}, about {{companyName}} in {{country}}.", countryCode: "NO", languageCode: "en" });
  templateId = String(tpl._id);
});

describe("Email compliance", () => {
  it("draft → review → approve → send, with personalization from facts only", async () => {
    const c = await makeCompany("ok@acme.example");
    const draft = await createDraftForCompany(t.staff.actor, { companyId: String(c._id), templateId });
    expect(draft.status).toBe("DRAFT");
    expect(draft.body).toBe("Hi there, about Test ok@acme.example in Norway.");
    expect((draft.personalization as { missing: string[] }).missing).toContain("contactName");
    await expectRejects(approveMessage(t.admin.actor, String(draft._id)), 400); // not yet submitted
    await submitForReview(t.staff.actor, String(draft._id));
    await expectRejects(approveMessage(t.staff.actor, String(draft._id)), 403); // staff can't approve
    await approveMessage(t.admin.actor, String(draft._id));
    await sendApprovedMessage(t.admin.actor, String(draft._id));
    const sent = await EmailMessage.findById(draft._id).lean<EmailMessageDoc>();
    expect(sent?.status).toBe("SENT");
    expect(sent?.simulated).toBe(true);
    expect((await Company.findById(c._id).lean<CompanyDoc>())?.lead?.stage).toBe("CONTACTED");
  });

  it("availability is not permission: uncleared companies cannot be drafted", async () => {
    const c = await makeCompany("review@acme.example");
    await Company.updateOne({ _id: c._id }, { $set: { "eligibility.status": "NEEDS_REVIEW" } });
    await expectRejects(createDraftForCompany(t.staff.actor, { companyId: String(c._id), templateId }), 400);
    await Company.updateOne({ _id: c._id }, { $set: { "eligibility.status": "RESTRICTED" } });
    await expectRejects(createDraftForCompany(t.staff.actor, { companyId: String(c._id), templateId }), 400);
  });

  it("a second person must approve (no self-approval)", async () => {
    const c = await makeCompany("self@acme.example");
    const draft = await createDraftForCompany(t.admin.actor, { companyId: String(c._id), templateId });
    await submitForReview(t.admin.actor, String(draft._id));
    await expectRejects(approveMessage(t.admin.actor, String(draft._id)), 403);
  });

  it("suppressed addresses cannot be drafted, approved or sent", async () => {
    await addSuppression(t.admin.actor, { email: "optout@acme.example", reason: "OPT_OUT" });
    const blocked = await makeCompany("optout@acme.example");
    await expectRejects(createDraftForCompany(t.staff.actor, { companyId: String(blocked._id), templateId }), 400);

    // Opt-out arriving between approval and sending is caught at send time.
    const late = await makeCompany("late@later.example");
    const draft = await createDraftForCompany(t.staff.actor, { companyId: String(late._id), templateId });
    await submitForReview(t.staff.actor, String(draft._id));
    await approveMessage(t.admin.actor, String(draft._id));
    await addSuppression(null, { email: "late@later.example", reason: "OPT_OUT" }, "unsubscribe-link");
    await expectRejects(sendApprovedMessage(t.admin.actor, String(draft._id)), 400);
    expect((await EmailMessage.findById(draft._id).lean<EmailMessageDoc>())?.status).toBe("SUPPRESSED");
  });

  it("domain-level suppression covers every address at the domain", async () => {
    await addSuppression(t.admin.actor, { domain: "blocked-domain.example", reason: "DO_NOT_CONTACT" });
    expect((await checkSuppression("Anyone@Blocked-Domain.example")).suppressed).toBe(true);
    expect((await checkSuppression("someone@fine.example")).suppressed).toBe(false);
  });
});

describe("Authentication & accounts", () => {
  it("signup creates a pending CLIENT with no privileges and no access", async () => {
    await signupClient({ name: "New Person", company: "New Co", email: "new@co.example", password: "a-very-long-password", country: "SE", preferredLanguage: "sv" });
    const user = await User.findOne({ email: "new@co.example" }).lean<UserDoc>();
    expect(user?.role).toBe("CLIENT");
    expect(user?.status).toBe("PENDING_APPROVAL");
    expect(user?.permissions ?? []).toHaveLength(0);
    const session = await loadSessionUser({ sub: String(user!._id), role: "CLIENT", sv: 0 });
    expect(session && isActiveSessionUser(session)).toBe(false);

    await setOrganizationStatus(t.owner.actor, String(user!.organizationId), "ACTIVE");
    const approved = await loadSessionUser({ sub: String(user!._id), role: "CLIENT", sv: 0 });
    expect(approved && isActiveSessionUser(approved)).toBe(true);
  });

  it("duplicate signups do not reveal existing accounts", async () => {
    await expect(signupClient({ name: "Dup", company: "Dup", email: "new@co.example", password: "another-long-password", country: "SE" })).resolves.toEqual({ ok: true });
    expect(await User.countDocuments({ email: "new@co.example" })).toBe(1);
  });

  it("rejects wrong passwords and suspended accounts with the same generic error", async () => {
    const passwordHash = await hashPassword("correct-horse-battery");
    const u = await User.create({ name: "Login", email: "login@test.example", passwordHash, role: "STAFF", status: "ACTIVE" });
    await expect(authenticate({ email: "login@test.example", password: "correct-horse-battery" })).resolves.toBeTruthy();
    await expectRejects(authenticate({ email: "login@test.example", password: "wrong" }), 401);
    await expectRejects(authenticate({ email: "nobody@test.example", password: "whatever" }), 401);
    await User.updateOne({ _id: u._id }, { status: "SUSPENDED" });
    await expectRejects(authenticate({ email: "login@test.example", password: "correct-horse-battery" }), 401);
  });

  it("revoked sessions (sessionVersion bump) are rejected", async () => {
    const u = await User.findOne({ email: "new@co.example" }).lean<UserDoc>();
    await User.updateOne({ _id: u!._id }, { $inc: { sessionVersion: 1 } });
    expect(await loadSessionUser({ sub: String(u!._id), role: "CLIENT", sv: 0 })).toBeNull();
  });

  it("suspending an organization blocks its users", async () => {
    await Organization.updateOne({ _id: t.orgA._id }, { status: "SUSPENDED" });
    expect(await loadSessionUser({ sub: t.clientA.actor.id, role: "CLIENT", sv: 0 })).toBeNull();
    await Organization.updateOne({ _id: t.orgA._id }, { status: "ACTIVE" });
  });
});

describe("Upload validation", () => {
  const file = (name: string, type: string, bytes: Buffer) => new File([new Uint8Array(bytes)], name, { type });
  it("accepts real PDFs and images", async () => {
    await expect(validateUpload(file("a.pdf", "application/pdf", Buffer.from("%PDF-1.7 test")))).resolves.toBeTruthy();
    await expect(validateUpload(file("a.png", "image/png", Buffer.from("89504e470d0a1a0a", "hex")))).resolves.toBeTruthy();
  });
  it("rejects executables, disguised files and disallowed types", async () => {
    await expectRejects(validateUpload(file("run.exe", "application/octet-stream", Buffer.from("MZ..."))), 400);
    await expectRejects(validateUpload(file("invoice.pdf", "application/pdf", Buffer.from("MZ disguised exe"))), 400);
    await expectRejects(validateUpload(file("photo.png", "image/png", Buffer.from("%PDF-1.4"))), 400);
    await expectRejects(validateUpload(file("script.js", "text/javascript", Buffer.from("alert(1)"))), 400);
  });
});
