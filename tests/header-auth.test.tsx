import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthButton, HeaderAuthProvider, type HeaderAuthState } from "@/components/site/auth-button";
import { SessionHeader } from "@/components/site/session-header";
import { getSessionUser } from "@/lib/auth/session";

vi.mock("@/lib/auth/session", () => ({ getSessionUser: vi.fn(), homeFor: (role: string) => role === "OWNER" ? "/dashboard" : role === "CLIENT" ? "/portal" : "/staff" }));
vi.mock("next/navigation", () => ({ usePathname: () => "/en" }));

const render = (state: HeaderAuthState) => renderToStaticMarkup(
  <HeaderAuthProvider initialState={state}><AuthButton loginHref="/en/login" loginLabel="Login" /></HeaderAuthProvider>,
);

describe("initial header authentication HTML", () => {
  it("includes a usable Login link before hydration or API requests", () => {
    const html = render({ kind: "signed-out" });
    expect(html).toContain('href="/en/login"');
    expect(html).toContain(">Login</a>");
    expect(html).not.toContain("text-transparent");
    expect(html).not.toContain("animate-pulse");
  });
  it.each(["OWNER", "STAFF", "CLIENT"])("renders the known %s profile without a Login flash", (role) => {
    const html = render({ kind: "signed-in", role, name: "Alex", home: role === "OWNER" ? "/dashboard" : role === "CLIENT" ? "/portal" : "/staff" });
    expect(html).toContain('aria-label="User profile menu"');
    expect(html).not.toContain('href="/en/login"');
  });
  it("keeps an unresolved session visible and accessible without claiming it is signed out", () => {
    const html = render({ kind: "unresolved" });
    expect(html).toContain('role="status"');
    expect(html).toContain("Account");
    expect(html).not.toContain(">Login");
    expect(html).not.toContain("aria-hidden");
  });
  it("uses live validation and handles database failure as unresolved", async () => {
    const props = { locale: "en", enabledLanguages: ["en"], labels: {} as never };
    vi.mocked(getSessionUser).mockResolvedValueOnce(null);
    expect((await SessionHeader(props)).props.initialAuth).toEqual({ kind: "signed-out" });
    vi.mocked(getSessionUser).mockRejectedValueOnce(new Error("database unavailable"));
    expect((await SessionHeader(props)).props.initialAuth).toEqual({ kind: "unresolved" });
  });
  it.each([
    ["ACTIVE", "ACTIVE", true],
    ["PENDING_APPROVAL", "PENDING_APPROVAL", true],
    ["SUSPENDED", "ACTIVE", false],
    ["ACTIVE", "SUSPENDED", false],
  ])("matches status API eligibility for %s / %s", async (status, organizationStatus, signedIn) => {
    vi.mocked(getSessionUser).mockResolvedValueOnce({ role: "CLIENT", name: "Alex", status, organizationStatus, emailVerifiedAt: new Date() } as never);
    const header = await SessionHeader({ locale: "en", enabledLanguages: ["en"], labels: {} as never });
    expect(header.props.initialAuth.kind).toBe(signedIn ? "signed-in" : "signed-out");
  });
});
