import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser, homeFor } from "@/lib/auth/session";
import { isActiveSessionUser, isPendingClientUser } from "@/lib/auth/actor";
import { buildMetadata } from "@/lib/i18n/seo";
import { getPublicContext, type LocaleParams } from "@/features/site/context";
import { SignupForm } from "@/components/site/auth-forms";

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const { t, enabledLanguages } = await getPublicContext(locale);
  return buildMetadata({ locale, path: "/signup", title: t("meta.pages.signup.title"), description: t("meta.pages.signup.description"), enabledLanguages, noIndex: true });
}


/** Already signed in? Go straight to your own area (owner dashboard, staff workspace or client portal). */
async function redirectIfSignedIn() {
  const user = await getSessionUser();
  if (!user) return;
  if (isActiveSessionUser(user)) redirect(homeFor(user.role));
  if (isPendingClientUser(user)) redirect("/portal/pending");
}

export default async function SignupPage({ params }: LocaleParams) {
  await redirectIfSignedIn();
  const { locale } = await params;
  const { t, messages } = await getPublicContext(locale);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{t("auth.signup.title")}</h1>
      <p className="mb-8 mt-2 text-sm text-ink-500">{t("auth.signup.subtitle")}</p>
      <SignupForm locale={locale} messages={{ auth: messages.auth, industries: messages.industries, contact: messages.contact }} />
    </>
  );
}
