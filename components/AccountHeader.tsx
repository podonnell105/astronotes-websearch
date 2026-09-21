"use client";

import { apiFetch } from "@/lib/api";
import type { AuthUser } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AccountHeader({
  user,
  stripeEnabled,
}: {
  user: AuthUser;
  stripeEnabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const logout = async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  const buy = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await apiFetch("/api/billing/checkout", { method: "POST" });
      const payload = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !payload.url) {
        throw new Error(payload.error || "Checkout failed");
      }
      window.location.href = payload.url;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checkout failed");
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-[11px] text-muted">
        {user.credits} credit{user.credits === 1 ? "" : "s"}
      </span>
      {stripeEnabled && (
        <button
          type="button"
          onClick={buy}
          disabled={busy}
          className="border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted hover:border-line-strong hover:text-ink disabled:opacity-40"
        >
          {busy ? "Checkout" : "Buy credits"}
        </button>
      )}
      <span className="hidden text-[12px] text-dim xl:inline">{user.email}</span>
      <button
        type="button"
        onClick={logout}
        className="border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted hover:border-line-strong hover:text-ink"
      >
        Sign out
      </button>
      {message && <span className="text-[11px] text-danger">{message}</span>}
    </div>
  );
}
