import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { LANGUAGES } from "@/config/languages";
import { requireInternalPage } from "@/lib/auth/session";
import { can, type Actor } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utils/format";
import { LEAD_STAGES, LEAD_STAGE_LABELS } from "@/lib/constants";
import { getEmailProvider, defaultFromAddress } from "@/lib/email/provider";
import { User, RegistrySync, type RegistrySyncDoc, type UserDoc } from "@/models";
import { getSetting } from "@/features/settings/service";
import { listCountries } from "@/features/countries/service";
import { listProvidersForCountry } from "@/features/registry/providers";
import { listInternalUsers } from "@/features/crm/service";
import { translationCoverage, translationNamespaces } from "@/features/translations/service";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { DescriptionList, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { SettingsTabs, SETTINGS_TABS } from "@/components/app/section-tabs";
import { PackageEditor, ResearchSettingsForm } from "@/components/intel/research-settings";
import { listPackages } from "@/features/service-fit/service";
import {
  ChatSettingsForm,
  CountrySettingsRow,
  GeneralSettingsForm,
  LanguageSettingsForm,
  OutreachSettingsForm,
  ScoringSettingsForm,
  SecurityForms,
  TranslationEditor,
} from "@/components/app/settings-forms";

export const metadata = { title: "Settings" };

function allowed(actor: Actor, tab: string) {
  if (tab === "security") return true;
  if (tab === "languages" || tab === "general") return can(actor, "settings.manage") || can(actor, "content.manage");
  return can(actor, "settings.manage");
}

export default async function SettingsTabPage({ params }: { params: Promise<{ tab: string }> }) {
  const actor = await requireInternalPage();
  const { tab } = await params;
  if (!SETTINGS_TABS.some((t) => t.id === tab)) notFound();
  const permitted = allowed(actor, tab);

  let body: React.ReactNode = null;
  if (!permitted) {
    body = <EmptyState icon={Lock} title="You don't have access to these settings" description="Ask the owner to grant the required permission." />;
  } else if (tab === "general") {
    body = <GeneralSettingsForm value={await getSetting("general")} />;
  } else if (tab === "countries") {
    const [countries, history] = await Promise.all([listCountries(), RegistrySync.find().sort({ startedAt: -1 }).limit(20).lean<RegistrySyncDoc[]>()]);
    body = (
      <div className="space-y-6">
        <div className="-mx-5 -my-4">
          {countries.map((c) => (
            <CountrySettingsRow
              key={c.code}
              country={{
                code: c.code,
                name: c.name,
                flag: c.flag,
                enabled: c.enabled,
                providerId: c.providerId,
                syncEnabled: c.syncEnabled,
                syncIntervalMinutes: c.syncIntervalMinutes,
                backfillDays: c.backfillDays,
                providers: listProvidersForCountry(c.code).map((p) => ({ id: p.id, name: p.name, isDemo: p.isDemo, configured: p.configured, description: p.description, freshness: p.freshness, recommendedSyncMinutes: p.recommendedSyncMinutes, dailyFeed: p.capabilities.supportsDailyRegistrations })),
              }}
            />
          ))}
        </div>
        <div className="rounded-xl border border-ink-200">
          <p className="border-b border-ink-100 px-4 py-3 text-sm font-semibold">Sync history</p>
          <Table>
            <THead>
              <tr>
                <TH>Started</TH>
                <TH>Country</TH>
                <TH>Provider</TH>
                <TH>Trigger</TH>
                <TH>Status</TH>
                <TH className="text-right">Imported</TH>
                <TH className="text-right">Updated</TH>
                <TH className="text-right">Failed</TH>
                <TH>Errors</TH>
              </tr>
            </THead>
            <TBody>
              {history.map((h) => (
                <TR key={String(h._id)}>
                  <TD className="whitespace-nowrap text-xs">{formatDateTime(h.startedAt)}</TD>
                  <TD>{h.countryCode}</TD>
                  <TD className="text-xs">
                    {h.providerId} {h.isLiveSource ? null : <Badge tone="demo">demo</Badge>}
                  </TD>
                  <TD className="text-xs">{h.trigger.toLowerCase()}</TD>
                  <TD>
                    <StatusBadge status={h.status} />
                  </TD>
                  <TD className="text-right tabular-nums">{h.imported}</TD>
                  <TD className="text-right tabular-nums">{h.updated}</TD>
                  <TD className="text-right tabular-nums">{h.failed}</TD>
                  <TD className="max-w-60 truncate text-xs text-red-600">{h.errorLog[0]}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
        <p className="text-xs text-ink-500">
          Scheduled syncs run inside the server process (REGISTRY_SCHEDULER, default on) or via <code>/api/registry/cron</code> with <code>Authorization: Bearer CRON_SECRET</code>. Provider status and the full log are on the Data Sources page; setup per country is in <code>docs/providers/</code>.
        </p>
      </div>
    );
  } else if (tab === "research") {
    const keys = { BRAVE_SEARCH_API_KEY: !!process.env.BRAVE_SEARCH_API_KEY, HUNTER_API_KEY: !!process.env.HUNTER_API_KEY && process.env.HUNTER_API_KEY !== "test-api-key", APOLLO_API_KEY: !!process.env.APOLLO_API_KEY };
    body = <ResearchSettingsForm value={await getSetting("research")} keys={keys} />;
  } else if (tab === "packages") {
    const packages = await listPackages();
    body = (
      <div className="space-y-3">
        <p className="text-sm text-ink-600">Packages are only suggested when their required evidence exists. Prices left empty appear as placeholders in quotations until you approve a price.</p>
        {packages.map((p) => (
          <PackageEditor
            key={String(p._id)}
            pkg={{
              id: String(p._id),
              name: p.name,
              group: p.group ?? undefined,
              description: p.description ?? undefined,
              deliverables: p.deliverables,
              timeline: p.timeline ?? undefined,
              currency: p.currency,
              terms: p.terms ?? undefined,
              active: p.active,
              nextQuestion: p.nextQuestion ?? undefined,
              lineItems: p.lineItems.map((l) => ({ description: l.description ?? "", quantity: l.quantity ?? 1, unitPrice: l.unitPrice ?? null, unit: l.unit ?? undefined })),
              rules: { countries: p.rules?.countries ?? [], industries: p.rules?.industries ?? [], maxCompanyAgeDays: p.rules?.maxCompanyAgeDays ?? null, requireDirectContact: !!p.rules?.requireDirectContact, requiresEvidence: p.rules?.requiresEvidence ?? "none", weight: p.rules?.weight ?? 50 },
            }}
          />
        ))}
      </div>
    );
  } else if (tab === "languages") {
    const [value, coverage] = [await getSetting("languages"), translationCoverage()];
    body = (
      <div className="space-y-8">
        <LanguageSettingsForm value={value} />
        <div>
          <h3 className="mb-3 text-sm font-semibold">Translation coverage</h3>
          <Table>
            <THead>
              <tr>
                <TH>Language</TH>
                <TH>Keys translated</TH>
                <TH>Review status</TH>
              </tr>
            </THead>
            <TBody>
              {coverage.map((c) => (
                <TR key={c.code}>
                  <TD>{LANGUAGES.find((l) => l.code === c.code)?.englishName}</TD>
                  <TD className="tabular-nums">
                    {c.translated} / {c.total}
                  </TD>
                  <TD>{c.reviewStatus === "source" ? <Badge tone="success">Source</Badge> : <Badge tone="warning">{c.reviewStatus}</Badge>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Edit translations</h3>
          <p className="mb-3 mt-1 text-sm text-ink-500">Marketing copy, localized service content and per-page SEO titles/descriptions (section “meta”) can be reviewed and overridden here. Missing keys always fall back to English.</p>
          <TranslationEditor namespaces={translationNamespaces()} />
        </div>
      </div>
    );
  } else if (tab === "email") {
    const provider = getEmailProvider();
    body = (
      <div className="space-y-6">
        <DescriptionList
          items={[
            { label: "Provider", value: <span className="flex items-center gap-2">{provider.id} {provider.isLive ? <Badge tone="success">Live</Badge> : <Badge tone="warning">Console — emails are logged, not delivered</Badge>}</span> },
            { label: "Transactional sender", value: defaultFromAddress() },
          ]}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-ink-200 p-4">
            <p className="text-sm font-semibold">Transactional email</p>
            <p className="mt-1 text-sm text-ink-600">Signup received, account approved, password reset, invitations, chat and ticket notifications. Sent immediately, never marketing.</p>
          </div>
          <div className="rounded-xl border border-ink-200 p-4">
            <p className="text-sm font-semibold">Outreach email</p>
            <p className="mt-1 text-sm text-ink-600">Prospect emails, campaigns and follow-ups. Always Draft → Review → Approve → Send, with suppression checks and an unsubscribe footer.</p>
          </div>
        </div>
        <p className="text-xs text-ink-500">Configure with environment variables: EMAIL_PROVIDER (console | resend | sendgrid), EMAIL_API_KEY, EMAIL_FROM. Outreach sender identity is set under Outreach. Templates live under Outreach → Templates.</p>
      </div>
    );
  } else if (tab === "crm") {
    body = (
      <div className="space-y-8">
        <ScoringSettingsForm value={await getSetting("leadScoring")} />
        <div>
          <h3 className="mb-2 text-sm font-semibold">Pipeline stages</h3>
          <div className="flex flex-wrap gap-1.5">
            {LEAD_STAGES.map((s) => (
              <Badge key={s} tone={s === "DO_NOT_CONTACT" ? "danger" : s === "NOT_INTERESTED" ? "neutral" : "brand"}>
                {LEAD_STAGE_LABELS[s]}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    );
  } else if (tab === "outreach") {
    body = <OutreachSettingsForm value={await getSetting("outreach")} />;
  } else if (tab === "chat") {
    const [value, staff] = await Promise.all([getSetting("chat"), listInternalUsers()]);
    body = <ChatSettingsForm value={value} staff={staff.map((s) => ({ id: String(s._id), name: s.name }))} />;
  } else if (tab === "security") {
    const me = await User.findById(actor.id).lean<UserDoc>();
    body = <SecurityForms profile={{ name: me?.name ?? actor.name, phone: me?.phone ?? undefined, preferredLanguage: me?.preferredLanguage ?? "en", emailOnChatMessage: me?.notificationPrefs?.emailOnChatMessage !== false, emailOnTicketUpdate: me?.notificationPrefs?.emailOnTicketUpdate !== false }} />;
  }

  const label = SETTINGS_TABS.find((t) => t.id === tab)!.label;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Settings" title={label} />
      <SettingsTabs active={tab} />
      <Card>
        <CardHeader title={label} />
        <CardContent className="py-5">{body}</CardContent>
      </Card>
    </div>
  );
}
