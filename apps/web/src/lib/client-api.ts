"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface ApiError {
  message: string;
  errors: string[];
}

async function send(method: string, path: string, body?: unknown): Promise<{ ok: true; data: any } | { ok: false; error: ApiError }> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: { message: "Could not reach the server.", errors: [] } };
  }
  const data = await res.json().catch(() => null);
  if (res.ok) return { ok: true, data };
  if (res.status === 401) window.location.href = "/login";
  const errors: string[] = Array.isArray(data?.errors) ? data.errors : [];
  return { ok: false, error: { message: data?.message ?? "Something went wrong.", errors } };
}

/**
 * Runs a mutation, shows server-side rule errors, and refreshes server
 * components on success. The server is the authority for every rule.
 */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  /** Returns the response body on success (truthy), or null on failure. */
  async function run(method: string, path: string, body?: unknown): Promise<any> {
    setBusy(true);
    setError(null);
    const r = await send(method, path, body);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return null;
    }
    router.refresh();
    return r.data ?? true;
  }

  return { run, busy, error, clear: () => setError(null) };
}

export const completeStage = (projectId: string, stage: string) => `/projects/${projectId}/stages/${stage}/complete`;
