"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, History, Inbox, Pencil, Search, Trash2 } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { CompanyType } from "@/lib/company-classification";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/utils/format";
import { CompanyTypeTag } from "@/components/intel/company-type-tag";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { OUTREACH, type OutreachStatus } from "./marketer-leads-table";

type Values = { companyName: string; contactPerson: string; contactRole: string; phone: string; website: string };
type HistoryEntry = { action: string; at: string; by: string; outreachStatus?: OutreachStatus; previousOutreachStatus?: OutreachStatus; fields?: string[] };
export type OwnerLead = {
  id: string;
  companyId: string;
  companyName: string;
  contactPerson?: string;
  contactRole?: string;
  phone?: string;
  phoneDisplay?: string;
  website?: { href: string; display: string };
  countryCode?: string;
  sentAt: string;
  status: "ACTIVE" | "WITHDRAWN";
  companyType: { value: CompanyType; reason?: string; manual: boolean };
  outreachStatus: OutreachStatus;
  outreachStatusAt?: string;
  outreachStatusBy?: string;
  original: Partial<Values>;
  values: Values;
  edited?: { at: string; by: string; fields: string[] };
  history: HistoryEntry[];
};
type Filters = { q: string; outreach: OutreachStatus | null; status: "ACTIVE" | "WITHDRAWN" | "ALL" };
type Stats = { total: number; active: number; withdrawn: number; NOT_REACHED: number; MESSAGED: number; GOT_RESPONSE: number };
export type OwnerLeadPage = { items: OwnerLead[]; total: number; page: number; pageSize: number; pageCount: number; filters: Filters; marketers: { id: string; name: string; email: string; active: boolean }[]; stats: Stats };

const FIELD_LABELS: Record<keyof Values, string> = { companyName: "Company name", contactPerson: "Contact person", contactRole: "Contact role", phone: "Phone number", website: "Website" };
const outreachLabel = (s?: OutreachStatus) => OUTREACH.find((o) => o.value === s)?.label ?? "Not reached";

function describe(h: HistoryEntry) {
  if (h.action === "OUTREACH") return `Outreach status ${h.previousOutreachStatus ? `${outreachLabel(h.previousOutreachStatus)} → ` : "→ "}${outreachLabel(h.outreachStatus)}`;
  if (h.action === "EDITED") return `Edited ${(h.fields ?? []).map((f) => FIELD_LABELS[f as keyof Values] ?? f).join(", ")}`;
  return { SENT: "Sent to the marketer table", RESENT: "Re-activated", WITHDRAWN: "Withdrawn", MERGED: "Merged into the shared table" }[h.action] ?? h.action;
}

/**
 * Owner view of the Digital Marketer table: every marketer's records, with edit, delete,
 * outreach status and the full change history. All requests go to /api/marketer/assignments,
 * which is OWNER-only on the server.
 */
export function OwnerLeadsTable({ initial }: { initial: OwnerLeadPage }) {
  const [data, setData] = useState(initial);
  const [filters, setFilters] = useState<Filters & { page: number }>({ ...initial.filters, page: initial.page });
  const [query, setQuery] = useState(initial.filters.q);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<OwnerLead | null>(null);
  const [deleting, setDeleting] = useState<OwnerLead | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const first = useRef(true);
  const seq = useRef(0);

  const load = useCallback(async (f: typeof filters) => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ status: f.status, page: String(f.page), ...(f.q && { q: f.q }), ...(f.outreach && { outreach: f.outreach }) });
    try {
      const res = await apiFetch<OwnerLeadPage>(`/api/marketer/assignments?${qs}`);
      if (id !== seq.current) return;
      setData(res);
      try {
        window.history.replaceState(null, "", `?${qs}`);
      } catch {
        /* ignore */
      }
    } catch (e) {
      if (id === seq.current) setError(e instanceof ApiError ? e.message : "Could not load the table.");
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void load(filters);
  }, [filters, load]);

  useEffect(() => {
    if (query === filters.q) return;
    const t = setTimeout(() => setFilters((f) => ({ ...f, q: query.trim(), page: 1 })), 300);
    return () => clearTimeout(t);
  }, [query, filters.q]);

  const replaceRow = (row: OwnerLead) => setData((d) => ({ ...d, items: d.items.map((x) => (x.id === row.id ? row : x)) }));
  const refresh = () => void load(filters);
  const s = data.stats;

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-700">Digital Marketer table</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-900">Marketer leads</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-600">Every lead sent to the Digital Marketer table. Every Digital Marketer with “View Marketer Table” sees all active records and can change their outreach status; you can edit or delete any record and set any status. Edits change what the table shows — the Company Intelligence record stays as the registry published it.</p>
        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              ["Records", s.total],
              ["Active", s.active],
              ["Withdrawn", s.withdrawn],
              ["Not reached", s.NOT_REACHED],
              ["Messaged", s.MESSAGED],
              ["Got response", s.GOT_RESPONSE],
            ] as const
          ).map(([label, n]) => (
            <div key={label} className="rounded-xl border border-ink-200 bg-white px-3 py-2 shadow-sm">
              <dt className="text-xs text-ink-500">{label}</dt>
              <dd className="text-xl font-semibold tabular-nums text-ink-900">{n}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="flex flex-col gap-2 rounded-xl border border-ink-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <label htmlFor="owner-lead-search" className="sr-only">
            Search
          </label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <input id="owner-lead-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Company, contact, phone or website" className="h-10 w-full rounded-lg border border-ink-200 pl-9 pr-3 text-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20" />
        </div>
        <Select aria-label="Outreach status" value={filters.outreach ?? ""} onChange={(e) => setFilters((f) => ({ ...f, outreach: (e.target.value || null) as OutreachStatus | null, page: 1 }))} className="lg:w-44">
          <option value="">Any outreach status</option>
          {OUTREACH.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Record status" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as Filters["status"], page: 1 }))} className="lg:w-40">
          <option value="ALL">Active & withdrawn</option>
          <option value="ACTIVE">Active</option>
          <option value="WITHDRAWN">Withdrawn</option>
        </Select>
      </div>

      {error && (
        <Alert tone="danger" title="Couldn't load the table" action={<Button size="sm" variant="outline" onClick={refresh}>Try again</Button>}>
          {error}
        </Alert>
      )}

      {!error && !loading && data.items.length === 0 ? (
        <EmptyState icon={Inbox} title="No records" description="Leads you send to the marketer table from Company Intelligence appear here." />
      ) : (
        <div className="scroll-thin overflow-x-auto rounded-xl border border-ink-200 bg-white shadow-sm">
          <table className={cn("w-full min-w-[1100px] text-left text-sm", loading && "opacity-60")}>
            <caption className="sr-only">Digital Marketer table — all records</caption>
            <thead className="bg-ink-50 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              <tr>
                <th scope="col" className="px-4 py-3">Company</th>
                <th scope="col" className="px-4 py-3">Contact</th>
                <th scope="col" className="px-4 py-3">Website</th>
                <th scope="col" className="px-4 py-3">Sent</th>
                <th scope="col" className="px-4 py-3">Outreach status</th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <Fragment key={r.id}>
                  <tr className={cn("border-t border-ink-100 align-top", r.status === "WITHDRAWN" && "bg-ink-50/60 text-ink-500")}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink-900">{r.companyName}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-ink-500">
                        {r.countryCode && <span className="rounded bg-ink-100 px-1 font-medium text-ink-600">{r.countryCode}</span>}
                        <CompanyTypeTag short value={r.companyType.value} reason={r.companyType.reason} manual={r.companyType.manual} />
                        {r.status === "WITHDRAWN" && <span className="rounded bg-ink-200 px-1 font-medium text-ink-700">Withdrawn</span>}
                        {r.edited && <span className="rounded bg-violet-50 px-1 font-medium text-violet-700" title={`Edited by ${r.edited.by} ${formatDateTime(r.edited.at)}`}>Edited</span>}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {r.contactPerson ? <p className="font-medium text-ink-900">{r.contactPerson}</p> : <p className="text-xs italic text-ink-400">No contact person</p>}
                      {r.contactRole && <p className="text-xs text-ink-500">{r.contactRole}</p>}
                      {r.phone && (
                        <a href={`tel:${r.phone}`} className="text-xs tabular-nums text-ink-700 hover:text-violet-700">
                          {r.phoneDisplay ?? r.phone}
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {r.website ? (
                        <a href={r.website.href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 break-all font-medium text-brand-700 hover:underline">
                          {r.website.display} <ExternalLink className="h-3 w-3" aria-hidden />
                        </a>
                      ) : (
                        <span className="italic text-ink-400">Not available</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-ink-600">{formatDateTime(r.sentAt)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <OwnerOutreachSelect lead={r} onSaved={replaceRow} />
                      {r.outreachStatusAt && (
                        <p className="mt-1 text-[11px] text-ink-500">
                          {r.outreachStatusBy ?? "—"} · {formatDateTime(r.outreachStatusAt)}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" aria-expanded={open === r.id} onClick={() => setOpen((o) => (o === r.id ? null : r.id))} aria-label={`History of ${r.companyName}`}>
                          <History className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label={`Edit ${r.companyName}`}>
                          <Pencil className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleting(r)} aria-label={`Delete ${r.companyName}`} className="text-red-700 hover:bg-red-50">
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {open === r.id && (
                    <tr className="bg-violet-50/40">
                      <td colSpan={6} className="px-6 py-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Change history</h3>
                        {r.history.length ? (
                          <ol className="mt-2 space-y-1 text-xs text-ink-700">
                            {r.history.map((h, i) => (
                              <li key={i} className="flex flex-wrap gap-x-2">
                                <span className="tabular-nums text-ink-500">{formatDateTime(h.at)}</span>
                                <span className="font-medium">{h.by}</span>
                                <span>{describe(h)}</span>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="mt-1 text-xs text-ink-500">No changes recorded.</p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.pageCount > 1 && (
        <nav className="flex items-center justify-between gap-3" aria-label="Pagination">
          <Button size="sm" variant="outline" disabled={data.page <= 1 || loading} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>
            Previous
          </Button>
          <span className="text-sm text-ink-600">
            Page {data.page} of {data.pageCount} · {data.total} records
          </span>
          <Button size="sm" variant="outline" disabled={data.page >= data.pageCount || loading} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>
            Next
          </Button>
        </nav>
      )}

      {editing && <EditLead lead={editing} onClose={() => setEditing(null)} onSaved={(row) => { replaceRow(row); setEditing(null); }} />}
      {deleting && <DeleteLead lead={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); refresh(); }} />}
    </div>
  );
}

function OwnerOutreachSelect({ lead, onSaved }: { lead: OwnerLead; onSaved: (row: OwnerLead) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = OUTREACH.find((o) => o.value === lead.outreachStatus) ?? OUTREACH[0]!;
  async function change(next: OutreachStatus) {
    if (next === lead.outreachStatus) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await apiFetch<OwnerLead>(`/api/marketer/assignments/${lead.id}`, { method: "PATCH", body: { outreachStatus: next } }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div>
      <select aria-label={`Outreach status for ${lead.companyName}`} value={lead.outreachStatus} disabled={saving} onChange={(e) => void change(e.target.value as OutreachStatus)} className={cn("h-8 rounded-full border px-3 text-xs font-semibold", current.className)}>
        {OUTREACH.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" className="mt-1 text-[11px] text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function EditLead({ lead, onClose, onSaved }: { lead: OwnerLead; onClose: () => void; onSaved: (row: OwnerLead) => void }) {
  const [values, setValues] = useState<Values>(lead.values);
  const [status, setStatus] = useState(lead.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setSaving(true);
    setError(null);
    try {
      onSaved(await apiFetch<OwnerLead>(`/api/marketer/assignments/${lead.id}`, { method: "PATCH", body: { ...values, status } }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save.");
      setSaving(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${lead.companyName}`}
      description="Changes apply to this Digital Marketer record only. Clear a field to hide it; enter the registry value again to undo a correction."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {(Object.keys(FIELD_LABELS) as (keyof Values)[]).map((k) => (
          <Field key={k} label={FIELD_LABELS[k]} hint={lead.original[k] !== undefined && lead.original[k] !== values[k] ? `Company Intelligence value: ${lead.original[k] || "—"}` : undefined}>
            {(p) => <Input {...p} value={values[k]} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} required={k === "companyName"} />}
          </Field>
        ))}
        <Field label="Record status">
          {(p) => (
            <Select {...p} value={status} onChange={(e) => setStatus(e.target.value as OwnerLead["status"])}>
              <option value="ACTIVE">Active — visible to every Digital Marketer</option>
              <option value="WITHDRAWN">Withdrawn — hidden from marketers</option>
            </Select>
          )}
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}

function DeleteLead({ lead, onClose, onDeleted }: { lead: OwnerLead; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/marketer/assignments/${lead.id}`, { method: "DELETE" });
      onDeleted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete.");
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title="Delete this record?"
      description={lead.companyName}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void remove()} loading={busy}>
            Delete
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-700">The record and its outreach history are removed from the Digital Marketer table (kept in the audit log). The company stays in Company Intelligence and can be sent again.</p>
      {error && <Alert tone="danger" className="mt-3">{error}</Alert>}
    </Modal>
  );
}
