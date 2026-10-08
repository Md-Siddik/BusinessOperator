import type { Metadata } from "next";
import { getPublicContext } from "@/features/site/context";
import { UnsubscribeConfirm } from "@/components/site/unsubscribe-confirm";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string }> }) {
  const { locale } = await params;
  const { token } = await searchParams;
  const { t } = await getPublicContext(locale);
  return (
    <section className="container-page flex min-h-[50vh] max-w-lg items-center justify-center py-20">
      <UnsubscribeConfirm
        token={token ?? ""}
        labels={{ title: t("unsubscribe.title"), text: t("unsubscribe.text"), invalidTitle: t("unsubscribe.invalidTitle"), invalidText: t("unsubscribe.invalidText") }}
      />
    </section>
  );
}
