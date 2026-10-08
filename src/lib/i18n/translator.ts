/**
 * Client-safe translation helpers. Dictionaries passed in are already merged
 * with English, so a missing key only happens for genuinely unknown keys —
 * and even then we never render the raw key path to users.
 */
export type Messages = { [key: string]: unknown };

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function interpolate(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (name in vars ? String(vars[name]) : `{${name}}`));
}

/** Last-resort label for an unknown key: "home.hero.titleStart" → "Title start". */
function fallbackLabel(key: string) {
  const last = key.split(".").pop() ?? "";
  const spaced = last.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function createTranslator(messages: Messages) {
  function t(key: string, vars?: Record<string, string | number>): string {
    const value = getPath(messages, key);
    if (typeof value === "string") return interpolate(value, vars);
    if (process.env.NODE_ENV !== "production") console.warn(`[i18n] missing key "${key}"`);
    return fallbackLabel(key);
  }
  function list<T = string>(key: string): T[] {
    const value = getPath(messages, key);
    return Array.isArray(value) ? (value as T[]) : [];
  }
  function raw<T = unknown>(key: string): T | undefined {
    return getPath(messages, key) as T | undefined;
  }
  return { t, list, raw };
}

export type Translator = ReturnType<typeof createTranslator>;

/** Deep merge: `override` wins for every leaf it defines; arrays are replaced whole. */
export function deepMerge(base: Messages, override: Messages): Messages {
  const out: Messages = { ...base };
  for (const [k, v] of Object.entries(override)) {
    const b = base[k];
    if (v && typeof v === "object" && !Array.isArray(v) && b && typeof b === "object" && !Array.isArray(b)) {
      out[k] = deepMerge(b as Messages, v as Messages);
    } else if (v !== undefined && v !== null && v !== "") {
      out[k] = v;
    }
  }
  return out;
}

/** Flatten nested messages to dotted keys (arrays use numeric segments). */
export function flattenMessages(obj: unknown, prefix = "", out: Record<string, string> = {}) {
  if (typeof obj === "string") {
    out[prefix] = obj;
  } else if (Array.isArray(obj)) {
    obj.forEach((v, i) => flattenMessages(v, prefix ? `${prefix}.${i}` : String(i), out));
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (k === "_meta") continue;
      flattenMessages(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}

/** Set a dotted path on a (cloned) messages object; numeric segments index arrays. */
export function setPath(obj: Messages, path: string, value: string) {
  const parts = path.split(".");
  let cur: Record<string, unknown> | unknown[] = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const next = (cur as Record<string, unknown>)[part];
    if (next === null || typeof next !== "object") return;
    (cur as Record<string, unknown>)[part] = Array.isArray(next) ? [...next] : { ...(next as object) };
    cur = (cur as Record<string, unknown>)[part] as Record<string, unknown>;
  }
  (cur as Record<string, unknown>)[parts[parts.length - 1]!] = value;
}
