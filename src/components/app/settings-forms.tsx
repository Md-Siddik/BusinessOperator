"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { RefreshCw, Save } from "lucide-react";
import { INDUSTRIES, INDUSTRY_LABELS } from "@/config/industries";
import { LANGUAGES } from "@/config/languages";
import { apiFetch, ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";

function useSave(key: string) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  async function save(value: unknown) {
    setPending(true);
    setErrors({});
    try {
      await apiFetch(`/api/admin/settings/${key}`, { method: "PUT", body: value });
      toast.success("Settings saved");
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors ?? {});
        toast.error(e.message);
      }
    } finally {
      setPending(false);
    }
  }
  return { pending, errors, save };
}

function SaveBar({ pending }: { pending: boolean }) {
  return (
    <div className="flex justify-end border-t border-ink-100 pt-4">
      <Button type="submit" loading={pending}>
        <Save className="h-4 w-4" aria-hidden /> Save changes
      </Button>
    </div>
  );
}

export function GeneralSettingsForm({ value }: { value: { companyName: string; tagline: string; logoText: string; contactEmail: string; contactPhone: string; address: string; social: { linkedin: string; x: string; instagram: string } } }) {
  const { pending, errors, save } = useSave("general");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const g = (k: string) => String(fd.get(k) ?? "");
    void save({ companyName: g("companyName"), tagline: g("tagline"), logoText: g("logoText"), contactEmail: g("contactEmail"), contactPhone: g("contactPhone"), address: g("address"), social: { linkedin: g("linkedin"), x: g("x"), instagram: g("instagram") } });
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company name" error={errors.companyName}>{(p) => <Input {...p} name="companyName" defaultValue={value.companyName} />}</Field>
        <Field label="Logo text" error={errors.logoText}>{(p) => <Input {...p} name="logoText" defaultValue={value.logoText} />}</Field>
      </div>
      <Field label="Tagline" error={errors.tagline}>{(p) => <Input {...p} name="tagline" defaultValue={value.tagline} />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact email" error={errors.contactEmail}>{(p) => <Input {...p} name="contactEmail" type="email" defaultValue={value.contactEmail} />}</Field>
        <Field label="Contact phone" optional="optional">{(p) => <Input {...p} name="contactPhone" defaultValue={value.contactPhone} />}</Field>
      </div>
      <Field label="Address" optional="optional">{(p) => <Input {...p} name="address" defaultValue={value.address} />}</Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="LinkedIn URL" optional="optional">{(p) => <Input {...p} name="linkedin" defaultValue={value.social.linkedin} />}</Field>
        <Field label="X URL" optional="optional">{(p) => <Input {...p} name="x" defaultValue={value.social.x} />}</Field>
        <Field label="Instagram URL" optional="optional">{(p) => <Input {...p} name="instagram" defaultValue={value.social.instagram} />}</Field>
      </div>
      <p className="text-xs text-ink-500">The domain and canonical URL come from environment configuration (NEXT_PUBLIC_SITE_URL / NEXT_PUBLIC_SITE_DOMAIN).</p>
      <SaveBar pending={pending} />
    </form>
  );
}

type ProviderOption = { id: string; name: string; isDemo: boolean; configured: boolean; description: string; freshness: string; recommendedSyncMinutes: number; dailyFeed: boolean };

export function CountrySettingsRow({ country }: { country: { code: string; name: string; flag: string; enabled: boolean; providerId: string; syncEnabled: boolean; syncIntervalMinutes: number; backfillDays: number; providers: ProviderOption[] } }) {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState(country);
  const [pending, setPending] = useState<string | null>(null);
  async function patch(update: Partial<typeof country>) {
    setPending("save");
    try {
      await apiFetch(`/api/countries/${country.code}`, { method: "PATCH", body: update });
      setState((s) => ({ ...s, ...update }));
      toast.success(`${country.name} updated`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Update failed");
    } finally {
      setPending(null);
    }
  }
  async function sync() {
    setPending("sync");
    try {
      await apiFetch("/api/registry/sync", { body: { country: country.code, kind: "BACKFILL" } });
      toast.success(`${country.name}: sync started in the background — see Data Sources for progress.`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Sync failed");
    } finally {
      setPending(null);
    }
  }
  const provider = state.providers.find((p) => p.id === state.providerId);
  return (
    <div className="grid gap-4 border-b border-ink-100 px-5 py-4 last:border-0 lg:grid-cols-[12rem_1fr_auto] lg:items-center">
      <div className="flex items-center gap-2">
        <span className="text-xl" aria-hidden>{country.flag}</span>
        <div>
          <p className="font-medium">{country.name}</p>
          <p className="text-xs text-ink-500">{country.code}</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-ink-500">Registry provider</span>
          <Select value={state.providerId} onChange={(e) => void patch({ providerId: e.target.value })} disabled={!!pending}>
            {state.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isDemo ? " (DEMO)" : !p.dailyFeed ? " (no feed)" : !p.configured ? " (credentials missing)" : ""}
              </option>
            ))}
          </Select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-ink-500">Interval (minutes)</span>
          <Input type="number" min={15} step={15} defaultValue={state.syncIntervalMinutes} className="w-28" onBlur={(e) => Number(e.target.value) !== state.syncIntervalMinutes && void patch({ syncIntervalMinutes: Number(e.target.value) })} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-ink-500">First backfill (days)</span>
          <Input type="number" min={0} max={90} defaultValue={state.backfillDays} className="w-24" onBlur={(e) => Number(e.target.value) !== state.backfillDays && void patch({ backfillDays: Number(e.target.value) })} />
        </label>
        <div className="flex gap-4 pb-2">
          <Checkbox checked={state.enabled} onChange={(e) => void patch({ enabled: e.target.checked })} label="Enabled" />
          <Checkbox checked={state.syncEnabled} onChange={(e) => void patch({ syncEnabled: e.target.checked })} label="Scheduled sync" />
        </div>
        {provider && (
          <p className="text-xs text-ink-500 sm:col-span-4">
            {provider.description} Recommended interval: {provider.recommendedSyncMinutes >= 60 ? `${Math.round(provider.recommendedSyncMinutes / 60)} h` : `${provider.recommendedSyncMinutes} min`} — don&apos;t poll a government API more often than its data changes.{" "}
            {provider.isDemo ? <Badge tone="demo">Demo data</Badge> : null}
          </p>
        )}
      </div>
      <Button variant="outline" size="sm" onClick={() => void sync()} loading={pending === "sync"} disabled={!state.enabled || !provider?.dailyFeed || !provider.configured}>
        {pending !== "sync" && <RefreshCw className="h-4 w-4" aria-hidden />} Sync now
      </Button>
    </div>
  );
}

export function LanguageSettingsForm({ value }: { value: { enabled: string[]; defaultLanguage: string } }) {
  const { pending, save } = useSave("languages");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    void save({ enabled: fd.getAll("enabled"), defaultLanguage: fd.get("defaultLanguage") });
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Enabled website languages</legend>
        <div className="grid gap-2 sm:grid-cols-4">
          {LANGUAGES.map((l) => (
            <Checkbox key={l.code} name="enabled" value={l.code} defaultChecked={value.enabled.includes(l.code)} disabled={l.code === "en"} label={`${l.englishName} (${l.nativeName})`} />
          ))}
        </div>
        <input type="hidden" name="enabled" value="en" />
        <p className="mt-2 text-xs text-ink-500">English is the fallback language and is always enabled. Disabled languages return 404 and disappear from the language switcher and sitemap.</p>
      </fieldset>
      <Field label="Default language for new clients, templates and x-default" hint="Public URLs keep English at the clean, unprefixed paths.">
        {(p) => (
          <Select {...p} name="defaultLanguage" defaultValue={value.defaultLanguage} className="w-64">
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.englishName}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <SaveBar pending={pending} />
    </form>
  );
}

type Row = { key: string; english: string; base?: string; override?: string; status: string };

/** Translation editor: overrides are stored per locale/key and applied on top of the reviewed JSON dictionaries. */
export function TranslationEditor({ namespaces }: { namespaces: string[] }) {
  const toast = useToast();
  const [locale, setLocale] = useState("de");
  const [namespace, setNamespace] = useState("home");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      apiFetch<Row[]>(`/api/translations?locale=${locale}&namespace=${encodeURIComponent(namespace)}&q=${encodeURIComponent(q)}`)
        .then((r) => !cancelled && setRows(r))
        .catch(() => !cancelled && setRows([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [locale, namespace, q]);
  async function saveRow(key: string, value: string) {
    try {
      await apiFetch("/api/translations", { method: "PUT", body: { locale, key, value } });
      setRows((rs) => rs?.map((r) => (r.key === key ? { ...r, override: value || undefined, status: value ? "overridden" : r.base ? "translated" : "missing" } : r)) ?? null);
      toast.success(value ? "Translation saved" : "Override removed");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Save failed");
    }
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-ink-500">Language</span>
          <Select value={locale} onChange={(e) => setLocale(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.englishName}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-ink-500">Section</span>
          <Select value={namespace} onChange={(e) => setNamespace(e.target.value)}>
            {namespaces.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-ink-500">Search</span>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Key or text" />
        </label>
      </div>
      {rows === null ? (
        <div className="flex justify-center py-8">
          <Spinner className="text-brand-600" />
        </div>
      ) : (
        <ul className="divide-y divide-ink-100 rounded-xl border border-ink-200">
          {rows.map((r) => (
            <TranslationRow key={`${locale}:${r.key}`} row={r} onSave={saveRow} isEnglish={locale === "en"} />
          ))}
          {rows.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-500">No matching keys.</li>}
        </ul>
      )}
    </div>
  );
}

function TranslationRow({ row, onSave, isEnglish }: { row: Row; onSave: (key: string, value: string) => Promise<void>; isEnglish: boolean }) {
  const [value, setValue] = useState(row.override ?? row.base ?? "");
  const dirty = value !== (row.override ?? row.base ?? "");
  return (
    <li className="grid gap-2 p-4 lg:grid-cols-[1fr_1fr_auto] lg:items-start">
      <div>
        <code className="text-[11px] text-ink-500">{row.key}</code>
        {!isEnglish && <p className="mt-1 text-sm text-ink-600">{row.english}</p>}
      </div>
      <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={Math.min(6, Math.max(2, Math.ceil(value.length / 60)))} aria-label={`Translation for ${row.key}`} className={cn(row.status === "missing" && "border-amber-300")} />
      <div className="flex items-center gap-2 lg:flex-col lg:items-end">
        <Badge tone={row.status === "overridden" ? "brand" : row.status === "missing" ? "warning" : "neutral"}>{row.status}</Badge>
        <Button size="xs" disabled={!dirty} onClick={() => void onSave(row.key, value)}>
          Save
        </Button>
        {row.override && (
          <Button size="xs" variant="ghost" onClick={() => void onSave(row.key, "").then(() => setValue(row.base ?? ""))}>
            Reset
          </Button>
        )}
      </div>
    </li>
  );
}

type Rule = { id: string; label: string; points: number; enabled: boolean };
export function ScoringSettingsForm({ value }: { value: { qualifiedThreshold: number; newlyRegisteredDays: number; relevantIndustries: string[]; limitedLegalForms: string[]; rules: Rule[] } }) {
  const { pending, errors, save } = useSave("leadScoring");
  const [rules, setRules] = useState(value.rules);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    void save({
      qualifiedThreshold: Number(fd.get("qualifiedThreshold")),
      newlyRegisteredDays: Number(fd.get("newlyRegisteredDays")),
      relevantIndustries: fd.getAll("relevantIndustries"),
      limitedLegalForms: String(fd.get("limitedLegalForms") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      rules,
    });
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Qualified threshold" error={errors.qualifiedThreshold} hint="Companies at or above this score move from New to Qualified.">
          {(p) => <Input {...p} name="qualifiedThreshold" type="number" min={0} max={100} defaultValue={value.qualifiedThreshold} />}
        </Field>
        <Field label="“Newly registered” window (days)" error={errors.newlyRegisteredDays}>
          {(p) => <Input {...p} name="newlyRegisteredDays" type="number" min={1} max={365} defaultValue={value.newlyRegisteredDays} />}
        </Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Scoring rules</legend>
        <div className="divide-y divide-ink-100 rounded-xl border border-ink-200">
          {rules.map((r, i) => (
            <div key={r.id} className="grid grid-cols-[auto_1fr_6rem] items-center gap-3 px-4 py-2.5">
              <input type="checkbox" checked={r.enabled} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} className="h-4 w-4 accent-brand-600" aria-label={`Enable ${r.label}`} />
              <Input value={r.label} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="Rule label" className="h-9" />
              <Input type="number" min={-50} max={50} value={r.points} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, points: Number(e.target.value) } : x)))} aria-label={`Points for ${r.label}`} className="h-9" />
            </div>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Relevant industries</legend>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {INDUSTRIES.map((i) => (
            <Checkbox key={i} name="relevantIndustries" value={i} defaultChecked={value.relevantIndustries.includes(i)} label={INDUSTRY_LABELS[i]} />
          ))}
        </div>
      </fieldset>
      <Field label="Limited-company legal forms (comma-separated)">{(p) => <Input {...p} name="limitedLegalForms" defaultValue={value.limitedLegalForms.join(", ")} />}</Field>
      <p className="text-xs text-ink-500">Saving recalculates every company&apos;s score.</p>
      <SaveBar pending={pending} />
    </form>
  );
}

export function OutreachSettingsForm({ value }: { value: { allowSelfApproval: boolean; dailySendLimit: number; senderName: string; senderEmail: string; postalAddress: string; footer: string } }) {
  const { pending, errors, save } = useSave("outreach");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    void save({ requireApproval: true, allowSelfApproval: fd.get("allowSelfApproval") === "on", dailySendLimit: Number(fd.get("dailySendLimit")), senderName: fd.get("senderName"), senderEmail: fd.get("senderEmail"), postalAddress: fd.get("postalAddress"), footer: fd.get("footer") });
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="rounded-lg bg-ink-50 px-4 py-3 text-sm text-ink-700">Human approval is always required before any outreach email is sent. This cannot be disabled.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Sender name" error={errors.senderName}>{(p) => <Input {...p} name="senderName" defaultValue={value.senderName} />}</Field>
        <Field label="Sender email" error={errors.senderEmail}>{(p) => <Input {...p} name="senderEmail" type="email" defaultValue={value.senderEmail} />}</Field>
        <Field label="Daily send limit" error={errors.dailySendLimit}>{(p) => <Input {...p} name="dailySendLimit" type="number" min={1} max={1000} defaultValue={value.dailySendLimit} />}</Field>
      </div>
      <Field label="Postal address (shown in footer)" optional="optional">{(p) => <Input {...p} name="postalAddress" defaultValue={value.postalAddress} />}</Field>
      <Field label="Compliance footer" hint="Must contain {{unsubscribeUrl}}." error={errors.footer}>{(p) => <Textarea {...p} name="footer" rows={3} defaultValue={value.footer} />}</Field>
      <Checkbox name="allowSelfApproval" defaultChecked={value.allowSelfApproval} label="Allow approvers to approve their own drafts (not recommended)" />
      <SaveBar pending={pending} />
    </form>
  );
}

export function ChatSettingsForm({ value, staff }: { value: { recipientUserIds: string[]; defaultAssigneeId?: string | null; emailNotifications: boolean; browserNotifications: boolean; workingHours: { timezone: string; days: number[]; start: string; end: string }; autoResponse: { enabled: boolean; outsideHoursOnly: boolean; message: string }; availabilityText: string }; staff: { id: string; name: string }[] }) {
  const { pending, errors, save } = useSave("chat");
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    void save({
      recipientUserIds: fd.getAll("recipientUserIds"),
      defaultAssigneeId: fd.get("defaultAssigneeId") || null,
      emailNotifications: fd.get("emailNotifications") === "on",
      browserNotifications: fd.get("browserNotifications") === "on",
      workingHours: { timezone: fd.get("timezone"), days: fd.getAll("days").map(Number), start: fd.get("start"), end: fd.get("end") },
      autoResponse: { enabled: fd.get("autoEnabled") === "on", outsideHoursOnly: fd.get("outsideHoursOnly") === "on", message: fd.get("autoMessage") },
      availabilityText: fd.get("availabilityText"),
    });
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <Section title="Who receives client messages">
        <p className="mb-2 text-xs text-ink-500">Assigned conversations notify the assignee. Unassigned ones notify the people selected here (or everyone with chat.manage if none are selected).</p>
        <div className="grid gap-1.5 sm:grid-cols-3">
          {staff.map((s) => (
            <Checkbox key={s.id} name="recipientUserIds" value={s.id} defaultChecked={value.recipientUserIds.includes(s.id)} label={s.name} />
          ))}
        </div>
        <Field label="Default assignee for new client conversations" className="mt-4 max-w-sm">
          {(p) => (
            <Select {...p} name="defaultAssigneeId" defaultValue={value.defaultAssigneeId ?? ""}>
              <option value="">Leave unassigned</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </Section>
      <Section title="Notifications">
        <div className="space-y-2">
          <Checkbox name="emailNotifications" defaultChecked={value.emailNotifications} label="Email notifications (throttled: max one per conversation per 30 minutes; users can opt out)" />
          <Checkbox name="browserNotifications" defaultChecked={value.browserNotifications} label="In-app real-time notifications" />
        </div>
      </Section>
      <Section title="Working hours & availability">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Time zone">{(p) => <Input {...p} name="timezone" defaultValue={value.workingHours.timezone} />}</Field>
          <Field label="Start">{(p) => <Input {...p} name="start" type="time" defaultValue={value.workingHours.start} />}</Field>
          <Field label="End">{(p) => <Input {...p} name="end" type="time" defaultValue={value.workingHours.end} />}</Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          {DAYS.map((d, i) => (
            <Checkbox key={d} name="days" value={String(i)} defaultChecked={value.workingHours.days.includes(i)} label={d} />
          ))}
        </div>
        <Field label="Availability text shown to clients" className="mt-4" error={errors.availabilityText} hint="Honest expectation-setting — we never show a fake “online” indicator.">
          {(p) => <Input {...p} name="availabilityText" defaultValue={value.availabilityText} />}
        </Field>
      </Section>
      <Section title="Auto-response">
        <div className="space-y-2">
          <Checkbox name="autoEnabled" defaultChecked={value.autoResponse.enabled} label="Send an automatic acknowledgement when a client starts a conversation" />
          <Checkbox name="outsideHoursOnly" defaultChecked={value.autoResponse.outsideHoursOnly} label="Only outside working hours" />
        </div>
        <Field label="Message" className="mt-3">{(p) => <Textarea {...p} name="autoMessage" rows={3} defaultValue={value.autoResponse.message} />}</Field>
      </Section>
      <SaveBar pending={pending} />
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-xl border border-ink-200 p-4">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

export function SecurityForms({ profile }: { profile: { name: string; phone?: string; preferredLanguage: string; emailOnChatMessage: boolean; emailOnTicketUpdate: boolean } }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [pwErrors, setPwErrors] = useState<Record<string, string[]>>({});
  async function call(key: string, fn: () => Promise<unknown>, msg: string) {
    setPending(key);
    try {
      await fn();
      toast.success(msg);
      router.refresh();
      return true;
    } catch (e) {
      if (e instanceof ApiError) {
        setPwErrors(e.fieldErrors ?? {});
        toast.error(e.message);
      }
      return false;
    } finally {
      setPending(null);
    }
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          void call("profile", () => apiFetch("/api/auth/me", { method: "PATCH", body: { name: fd.get("name"), phone: fd.get("phone"), preferredLanguage: fd.get("preferredLanguage"), notificationPrefs: { emailOnChatMessage: fd.get("emailOnChatMessage") === "on", emailOnTicketUpdate: fd.get("emailOnTicketUpdate") === "on" } } }), "Profile saved");
        }}
      >
        <h3 className="text-sm font-semibold">Profile & notifications</h3>
        <Field label="Name">{(p) => <Input {...p} name="name" defaultValue={profile.name} />}</Field>
        <Field label="Phone" optional="optional">{(p) => <Input {...p} name="phone" defaultValue={profile.phone} />}</Field>
        <Field label="Preferred language">
          {(p) => (
            <Select {...p} name="preferredLanguage" defaultValue={profile.preferredLanguage}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.nativeName}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Checkbox name="emailOnChatMessage" defaultChecked={profile.emailOnChatMessage} label="Email me about new chat messages" />
        <Checkbox name="emailOnTicketUpdate" defaultChecked={profile.emailOnTicketUpdate} label="Email me about request & ticket updates" />
        <Button type="submit" loading={pending === "profile"}>
          Save profile
        </Button>
      </form>
      <div className="space-y-6">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fd = new FormData(form);
            setPwErrors({});
            void call("pw", () => apiFetch("/api/auth/me", { body: { action: "change-password", currentPassword: fd.get("currentPassword"), newPassword: fd.get("newPassword") } }), "Password changed").then((ok) => ok && form.reset());
          }}
        >
          <h3 className="text-sm font-semibold">Change password</h3>
          <Field label="Current password" error={pwErrors.currentPassword}>{(p) => <Input {...p} name="currentPassword" type="password" autoComplete="current-password" required />}</Field>
          <Field label="New password" error={pwErrors.newPassword} hint="At least 10 characters.">{(p) => <Input {...p} name="newPassword" type="password" autoComplete="new-password" minLength={10} required />}</Field>
          <Button type="submit" loading={pending === "pw"}>
            Update password
          </Button>
        </form>
        <div className="rounded-xl border border-ink-200 p-4">
          <h3 className="text-sm font-semibold">Sessions</h3>
          <p className="mt-1 text-sm text-ink-500">Sessions last 7 days in secure, HTTP-only cookies. Signing out everywhere invalidates every existing session immediately.</p>
          <Button
            className="mt-3"
            variant="outline"
            loading={pending === "revoke"}
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload after revoking sessions
            onClick={() => void call("revoke", () => apiFetch("/api/auth/me", { body: { action: "revoke-sessions" } }), "Signed out everywhere").then(() => window.location.assign("/login"))}
          >
            Sign out of all sessions
          </Button>
        </div>
      </div>
    </div>
  );
}
