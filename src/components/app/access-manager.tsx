"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, CheckCircle2, Clock3, Lock, Plus, Search, ShieldCheck, Trash2, UserRound } from "lucide-react";
import type { AccessRow, AccessUserView } from "@/features/access/service";
import { apiFetch, ApiError } from "@/lib/api/client";
import { PERMISSION_DEFS, PERMISSION_GROUPS, ROLE_DESCRIPTIONS, ROLE_LABELS, type Permission, type PermissionGroupId, type Role } from "@/lib/permissions/catalog";
import { cn } from "@/lib/utils";
import { Badge, DemoBadge, StatusBadge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Avatar } from "@/components/ui/data";
import { Modal } from "@/components/ui/overlay";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";

const ROLE_TONE: Record<Role, BadgeTone> = { OWNER: "violet", ADMIN: "brand", STAFF: "neutral", DIGITAL_MARKETER: "info", CLIENT: "neutral" };
const ROLE_FILTERS: (Role | "ALL")[] = ["ALL", "ADMIN", "STAFF", "DIGITAL_MARKETER", "OWNER"];

export type AccountAbilities = {
  /** Roles this person may give when creating or editing an account. */
  assignableRoles: Role[];
  /** Roles of accounts whose role / status this person may change. */
  editableRoles: Role[];
  /** Permissions this person may give a new account of each role (server-computed). */
  grantable: Partial<Record<Role, Permission[]>>;
  /** Suggested starting access per role, already limited to `grantable`. */
  templates: Partial<Record<Role, Permission[]>>;
};

const fmtDate = (iso?: string) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)) : undefined);

function sourceText(s: AccessRow["sources"][number]) {
  const when = fmtDate(s.at);
  if (s.origin === "MIGRATION") return "Existing access (from before per-person permissions)";
  if (s.origin === "OWNER") return `Granted by ${s.by ?? "the Owner"}${when ? ` · ${when}` : ""}`;
  return `Granted by ${s.by ?? "a Super Admin"}${s.byRole ? ` (${s.byRole})` : ""}${s.via ? ` using “${PERMISSION_DEFS[s.via as Permission]?.label ?? s.via}”` : ""}${when ? ` · ${when}` : ""}`;
}

/**
 * Permission Management: pick a person, see in plain language what they can use, and turn
 * individual permissions on or off. Every change is a single server-checked grant or revocation
 * (the server decides; the UI only reflects it). Owner-only areas are listed as locked — the
 * page never offers a control to grant them.
 */
export function AccessManager({ initialUsers, viewerRole, abilities }: { initialUsers: AccessUserView[]; viewerRole: Role; abilities: AccountAbilities }) {
  const [users, setUsers] = useState(initialUsers);
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
                  <span className="text-[11px] text-ink-500">{u.role === "OWNER" ? "Full access" : u.status !== "ACTIVE" ? u.status.replace(/_/g, " ").toLowerCase() : `${countVisible(u)} granted`}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Selected person */}
      <section aria-label="Access details" className={cn(!mobileDetail && "hidden lg:block")}>
        {selected ? (
          <PersonAccess key={selected.id} user={selected} viewerRole={viewerRole} abilities={abilities} onBack={() => setMobileDetail(false)} onChange={(v) => { replace(v); void refreshAll(); }} onAccountChanged={() => { void refreshAll(); router.refresh(); }} toast={toast} />
        ) : (
          <div className="rounded-xl border border-dashed border-ink-200 p-8 text-center text-sm text-ink-500">Select a person to see and change their access.</div>
        )}
      </section>
    </div>
  );
}

function countVisible(u: AccessUserView) {
  return u.effective.filter((p) => !PERMISSION_DEFS[p]?.ownerOnly).length;
}

function PersonAccess({ user, viewerRole, abilities, onBack, onChange, onAccountChanged, toast }: { user: AccessUserView; viewerRole: Role; abilities: AccountAbilities; onBack: () => void; onChange: (v: AccessUserView) => void; onAccountChanged: () => void; toast: ReturnType<typeof useToast> }) {
  const [pending, setPending] = useState<Permission | null>(null);
  const isOwnerTarget = user.role === "OWNER";

  // Only rows that apply to this person's role; Owner-only areas are listed separately (locked).
  const rows = user.rows.filter((r) => {
    const d = PERMISSION_DEFS[r.key];
    return d && !d.ownerOnly && d.eligibleRoles.includes(user.role);
  });
  const ownerOnly = user.rows.filter((r) => PERMISSION_DEFS[r.key]?.ownerOnly);
  const groups = PERMISSION_GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => PERMISSION_DEFS[r.key].group === g.id) })).filter((g) => g.rows.length > 0);
  const effective = user.effective.filter((p) => !PERMISSION_DEFS[p]?.ownerOnly);

  async function toggle(row: AccessRow, confirm = false) {
    const action = row.held && !confirm ? "revoke" : "grant";
    setPending(row.key);
    try {
      const view = await apiFetch<AccessUserView>(`/api/admin/users/${user.id}/access`, { body: { permission: row.key, action } });
      onChange(view);
      toast.success(confirm ? `“${PERMISSION_DEFS[row.key].label}” is now also granted by you — it stays if the delegate's access ends.` : `${action === "grant" ? "Granted" : "Removed"} “${PERMISSION_DEFS[row.key].label}” ${action === "grant" ? "to" : "from"} ${user.name}.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not change access.");
    } finally {
      setPending(null);
    }
  }

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

        {/* Effective access summary */}
        <div className="mt-4 rounded-lg bg-ink-50 px-4 py-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Can use right now
          </p>
          {isOwnerTarget ? (
            <p className="mt-1 text-sm text-ink-800">Everything, including Owner-only areas such as Company Intelligence.</p>
          ) : effective.length === 0 ? (
            <p className="mt-1 text-sm text-ink-700">Nothing yet — this person only sees their own profile and notifications.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {effective.map((p) => (
                <li key={p} className="rounded-md bg-white px-2 py-1 text-xs font-medium text-ink-800 ring-1 ring-ink-200">
                  {PERMISSION_DEFS[p]?.label ?? p}
                </li>
              ))}
            </ul>
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

      {!isOwnerTarget &&
        groups.map((g) => (
          <section key={g.id} aria-labelledby={`grp-${g.id}`} className="rounded-xl border border-ink-200 bg-white">
            <header className="border-b border-ink-100 px-5 py-3">
              <h3 id={`grp-${g.id}`} className="text-sm font-semibold text-ink-900">
                {g.title}
              </h3>
              <p className="text-xs text-ink-500">{g.description}</p>
            </header>
            <ul className="divide-y divide-ink-100">
              {g.rows.map((row) => (
                <PermissionRow key={row.key} row={row} busy={pending === row.key} disabled={pending !== null} onToggle={() => void toggle(row)} onConfirm={() => void toggle(row, true)} />
              ))}
            </ul>
          </section>
        ))}

      {!isOwnerTarget && groups.length === 0 && <div className="rounded-xl border border-dashed border-ink-200 p-6 text-sm text-ink-500">There is nothing you can change for this person.</div>}

      {viewerRole === "OWNER" && ownerOnly.length > 0 && <OwnerOnlyList rows={ownerOnly} />}
    </div>
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
          {def.action === "GRANT" && <span className="ml-2 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">Delegation</span>}
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
      <div className="flex min-h-11 items-center">
        {busy ? <Spinner className="h-5 w-5" label="Saving" /> : null}
        <button
          type="button"
          role="switch"
          aria-checked={row.held}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-desc`}
          disabled={!interactive || disabled}
          onClick={onToggle}
          className={cn(
            "relative ml-2 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed",
            row.held ? "bg-brand-600" : "bg-ink-300",
            !interactive && "opacity-50",
          )}
        >
          <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", row.held ? "translate-x-6" : "translate-x-1")} />
          <span className="sr-only">{row.held ? "On" : "Off"}</span>
        </button>
      </div>
    </li>
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
        <Lock className="h-4 w-4 text-ink-400" aria-hidden /> Owner-only areas ({rows.length}) — can never be granted
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
        <p className="text-xs text-ink-500">Company Intelligence (registrations, research, CRM, outreach and its exports) stays with the Owner, whatever role or permission another account has.</p>
      </div>
    </details>
  );
}

function StartingAccess({ role, abilities, selected, onChange }: { role: Role; abilities: AccountAbilities; selected: Set<Permission>; onChange: (s: Set<Permission>) => void }) {
  const grantable = new Set(abilities.grantable[role] ?? []);
  const visible = Object.values(PERMISSION_DEFS).filter((d) => grantable.has(d.key));
  if (!visible.length) return <p className="text-sm text-ink-500">No permissions to choose for this role.</p>;
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium text-ink-800">Starting access</legend>
      <p className="mb-2 text-xs text-ink-500">{role === "DIGITAL_MARKETER" ? "Digital Marketers start with no access. Turn on only what they need." : "Suggested for this role — change anything now or later."}</p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {visible.map((d) => (
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
