import { redirect } from "next/navigation";
import { Clock } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { isActiveSessionUser } from "@/lib/auth/actor";
import { LogoMark } from "@/components/site/logo";
import { SignOutButton } from "@/components/app/sign-out-button";
import { ChatWidget } from "@/components/chat/chat-widget";

export const metadata = { title: "Awaiting approval" };
export const dynamic = "force-dynamic";

/** Pending client accounts see only this page — no organization data, no privileged access. */
export default async function PendingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "CLIENT") redirect("/dashboard");
  if (isActiveSessionUser(user)) redirect("/portal");
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="max-w-md rounded-3xl border border-ink-200 bg-white p-8 text-center shadow-card">
        <LogoMark className="mx-auto h-10 w-10" />
        <Clock className="mx-auto mt-6 h-10 w-10 text-amber-500" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold">Your account is awaiting approval</h1>
        <p className="mt-2 text-sm text-ink-600">Thanks for signing up, {user.name.split(" ")[0]}. Our team reviews every new client account before activation — we&apos;ll email you at {user.email} as soon as your workspace is ready. In the meantime you can message us with the chat button.</p>
        <div className="mt-6">
          <SignOutButton />
        </div>
      </div>
      <ChatWidget />
    </main>
  );
}
