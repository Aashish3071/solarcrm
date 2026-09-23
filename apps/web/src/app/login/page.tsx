"use client";

import { Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      router.replace("/dashboard");
      router.refresh();
    } else {
      setError(res?.status === 401 ? "Email or password is incorrect." : "Could not reach the server. Try again.");
    }
  }

  return (
    <div className="login">
      <form onSubmit={onSubmit} noValidate>
        <div className="brand-mark" style={{ background: "#0c1726", color: "#fff" }} aria-hidden="true">
          <Sun size={20} />
        </div>
        <h1>Sign in to SolarCRM</h1>
        <p>Use your work email.</p>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
