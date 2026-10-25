export function safeAuthNext(next: unknown, role: string) {
  const home = role === "OWNER" ? "/dashboard" : role === "CLIENT" ? "/portal" : "/staff";
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return home;
  return next === home || next.startsWith(home + "/") || next.startsWith(home + "?") ? next : home;
}
