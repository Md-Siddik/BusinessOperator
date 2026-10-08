"use client";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

/** JSON (or multipart) fetch with consistent error handling — never exposes stack traces. */
export async function apiFetch<T = unknown>(url: string, opts: { method?: string; body?: unknown; formData?: FormData } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body || opts.formData ? "POST" : "GET"),
      headers: opts.formData ? undefined : { "Content-Type": "application/json" },
      body: opts.formData ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "Network error — please check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: { message?: string; fieldErrors?: Record<string, string[]> } }).error;
    throw new ApiError(res.status, err?.message ?? "Something went wrong. Please try again.", err?.fieldErrors);
  }
  return data as T;
}
