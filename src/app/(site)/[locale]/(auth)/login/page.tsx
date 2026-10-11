import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser, homeFor } from "@/lib/auth/session";
import { isActiveSessionUser, isPendingClientUser } from "@/lib/auth/actor";
import { buildMetadata } from "@/lib/i18n/seo";
import { getPublicContext } from "@/features/site/context";
import { LoginForm } from "@/components/site/auth-forms";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const { t, enabledLanguages } = await getPublicContext(locale);
  return buildMetadata({ locale, path: "/login", title: t("meta.pages.login.title"), description: t("meta.pages.login.description"), enabledLanguages, noIndex: true });
}


/** Already signed in? Go straight to your own area (owner dashboard, staff workspace or client portal). */
async function redirectIfSignedIn() {
  const user = await getSessionUser();
  if (!user) return;
  if (isActiveSessionUser(user)) redirect(homeFor(user.role));
  if (isPendingClientUser(user)) redirect("/portal/pending");
}

export default async function LoginPage({ params, searchParams }: Props) {
  await redirectIfSignedIn();
  const { locale } = await params;
  const { next } = await searchParams;
  const { t, messages } = await getPublicContext(locale);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{t("auth.login.title")}</h1>
      <p className="mb-8 mt-2 text-sm text-ink-500">{t("auth.login.subtitle")}</p>
      <LoginForm locale={locale} messages={{ auth: messages.auth }} next={next} />
    </>
  );
}
