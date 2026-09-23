"use client";

import { DOCUMENT_LABELS, DOCUMENT_TYPES, UPLOAD_MAX_BYTES, canUpload, type DocumentType, type Role } from "@solarcrm/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ProjectDetail } from "@/lib/types";
import { Errors, Field } from "./FormBits";

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

/** FRD §7 documents: upload by permitted role, view within project scope. */
export function Documents({ p, role }: { p: ProjectDetail; role: Role }) {
  const allowed = DOCUMENT_TYPES.filter((t) => canUpload(role, t));
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; errors: string[] } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const file = fd.get("file");
    if (file instanceof File && file.size > UPLOAD_MAX_BYTES) {
      setError({ message: "Files must be 10 MB or smaller.", errors: [] });
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/projects/${p.id}/documents`, { method: "POST", body: fd }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      form.reset();
      router.refresh();
    } else {
      const body = await res?.json().catch(() => null);
      setError({ message: body?.message ?? "Upload failed.", errors: Array.isArray(body?.errors) ? body.errors : [] });
    }
  }

  return (
    <>
      {p.documents.length === 0 ? (
        <p className="empty">No documents yet.</p>
      ) : (
        <ul className="rows">
          {p.documents.map((d) => (
            <li key={d.id}>
              <div>
                <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noopener noreferrer">{d.fileName}</a>
                <small>{DOCUMENT_LABELS[d.type as DocumentType] ?? d.type} · {kb(d.size)}</small>
              </div>
              <small>{new Date(d.uploadedAt).toLocaleDateString("en-GB")}</small>
            </li>
          ))}
        </ul>
      )}
      {allowed.length > 0 && (
        <form onSubmit={onSubmit} style={{ padding: "16px 22px", borderTop: "1px solid var(--line)" }}>
          <div className="form-grid">
            <Field label="Document type" htmlFor="doc-type">
              <select id="doc-type" name="type" required defaultValue="">
                <option value="" disabled>Select</option>
                {allowed.map((t) => <option key={t} value={t}>{DOCUMENT_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="File" htmlFor="doc-file" hint="PDF, JPEG, PNG or WebP, up to 10 MB.">
              <input id="doc-file" name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required />
            </Field>
          </div>
          <Errors error={error} />
          <button className="btn" type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload"}</button>
        </form>
      )}
    </>
  );
}
