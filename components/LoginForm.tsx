"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        mode === "signup" ? "/api/auth/signup" : "/api/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Authentication failed");
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-sm">
      <p className="mb-6 text-[15px] text-muted">
        {mode === "signup" ? "Create an analyst account." : "Sign in to run research."}
      </p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="block">
          <div className="label mb-1">Email</div>
          <input
            className="auth-input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label className="block">
          <div className="label mb-1">Password</div>
          <input
            className="auth-input"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={8}
          />
        </label>
        {error && <p className="text-[12px] text-danger">{error}</p>}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted hover:text-ink"
          >
            {mode === "login" ? "Create account" : "Have an account"}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="border border-line-strong bg-panel-2 px-4 py-1.5 text-[12px] tracking-wide text-ink hover:border-accent/50 hover:text-accent disabled:opacity-40"
          >
            {busy ? "Working" : mode === "signup" ? "Sign up" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}