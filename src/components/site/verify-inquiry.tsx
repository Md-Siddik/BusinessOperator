"use client";
import { useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
export function VerifyInquiry({ id, token }: { id: string; token: string }) {
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  return <div className="space-y-4"><h1 className="text-2xl font-semibold">Verify inquiry email</h1>
    <p>Confirm that you submitted this project inquiry so our team can send you replies and quotations.</p>
    {notice && <p role="status">{notice}</p>}
    <Button loading={pending} onClick={async () => {
      setPending(true);
      try { await apiFetch("/api/inquiries/verify", { body: { id, token } }); setNotice("Email verified. Our team can now respond to your inquiry."); }
      catch (err) { setNotice(err instanceof Error ? err.message : "Unable to verify."); }
      finally { setPending(false); }
    }}>Confirm my email</Button>
  </div>;
}
