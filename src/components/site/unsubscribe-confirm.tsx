"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";

/** Performs the opt-out from the browser (link scanners that only GET never trigger it). */
export function UnsubscribeConfirm({ token, labels }: { token: string; labels: { title: string; text: string; invalidTitle: string; invalidText: string } }) {
  const [state, setState] = useState<"pending" | "done" | "invalid">(token ? "pending" : "invalid");
  useEffect(() => {
    if (!token) return;
    fetch(`/api/email/unsubscribe?token=${encodeURIComponent(token)}`, { method: "POST" })
      .then((r) => setState(r.ok ? "done" : "invalid"))
      .catch(() => setState("invalid"));
  }, [token]);
  if (state === "pending") return <Spinner className="mx-auto h-8 w-8 text-brand-600" label="Processing" />;
  const ok = state === "done";
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <div className="text-center" role="status">
      <Icon className={ok ? "mx-auto h-10 w-10 text-emerald-600" : "mx-auto h-10 w-10 text-red-500"} aria-hidden />
      <h1 className="mt-4 text-2xl font-semibold text-ink-900">{ok ? labels.title : labels.invalidTitle}</h1>
      <p className="mt-2 text-ink-600">{ok ? labels.text : labels.invalidText}</p>
    </div>
  );
}
