"use client";

import type { ApiError } from "@/lib/client-api";

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <small className="hint">{hint}</small>}
    </div>
  );
}

export function Errors({ error }: { error: ApiError | null }) {
  if (!error) return null;
  const list = error.errors.length ? error.errors : [error.message];
  return (
    <div className="form-error" role="alert">
      {list.length === 1 ? list[0] : (
        <ul>{list.map((e) => <li key={e}>{e}</li>)}</ul>
      )}
    </div>
  );
}

/** Reads a FormData value as trimmed string, or undefined when blank. */
export function val(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function num(form: FormData, key: string): number | undefined {
  const v = val(form, key);
  return v === undefined ? undefined : Number(v);
}

