import type { Metadata } from "next";
import { buildMetadata } from "@/lib/i18n/seo";
import { getPublicContext } from "@/features/site/context";
import { ResetPasswordForm } from "@/components/site/auth-forms";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const { t, enabledLanguages } = await getPublicContext(locale);
  return buildMetadata({ locale, path: "/reset-password", title: t("meta.pages.resetPassword.title"), description: t("meta.pages.resetPassword.description"), enabledLanguages, noIndex: true });
}

export default async function ResetPasswordPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { token } = await searchParams;
  const { t, messages } = await getPublicContext(locale);
  return (
    <>
      <h1 className="mb-8 text-2xl font-semibold tracking-tight text-ink-900">{t("auth.reset.title")}</h1>
      <ResetPasswordForm locale={locale} messages={{ auth: messages.auth }} token={token ?? ""} />
    </>
  );
}
