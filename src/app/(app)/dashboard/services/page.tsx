import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { SERVICE_CATEGORIES } from "@/config/services";
import { requireInternalPage } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { formatDate, humanize } from "@/lib/utils/format";
import { getMessages } from "@/lib/i18n/dictionaries";
import { getPath } from "@/lib/i18n/translator";
import { ClientService, type ClientServiceDoc } from "@/models";
import { listCaseStudiesAdmin } from "@/features/content/service";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge, DemoBadge, StatusBadge } from "@/components/ui/badge";
import { PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui/data";
import { CATEGORY_ICONS } from "@/components/site/sections";
import { CaseStudyEditor } from "@/components/app/case-study-editor";

export const metadata = { title: "Services" };

export default async function ServicesAdminPage() {
  const actor = await requireInternalPage();
  const [en, usage, requested, caseStudies] = await Promise.all([
    getMessages("en"),
    ClientService.aggregate([{ $group: { _id: { c: "$category", s: "$status" }, n: { $sum: 1 } } }]),
    ClientService.find({ status: "REQUESTED" }).sort({ createdAt: -1 }).limit(20).populate("organizationId", "name").lean<(ClientServiceDoc & { organizationId: { _id: string; name: string } })[]>(),
    can(actor, "content.manage") ? listCaseStudiesAdmin(actor) : Promise.resolve([]),
  ]);
  const count = (cat: string, status: string) => usage.find((u) => u._id.c === cat && u._id.s === status)?.n ?? 0;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Services"
        title="Service catalogue & usage"
        description="Six service areas, defined once in configuration and localised via translations. Edit public wording in Settings → Languages."
        actions={
          <Link href="/services" target="_blank" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700">
            View public services page <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Link>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {SERVICE_CATEGORIES.map((c) => {
          const Icon = CATEGORY_ICONS[c.icon]!;
          return (
            <Card key={c.slug}>
              <CardContent className="space-y-3 py-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div>
                    <p className="font-semibold">{getPath(en, `services.categories.${c.key}.name`) as string}</p>
                    <p className="text-xs text-ink-500">{c.items.length} service items</p>
                  </div>
                </div>
                <dl className="grid grid-cols-4 gap-2 text-center text-xs">
                  {(["ACTIVE", "PENDING", "REQUESTED", "COMPLETED"] as const).map((s) => (
                    <div key={s} className="rounded-lg bg-ink-50 py-2">
                      <dt className="text-ink-500">{humanize(s)}</dt>
                      <dd className="text-lg font-semibold tabular-nums">{count(c.slug, s)}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader title="Service requests from clients" description="Clients can request new services from their portal." />
        {requested.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-500">No open service requests.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {requested.map((r) => (
              <li key={String(r._id)} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span>
                  <Link href={`/dashboard/clients/${r.organizationId._id}`} className="font-medium hover:text-brand-700">
                    {r.organizationId.name}
                  </Link>{" "}
                  requested <strong>{humanize(r.category.replace(/-/g, "_"))}</strong>
                  {r.notes && <span className="text-ink-500"> — {r.notes}</span>}
                </span>
                <span className="text-xs text-ink-400">{formatDate(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {can(actor, "content.manage") && (
        <Card>
          <CardHeader title="Case studies" description="Shown on the public “Our Work” page. Examples are always labelled as examples." action={<CaseStudyEditor />} />
          <Table>
            <THead>
              <tr>
                <TH>Title</TH>
                <TH>Client</TH>
                <TH>Type</TH>
                <TH>Status</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {caseStudies.map((cs) => (
                <TR key={String(cs._id)}>
                  <TD className="font-medium">{cs.content.title}</TD>
                  <TD>{cs.clientName}</TD>
                  <TD>{cs.isExample ? <DemoBadge label="Example" /> : <Badge tone="success">Real client</Badge>}</TD>
                  <TD>
                    <StatusBadge status={cs.published ? "ACTIVE" : "DRAFT"} label={cs.published ? "Published" : "Draft"} />
                  </TD>
                  <TD className="text-right">
                    <CaseStudyEditor
                      initial={{
                        id: String(cs._id),
                        slug: cs.slug,
                        clientName: cs.clientName,
                        industry: cs.industry ?? undefined,
                        services: cs.services,
                        technologies: cs.technologies,
                        isExample: cs.isExample,
                        published: cs.published,
                        content: { title: cs.content.title ?? "", summary: cs.content.summary ?? undefined, challenge: cs.content.challenge ?? undefined, solution: cs.content.solution ?? undefined, results: cs.content.results ?? [], testimonial: cs.content.testimonial ?? undefined },
                      }}
                    />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
