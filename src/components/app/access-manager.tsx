"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Globe,
  Headphones,
  KeyRound,
  LayoutTemplate,
  Lock,
  Megaphone,
  Plus,
  Radar,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { AccessRow, AccessUserView } from "@/features/access/service";
import { apiFetch, ApiError } from "@/lib/api/client";
import {
  ACCESS_PRESETS,
  ACTION_LABELS,
  PERMISSION_CATALOG,
  PERMISSION_DEFS,
  PERMISSION_GROUPS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type Permission,
  type PermissionDef,
  type PermissionGroupId,
  type Role,
} from "@/lib/permissions/catalog";
import { cn } from "@/lib/utils";
import { Badge, DemoBadge, StatusBadge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Avatar } from "@/components/ui/data";
import { Modal } from "@/components/ui/overlay";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";

const ROLE_TONE: Record<Role, BadgeTone> = { OWNER: "violet", ADMIN: "brand", MANAGER: "success", STAFF: "neutral", DIGITAL_MARKETER: "info", CLIENT: "neutral" };
const ROLE_FILTERS: (Role | "ALL")[] = ["ALL", "ADMIN", "MANAGER", "STAFF", "DIGITAL_MARKETER", "OWNER"];
const TEMPLATE_ROLES: Role[] = ["ADMIN", "MANAGER", "STAFF", "DIGITAL_MARKETER"];

/** One card per service: icon and accent. */
const SERVICE_STYLE: Record<PermissionGroupId, { Icon: LucideIcon; accent: string }> = {
  "company-intelligence": { Icon: Building2, accent: "bg-teal-50 text-teal-700 ring-teal-200" },
  marketing: { Icon: Megaphone, accent: "bg-violet-50 text-violet-700 ring-violet-200" },
  "opportunity-intelligence": { Icon: Radar, accent: "bg-sky-50 text-sky-700 ring-sky-200" },
  clients: { Icon: Headphones, accent: "bg-brand-50 text-brand-700 ring-brand-200" },
  delivery: { Icon: Wrench, accent: "bg-amber-50 text-amber-700 ring-amber-200" },
  website: { Icon: Globe, accent: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200" },
  team: { Icon: Users, accent: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  "owner-tools": { Icon: KeyRound, accent: "bg-ink-100 text-ink-700 ring-ink-200" },
};

/** Short chip labels where the action alone would be ambiguous inside one service. */
const CHIP_LABELS: Partial<Record<Permission, string>> = {
  "chat.manage": "All conversations",
  "conversations.assigned": "Assigned conversations",
  "clients.manage": "Manage clients",
  "tickets.manage": "Manage all",
  "tickets.assigned": "Assigned only",
  "projects.manage": "Manage all",
  "projects.assigned": "Assigned only",
  "content.manage": "Edit content",
  "services.manage": "Manage services",
  "users.manage": "Manage staff",
  "analytics.view": "View reports",
};
const chipLabel = (d: PermissionDef) => CHIP_LABELS[d.key] ?? ACTION_LABELS[d.action];

export type AccountAbilities = {
  /** Roles this person may give when creating or editing an account. */
  assignableRoles: Role[];
  /** Roles of accounts whose role / status this person may change. */
  editableRoles: Role[];
  /** Permissions this person may give a new account of each role (server-computed). */
  grantable: Partial<Record<Role, Permission[]>>;
  /** Starting access per role, already limited to `grantable`. */
  templates: Partial<Record<Role, Permission[]>>;
  /** Owner only: the editable role templates. */
  roleTemplates?: Record<Role, Permission[]>;
};

const fmtDate = (iso?: string) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)) : undefined);

function sourceText(s: AccessRow["sources"][number]) {
  const when = fmtDate(s.at);
  if (s.origin === "MIGRATION") return "Existing access (from before per-person permissions)";
  if (s.origin === "OWNER") return `Granted by ${s.by ?? "the Owner"}${when ? ` · ${when}` : ""}`;
  return `Granted by ${s.by ?? "an Admin"}${s.byRole ? ` (${s.byRole})` : ""}${s.via ? ` using “${PERMISSION_DEFS[s.via as Permission]?.label ?? s.via}”` : ""}${when ? ` · ${when}` : ""}`;
}

/** Rows that apply to this role and can ever be granted (Owner-only tools are listed separately). */
function grantableRows(user: AccessUserView) {
  return user.rows.filter((r) => {
    const d = PERMISSION_DEFS[r.key];
    return d && !d.ownerOnly && d.eligibleRoles.includes(user.role);
  });
}

/** Mirrors the server's diff: what applying `target` would grant and remove (only changeable rows). */
function previewDiff(user: AccessUserView, target: Permission[]) {
  const want = new Set(target);
  const rows = grantableRows(user);
  return {
    grant: rows.filter((r) => want.has(r.key) && !r.held && r.canGrant).map((r) => r.key),
    revoke: rows.filter((r) => !want.has(r.key) && r.held && r.canRevoke).map((r) => r.key),
  };
}

/**
 * Permission Management: pick a person, see in plain language what they can use, and turn
 * services and individual permissions on or off. Every change is a server-checked, audited
 * grant or revocation (the server decides; the UI only reflects it). The Owner also edits the
 * role templates (default starting access per role) here.
 */
export function AccessManager({ initialUsers, viewerRole, abilities }: { initialUsers: AccessUserView[]; viewerRole: Role; abilities: AccountAbilities }) {
  const [tab, setTab] = useState<"people" | "templates">("people");
  const [users, setUsers] = useState(initialUsers);
  const [templates, setTemplates] = useState(abilities.roleTemplates);
  const [selectedId, setSelectedId] = useState<string | null>(initialUsers.find((u) => !u.isSelf)?.id ?? initialUsers[0]?.id ?? null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "ALL">("ALL");
  const toast = useToast();
  const router = useRouter();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter((u) => (roleFilter === "ALL" || u.role === roleFilter) && (!needle || u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle)));
  }, [users, q, roleFilter]);
  const selected = users.find((u) => u.id === selectedId) ?? null;
  const presentRoles = new Set(users.map((u) => u.role));

  async function refreshAll() {
    try {
      const res = await apiFetch<{ users: AccessUserView[] }>("/api/admin/access");
      setUsers(res.users);
    } catch {
      /* keep the current view; the next action reloads */
    }
  }

  function replace(view: AccessUserView) {
    setUsers((list) => list.map((u) => (u.id === view.id ? view : u)));
  }

  return (
    <div className="space-y-5">
      {templates && (
        <div role="tablist" aria-label="Permission management" className="inline-flex gap-1 rounded-xl border border-ink-200 bg-white p-1">
          {(
            [
              ["people", "People", Users],
              ["templates", "Role templates", LayoutTemplate],
            ] as const
          ).map(([id, label, Icon]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium", tab === id ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-50")}>
              <Icon className="h-4 w-4" aria-hidden /> {label}
            </button>
          ))}
        </div>
      )}

      {tab === "templates" && templates ? (
        <RoleTemplatesPanel templates={templates} counts={Object.fromEntries(TEMPLATE_ROLES.map((r) => [r, users.filter((u) => u.role === r && u.status !== "SUSPENDED").length])) as Record<Role, number>} onSaved={(t) => { setTemplates(t); void refreshAll(); router.refresh(); }} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(260px,320px)_1fr]">
          {/* People */}
          <section aria-label="People" className={cn("space-y-3", mobileDetail && "hidden lg:block")}>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <label htmlFor="access-search" className="sr-only">
                  Search people
                </label>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
                <Input id="access-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" className="pl-9" />
              </div>
              {abilities.assignableRoles.length > 0 && <CreateAccountButton abilities={abilities} onCreated={() => { void refreshAll(); router.refresh(); }} />}
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by role">
              {ROLE_FILTERS.filter((r) => r === "ALL" || presentRoles.has(r)).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRoleFilter(r)}
                  aria-pressed={roleFilter === r}
                  className={cn("h-8 rounded-full border px-3 text-xs font-medium", roleFilter === r ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white text-ink-600 hover:border-ink-300")}
                >
                  {r === "ALL" ? "Everyone" : ROLE_LABELS[r]}
                </button>
              ))}
            </div>
            <ul className="divide-y divide-ink-100 overflow-hidden rounded-xl border border-ink-200 bg-white">
              {filtered.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-500">No people match.</li>}
              {filtered.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(u.id);
                      setMobileDetail(true);
                    }}
                    aria-current={u.id === selectedId ? "true" : undefined}
                    className={cn("flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink-50 focus-visible:bg-ink-50 focus-visible:outline-none", u.id === selectedId && "bg-brand-50/60")}
                  >
                    <Avatar name={u.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink-900">
                        {u.name}
                        {u.isSelf && <span className="ml-1 text-xs font-normal text-ink-500">(you)</span>}
                      </span>
                      <span className="block truncate text-xs text-ink-500">{u.email}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABELS[u.role]}</Badge>
                      <span className="text-[11px] text-ink-500">{u.role === "OWNER" ? "Full access" : u.status !== "ACTIVE" ? u.status.replace(/_/g, " ").toLowerCase() : `${servicesOn(u)} service${servicesOn(u) === 1 ? "" : "s"}`}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* Selected person */}
          <section aria-label="Access details" className={cn(!mobileDetail && "hidden lg:block")}>
            {selected ? (
              <PersonAccess
                key={selected.id}
                user={selected}
                viewerRole={viewerRole}
                abilities={abilities}
                roleTemplate={templates?.[selected.role]}
                onBack={() => setMobileDetail(false)}
                onChange={(v) => {
                  replace(v);
                  void refreshAll();
                }}
                onAccountChanged={() => {
                  void refreshAll();
                  router.refresh();
                }}
                toast={toast}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-ink-200 p-8 text-center text-sm text-ink-500">Select a person to see and change their access.</div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function servicesOn(u: AccessUserView) {
  return new Set(u.effective.filter((p) => !PERMISSION_DEFS[p]?.ownerOnly).map((p) => PERMISSION_DEFS[p]?.group)).size;
}

type Toast = ReturnType<typeof useToast>;
type BulkResult = { view: AccessUserView; applied: number; refused: { permission: Permission; reason: string }[] };

function PersonAccess({ user, viewerRole, abilities, roleTemplate, onBack, onChange, onAccountChanged, toast }: { user: AccessUserView; viewerRole: Role; abilities: AccountAbilities; roleTemplate?: Permission[]; onBack: () => void; onChange: (v: AccessUserView) => void; onAccountChanged: () => void; toast: Toast }) {
  const [pending, setPending] = useState<string | null>(null);
  const isOwnerTarget = user.role === "OWNER";

  const rows = grantableRows(user);
  const ownerOnly = user.rows.filter((r) => PERMISSION_DEFS[r.key]?.ownerOnly);
  const services = PERMISSION_GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => PERMISSION_DEFS[r.key].group === g.id) })).filter((g) => g.rows.length > 0);
  const effective = user.effective.filter((p) => !PERMISSION_DEFS[p]?.ownerOnly);
  const summary = PERMISSION_GROUPS.map((g) => ({ ...g, perms: effective.filter((p) => PERMISSION_DEFS[p]?.group === g.id) })).filter((g) => g.perms.length > 0);
  const templateState = roleTemplate && !isOwnerTarget ? compareToTemplate(effective, roleTemplate) : null;

  async function send(body: Record<string, unknown>, key: string, success: (r: BulkResult) => string) {
    setPending(key);
    try {
      const res = await apiFetch<BulkResult | AccessUserView>(`/api/admin/users/${user.id}/access`, { body });
      const result: BulkResult = "view" in res ? res : { view: res, applied: 1, refused: [] };
      onChange(result.view);
      if (result.refused.length) toast.error(`${result.refused.length} change${result.refused.length === 1 ? " was" : "s were"} refused: ${result.refused[0]!.reason}`);
      else toast.success(success(result));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not change access.");
    } finally {
      setPending(null);
    }
  }

  const toggleOne = (row: AccessRow, confirm = false) => {
    const action = row.held && !confirm ? "revoke" : "grant";
    const label = PERMISSION_DEFS[row.key].label;
    return send({ permission: row.key, action }, row.key, () => (confirm ? `“${label}” is now also granted by you — it stays if the delegate's access ends.` : `${action === "grant" ? "Granted" : "Removed"} “${label}” ${action === "grant" ? "to" : "from"} ${user.name}.`));
  };

  const toggleService = (id: PermissionGroupId, title: string, serviceRows: AccessRow[], on: boolean) => {
    const changes = on
      ? serviceRows.filter((r) => r.held && r.canRevoke).map((r) => ({ permission: r.key, action: "revoke" as const }))
      : [serviceRows.find((r) => !r.held && r.canGrant && PERMISSION_DEFS[r.key].action === "VIEW") ?? serviceRows.find((r) => !r.held && r.canGrant)].filter(Boolean).map((r) => ({ permission: r!.key, action: "grant" as const }));
    if (!changes.length) return;
    return send({ changes }, `service:${id}`, () => (on ? `${title} turned off for ${user.name}.` : `${title} turned on for ${user.name} — add more permissions below if needed.`));
  };

  const canEditAccount = !user.isSelf && abilities.editableRoles.includes(user.role);

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex h-9 items-center gap-1 text-sm font-medium text-ink-600 hover:text-ink-900 lg:hidden">
        <ArrowLeft className="h-4 w-4" aria-hidden /> All people
      </button>

      <div className="rounded-xl border border-ink-200 bg-white p-5">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={user.name} className="h-11 w-11 text-sm" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-ink-900">
              {user.name} {user.isDemo && <DemoBadge label="Demo" className="ml-1 align-middle" />}
            </h2>
            <p className="truncate text-sm text-ink-500">{user.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone={ROLE_TONE[user.role]}>{ROLE_LABELS[user.role]}</Badge>
              <StatusBadge status={user.status} />
              <span className="text-xs text-ink-500">{user.lastLoginAt ? `Last sign-in ${fmtDate(user.lastLoginAt)}` : "Never signed in"}</span>
            </div>
            <p className="mt-2 text-xs text-ink-500">{ROLE_DESCRIPTIONS[user.role]}</p>
          </div>
          {canEditAccount && <EditAccountButton user={user} abilities={abilities} canDelete={viewerRole === "OWNER"} onSaved={onAccountChanged} />}
        </div>

        {/* Effective access summary, by service */}
        <div className="mt-4 rounded-lg bg-ink-50 px-4 py-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Can use right now
          </p>
          {isOwnerTarget ? (
            <p className="mt-1 text-sm text-ink-800">Everything — every service, setting, user and permission.</p>
          ) : summary.length === 0 ? (
            <p className="mt-1 text-sm text-ink-700">Nothing yet — this person only sees their own profile and notifications.</p>
          ) : (
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {summary.map((g) => (
                <li key={g.id} className="text-sm text-ink-800">
                  <span className="font-medium">{g.title}</span>
                  <span className="text-ink-500"> · </span>
                  <span className="text-ink-600">{g.perms.map((p) => chipLabel(PERMISSION_DEFS[p])).join(", ")}</span>
                </li>
              ))}
            </ul>
          )}
          {templateState && (
            <p className="mt-2 text-xs text-ink-500">
              {templateState.same ? `Matches the ${ROLE_LABELS[user.role]} role template.` : `Customised for this person: ${[templateState.extra && `${templateState.extra} more`, templateState.missing && `${templateState.missing} fewer`].filter(Boolean).join(", ")} than the ${ROLE_LABELS[user.role]} template.`}
            </p>
          )}
          {user.waitingLeads ? (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-900">
              <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {user.waitingLeads} lead{user.waitingLeads === 1 ? " has" : "s have"} been sent to {user.name.split(" ")[0]}
              {effective.includes("marketerLeads.view") ? "." : " and stay hidden until “View Assigned Client Leads” is granted."}
            </p>
          ) : null}
        </div>
      </div>

      {!isOwnerTarget && services.length > 0 && <TemplatePicker user={user} roleTemplate={roleTemplate} busy={pending !== null} onApply={(preset, label) => send({ preset }, "preset", (r) => (r.applied ? `${label} applied — ${r.applied} change${r.applied === 1 ? "" : "s"}.` : `${user.name} already matches ${label}.`))} />}

      {!isOwnerTarget &&
        services.map((g) => (
          <ServiceCard key={g.id} id={g.id} title={g.title} description={g.description} rows={g.rows} pending={pending} onToggleService={(on) => void toggleService(g.id, g.title, g.rows, on)} onToggle={(row) => void toggleOne(row)} onConfirm={(row) => void toggleOne(row, true)} />
        ))}

      {!isOwnerTarget && services.length === 0 && <div className="rounded-xl border border-dashed border-ink-200 p-6 text-sm text-ink-500">There is nothing you can change for this person.</div>}

      {viewerRole === "OWNER" && ownerOnly.length > 0 && <OwnerOnlyList rows={ownerOnly} />}
    </div>
  );
}

function compareToTemplate(effective: Permission[], template: Permission[]) {
  const t = new Set(template);
  const e = new Set(effective);
  const extra = effective.filter((p) => !t.has(p)).length;
  const missing = template.filter((p) => !e.has(p)).length;
  return { same: extra === 0 && missing === 0, extra, missing };
}

function ServiceCard({ id, title, description, rows, pending, onToggleService, onToggle, onConfirm }: { id: PermissionGroupId; title: string; description: string; rows: AccessRow[]; pending: string | null; onToggleService: (on: boolean) => void; onToggle: (row: AccessRow) => void; onConfirm: (row: AccessRow) => void }) {
  const [advanced, setAdvanced] = useState(false);
  const { Icon, accent } = SERVICE_STYLE[id];
  const on = rows.some((r) => r.held);
  const canSwitch = on ? rows.some((r) => r.held && r.canRevoke) : rows.some((r) => !r.held && r.canGrant);
  const busy = pending === `service:${id}`;
  const headingId = `svc-${id}`;
  return (
    <section aria-labelledby={headingId} className={cn("rounded-xl border bg-white transition-colors", on ? "border-ink-200" : "border-ink-200/70")}>
      <div className="flex items-start gap-3 px-4 py-4 sm:px-5">
        <span className={cn("mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset", accent)}>
          <Icon className="h-4.5 w-4.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="text-sm font-semibold text-ink-900">
            {title}
          </h3>
          <p className="text-xs text-ink-500">{description}</p>
          <p className="mt-1 text-xs font-medium">
            Access: <span className={on ? "text-emerald-700" : "text-ink-500"}>{on ? "Enabled" : "Disabled"}</span>
          </p>
        </div>
        <div className="flex min-h-11 items-center gap-2">
          {busy && <Spinner className="h-5 w-5" label="Saving" />}
          <Switch checked={on} disabled={!canSwitch || pending !== null} labelledBy={headingId} onChange={() => onToggleService(on)} />
        </div>
      </div>

      <div className="border-t border-ink-100 px-4 py-3 sm:px-5">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Permissions</p>
        <ul className="flex flex-wrap gap-1.5">
          {rows.map((row) => {
            const def = PERMISSION_DEFS[row.key];
            const interactive = row.held ? row.canRevoke : row.canGrant;
            return (
              <li key={row.key}>
                <button
                  type="button"
                  aria-pressed={row.held}
                  disabled={!interactive || pending !== null}
                  onClick={() => onToggle(row)}
                  title={`${def.label} — ${def.description}${!interactive && row.lockedReason ? `\n${row.lockedReason}` : ""}`}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed",
                    row.held ? "border-brand-600 bg-brand-600 text-white hover:bg-brand-700" : "border-ink-200 bg-white text-ink-700 hover:border-brand-300 hover:bg-brand-50",
                    !interactive && "opacity-60",
                  )}
                >
                  {pending === row.key ? <Spinner className="h-3.5 w-3.5" label="Saving" /> : row.held ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : !interactive ? <Lock className="h-3 w-3" aria-hidden /> : null}
                  {chipLabel(def)}
                  {def.action === "GRANT" && <span className="sr-only"> (delegation)</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced} className="mt-3 inline-flex min-h-9 items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-900">
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", advanced && "rotate-180")} aria-hidden /> Advanced permissions
        </button>
      </div>

      {advanced && (
        <ul className="divide-y divide-ink-100 border-t border-ink-100">
          {rows.map((row) => (
            <PermissionRow key={row.key} row={row} busy={pending === row.key} disabled={pending !== null} onToggle={() => onToggle(row)} onConfirm={() => onConfirm(row)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Switch({ checked, disabled, labelledBy, describedBy, onChange }: { checked: boolean; disabled?: boolean; labelledBy: string; describedBy?: string; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-brand-600" : "bg-ink-300",
      )}
    >
      <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-6" : "translate-x-1")} />
      <span className="sr-only">{checked ? "On" : "Off"}</span>
    </button>
  );
}

function PermissionRow({ row, busy, disabled, onToggle, onConfirm }: { row: AccessRow; busy: boolean; disabled: boolean; onToggle: () => void; onConfirm: () => void }) {
  const def = PERMISSION_DEFS[row.key];
  const interactive = row.held ? row.canRevoke : row.canGrant;
  const id = `perm-${row.key.replace(/\W/g, "-")}`;
  return (
    <li className="flex items-start gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p id={`${id}-label`} className="text-sm font-medium text-ink-900">
          {def.label}
          <span className="ml-2 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-600">{ACTION_LABELS[def.action]}</span>
        </p>
        <p id={`${id}-desc`} className="mt-0.5 text-xs text-ink-600">
          {def.description}
        </p>
        {row.held && row.sources.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {row.sources.map((s, i) => (
              <li key={i} className="flex items-center gap-1 text-[11px] text-ink-500">
                <CheckCircle2 className="h-3 w-3 text-emerald-600" aria-hidden />
                {sourceText(s)}
              </li>
            ))}
          </ul>
        )}
        {row.canConfirm && (
          <button type="button" onClick={onConfirm} disabled={disabled} className="mt-1.5 text-[11px] font-medium text-brand-700 underline hover:text-brand-900 disabled:opacity-50">
            Also grant as Owner — keeps it if the delegate&apos;s access ends
          </button>
        )}
        {!interactive && row.lockedReason && (
          <p className="mt-1.5 flex items-start gap-1 text-[11px] text-ink-500">
            <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            {row.lockedReason}
          </p>
        )}
      </div>
      <div className="flex min-h-11 items-center gap-2">
        {busy ? <Spinner className="h-5 w-5" label="Saving" /> : null}
        <Switch checked={row.held} disabled={!interactive || disabled} labelledBy={`${id}-label`} describedBy={`${id}-desc`} onChange={onToggle} />
      </div>
    </li>
  );
}

/** "Apply a template": role template or a named preset, with a preview of exactly what changes. */
function TemplatePicker({ user, roleTemplate, busy, onApply }: { user: AccessUserView; roleTemplate?: Permission[]; busy: boolean; onApply: (preset: string, label: string) => void }) {
  const options = [
    ...(roleTemplate ? [{ id: "role-template", label: `${ROLE_LABELS[user.role]} role template`, permissions: roleTemplate }] : []),
    ...ACCESS_PRESETS.filter((p) => p.roles.includes(user.role)).map((p) => ({ id: p.id, label: p.label, permissions: p.permissions })),
  ];
  const [choice, setChoice] = useState(options[0]?.id ?? "");
  const [confirming, setConfirming] = useState(false);
  if (!options.length) return null;
  const opt = options.find((o) => o.id === choice) ?? options[0]!;
  const diff = previewDiff(user, opt.permissions);
  const nothing = !diff.grant.length && !diff.revoke.length;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-ink-200 bg-white px-4 py-3 sm:flex-row sm:items-end sm:px-5">
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-ink-600">
        Apply a template
        <select value={opt.id} onChange={(e) => { setChoice(e.target.value); setConfirming(false); }} className="h-10 rounded-lg border border-ink-200 bg-white px-2 text-sm font-normal text-ink-900">
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {!confirming ? (
        <Button variant="outline" disabled={busy || nothing} onClick={() => setConfirming(true)}>
          {nothing ? "Already matches" : "Review changes"}
        </Button>
      ) : (
        <div className="flex flex-col gap-2 sm:items-end">
          <p className="text-xs text-ink-600" role="status">
            {diff.grant.length > 0 && <span className="text-emerald-700">+ {diff.grant.map((p) => PERMISSION_DEFS[p].label).join(", ")}</span>}
            {diff.grant.length > 0 && diff.revoke.length > 0 && <br />}
            {diff.revoke.length > 0 && <span className="text-red-700">− {diff.revoke.map((p) => PERMISSION_DEFS[p].label).join(", ")}</span>}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button loading={busy} onClick={() => { onApply(opt.id, opt.label); setConfirming(false); }}>
              Apply {diff.grant.length + diff.revoke.length} change{diff.grant.length + diff.revoke.length === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function OwnerOnlyList({ rows }: { rows: AccessRow[] }) {
  const byGroup = new Map<PermissionGroupId, AccessRow[]>();
  for (const r of rows) {
    const g = PERMISSION_DEFS[r.key].group;
    byGroup.set(g, [...(byGroup.get(g) ?? []), r]);
  }
  return (
    <details className="rounded-xl border border-ink-200 bg-white">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-5 py-3 text-sm font-semibold text-ink-900">
        <Lock className="h-4 w-4 text-ink-400" aria-hidden /> Owner-only tools ({rows.length}) — never granted
      </summary>
      <div className="space-y-3 border-t border-ink-100 px-5 py-4">
        {PERMISSION_GROUPS.filter((g) => byGroup.has(g.id)).map((g) => (
          <div key={g.id}>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{g.title}</p>
            <ul className="mt-1 grid gap-1 sm:grid-cols-2">
              {byGroup.get(g.id)!.map((r) => (
                <li key={r.key} className="flex items-center gap-1.5 text-sm text-ink-700">
                  <Lock className="h-3 w-3 text-ink-400" aria-hidden /> {PERMISSION_DEFS[r.key].label}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-xs text-ink-500">Billing-level settings, the Owner mailbox, website analytics, audit logs and the CRM / outreach / registry-sync tools stay with the Owner, whatever role or permission another account has.</p>
      </div>
    </details>
  );
}

/** Owner: default starting access per role; optionally applied to every account with the role. */
function RoleTemplatesPanel({ templates, counts, onSaved }: { templates: Record<Role, Permission[]>; counts: Record<Role, number>; onSaved: (t: Record<Role, Permission[]>) => void }) {
  const [role, setRole] = useState<Role>("DIGITAL_MARKETER");
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-ink-600">
        A role template is the access a new account with that role starts with. Saving never changes existing accounts unless you choose to apply it to them — then every person with the role is set to exactly the template (each change is recorded in the audit log). Individual people can still be customised afterwards.
      </p>
      <div role="tablist" aria-label="Role" className="flex flex-wrap gap-1.5">
        {TEMPLATE_ROLES.map((r) => (
          <button key={r} type="button" role="tab" aria-selected={role === r} onClick={() => setRole(r)} className={cn("h-9 rounded-full border px-3 text-sm font-medium", role === r ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white text-ink-700 hover:border-ink-300")}>
            {ROLE_LABELS[r]} <span className={cn("ml-1 text-xs", role === r ? "text-white/70" : "text-ink-500")}>{counts[r] ?? 0}</span>
          </button>
        ))}
      </div>
      <RoleTemplateEditor key={role} role={role} initial={templates[role]} count={counts[role] ?? 0} onSaved={onSaved} />
    </div>
  );
}

function RoleTemplateEditor({ role, initial, count, onSaved }: { role: Role; initial: Permission[]; count: number; onSaved: (t: Record<Role, Permission[]>) => void }) {
  const [selected, setSelected] = useState(new Set(initial));
  const [applyToExisting, setApplyToExisting] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const eligible = PERMISSION_CATALOG.filter((d) => !d.ownerOnly && d.eligibleRoles.includes(role));
  const groups = PERMISSION_GROUPS.map((g) => ({ ...g, defs: eligible.filter((d) => d.group === g.id) })).filter((g) => g.defs.length);
  const changed = selected.size !== initial.length || initial.some((p) => !selected.has(p));

  async function save() {
    setSaving(true);
    try {
      const res = await apiFetch<{ templates: Record<Role, Permission[]>; accounts: number; changes: number }>("/api/admin/access", { method: "PUT", body: { role, permissions: [...selected], applyToExisting } });
      toast.success(applyToExisting ? `${ROLE_LABELS[role]} template saved and applied — ${res.changes} change${res.changes === 1 ? "" : "s"} across ${res.accounts} account${res.accounts === 1 ? "" : "s"}.` : `${ROLE_LABELS[role]} template saved.`);
      onSaved(res.templates);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save the template.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-500">{ROLE_DESCRIPTIONS[role]}</p>
      <div className="grid gap-3 md:grid-cols-2">
        {groups.map((g) => {
          const { Icon, accent } = SERVICE_STYLE[g.id];
          return (
            <fieldset key={g.id} className="rounded-xl border border-ink-200 bg-white p-4">
              <legend className="sr-only">{g.title}</legend>
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-900">
                <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded-md ring-1 ring-inset", accent)}>
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                {g.title}
              </p>
              <div className="space-y-1">
                {g.defs.map((d) => (
                  <label key={d.key} className="flex min-h-10 cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-ink-50">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600"
                      checked={selected.has(d.key)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(d.key);
                        else next.delete(d.key);
                        setSelected(next);
                      }}
                    />
                    <span>
                      <span className="block font-medium text-ink-900">{d.label}</span>
                      <span className="block text-xs text-ink-500">{d.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
      <div className="flex flex-col gap-3 rounded-xl border border-ink-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-start gap-2 text-sm text-ink-700">
          <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600" checked={applyToExisting} onChange={(e) => setApplyToExisting(e.target.checked)} disabled={!count} />
          <span>
            Also apply to the {count} existing {ROLE_LABELS[role]} account{count === 1 ? "" : "s"}
            <span className="block text-xs text-ink-500">Their access is set to exactly this template. Individual customisations are replaced.</span>
          </span>
        </label>
        <Button loading={saving} disabled={!changed && !applyToExisting} onClick={() => void save()}>
          Save template
        </Button>
      </div>
    </div>
  );
}

function StartingAccess({ role, abilities, selected, onChange }: { role: Role; abilities: AccountAbilities; selected: Set<Permission>; onChange: (s: Set<Permission>) => void }) {
  const grantable = new Set(abilities.grantable[role] ?? []);
  const groups = PERMISSION_GROUPS.map((g) => ({ ...g, defs: PERMISSION_CATALOG.filter((d) => d.group === g.id && grantable.has(d.key)) })).filter((g) => g.defs.length);
  if (!groups.length) return <p className="text-sm text-ink-500">No permissions to choose for this role.</p>;
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium text-ink-800">Starting access</legend>
      <p className="mb-2 text-xs text-ink-500">From the {ROLE_LABELS[role]} role template — change anything now or later.</p>
      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g.id}>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">{g.title}</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {g.defs.map((d) => (
                <label key={d.key} className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm hover:bg-ink-50">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600"
                    checked={selected.has(d.key)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(d.key);
                      else next.delete(d.key);
                      onChange(next);
                    }}
                  />
                  <span>
                    <span className="block font-medium text-ink-900">{d.label}</span>
                    <span className="block text-xs text-ink-500">{d.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

type Candidate = { status: "NEW" | "LINKABLE" | "MEMBER" | "BLOCKED"; message: string; name?: string; role?: Role };

function CreateAccountButton({ abilities, onCreated }: { abilities: AccountAbilities; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>(abilities.assignableRoles.includes("STAFF") ? "STAFF" : abilities.assignableRoles[0]!);
  const [perms, setPerms] = useState<Set<Permission>>(new Set(abilities.templates[role] ?? []));
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [checking, setChecking] = useState(false);
  const toast = useToast();

  /** Look the email up first: new account, activate an existing one, or explain why it can't be added. */
  async function check(email: string) {
    setCandidate(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return;
    setChecking(true);
    try {
      setCandidate(await apiFetch<Candidate>(`/api/admin/users/lookup?email=${encodeURIComponent(email.trim())}`));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not check this email.");
    } finally {
      setChecking(false);
    }
  }

  function chooseRole(r: Role) {
    setRole(r);
    setPerms(new Set(abilities.templates[r] ?? []));
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true);
    setErrors({});
    try {
      const linking = candidate?.status === "LINKABLE";
      const res = await apiFetch<{ linked: boolean; needsPassword?: boolean }>("/api/admin/users", { body: { name: fd.get("name"), email: fd.get("email"), password: linking ? undefined : fd.get("password"), role, permissions: [...perms] } });
      toast.success(res.linked ? `Existing account activated as an employee${res.needsPassword ? " — they set a password with “Forgot password”" : ""}.` : `${ROLE_LABELS[role]} added — active now.`);
      setOpen(false);
      setCandidate(null);
      onCreated();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors ?? {});
        toast.error(err.message);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden /> Add employee
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add employee" description="The employee is active immediately — no invitation to accept. They confirm their email address the first time they sign in." size="lg">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" error={errors.name}>
              {(p) => <Input {...p} name="name" required />}
            </Field>
            <Field label="Email" error={errors.email} hint={checking ? "Checking…" : undefined}>
              {(p) => <Input {...p} name="email" type="email" required onBlur={(e) => void check(e.target.value)} onChange={() => setCandidate(null)} />}
            </Field>
            {candidate?.status !== "LINKABLE" && (
              <Field label="Initial password" error={errors.password} hint="At least 10 characters. Ask them to change it after signing in.">
                {(p) => <Input {...p} name="password" type="password" minLength={10} required />}
              </Field>
            )}
            <Field label="Role" hint={ROLE_DESCRIPTIONS[role]}>
              {(p) => (
                <Select {...p} value={role} onChange={(e) => chooseRole(e.target.value as Role)}>
                  {abilities.assignableRoles
                    .filter((r) => r !== "OWNER")
                    .map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          </div>
          {candidate && candidate.status !== "NEW" && (
            <p role="status" className={cn("rounded-lg px-3 py-2 text-sm", candidate.status === "LINKABLE" ? "bg-sky-50 text-sky-900" : "bg-amber-50 text-amber-900")}>
              {candidate.message}
            </p>
          )}
          {candidate?.status !== "LINKABLE" && <StartingAccess role={role} abilities={abilities} selected={perms} onChange={setPerms} />}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={checking || candidate?.status === "MEMBER" || candidate?.status === "BLOCKED"}>
              {candidate?.status === "LINKABLE" ? "Activate employee" : "Add employee"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function EditAccountButton({ user, abilities, canDelete, onSaved }: { user: AccessUserView; abilities: AccountAbilities; canDelete: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true);
    try {
      const body: Record<string, unknown> = { status: fd.get("status") };
      if (fd.get("role") && fd.get("role") !== user.role) body.role = fd.get("role");
      await apiFetch(`/api/admin/users/${user.id}`, { method: "PATCH", body });
      toast.success("Account updated");
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setPending(false);
    }
  }
  async function signOutEverywhere() {
    try {
      await apiFetch(`/api/admin/users/${user.id}`, { body: {} });
      toast.success(`${user.name} was signed out everywhere`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed");
    }
  }
  async function deleteAccount() {
    if (!confirm(`Permanently delete ${user.name}'s account? They are signed out and can't sign in again. Their past work stays; anything assigned to them becomes unassigned. This can't be undone.`)) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      toast.success(`${user.name}'s account was deleted`);
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete the account.");
    } finally {
      setDeleting(false);
    }
  }
  const roleOptions = abilities.assignableRoles.includes(user.role) ? abilities.assignableRoles : [user.role, ...abilities.assignableRoles];
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <UserRound className="h-4 w-4" aria-hidden /> Account
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Account — ${user.name}`} size="md">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Role" hint="Changing the role removes permissions the new role can't have. It never adds any.">
              {(p) => (
                <Select {...p} name="role" defaultValue={user.role} disabled={abilities.assignableRoles.length <= 1 && abilities.assignableRoles[0] === user.role}>
                  {roleOptions.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Status">
              {(p) => (
                <Select {...p} name="status" defaultValue={user.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE"}>
                  <option value="ACTIVE">Active</option>
                  <option value="SUSPENDED">Suspended</option>
                </Select>
              )}
            </Field>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void signOutEverywhere()}>
                Sign out everywhere
              </Button>
              {canDelete && (
                <Button variant="danger" loading={deleting} onClick={() => void deleteAccount()}>
                  <Trash2 className="h-4 w-4" aria-hidden /> Delete account
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={pending}>
                Save
              </Button>
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}
