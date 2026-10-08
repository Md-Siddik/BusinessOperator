/** Next.js instrumentation hook — starts the registry scheduler on the Node.js server runtime. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startScheduler } = await import("./features/registry/scheduler");
  startScheduler();
}
