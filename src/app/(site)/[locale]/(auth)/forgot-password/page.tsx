import type { Metadata } from "next";
import { buildMetadata } from "@/lib/i18n/seo";
import { getPublicContext, type LocaleParams } from "@/features/site/context";
import { ForgotPasswordForm } from "@/components/site/auth-forms";

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const { t, enabledLanguages } = await getPublicContext(locale);
  return buildMetadata({ locale, path: "/forgot-password", title: t("meta.pages.forgotPassword.title"), description: t("meta.pages.forgotPassword.description"), enabledLanguages, noIndex: true });
}

export default async function ForgotPasswordPage({ params }: LocaleParams) {
  const { locale } = await params;
  const { t, messages } = await getPublicContext(locale);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{t("auth.forgot.title")}</h1>
      <p className="mb-8 mt-2 text-sm text-ink-500">{t("auth.forgot.subtitle")}</p>
      <ForgotPasswordForm messages={{ auth: messages.auth, contact: messages.contact }} />
    </>
  );
}
