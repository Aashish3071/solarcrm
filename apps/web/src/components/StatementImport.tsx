"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Errors, Field } from "./FormBits";

/** Booklet §6.4: Accounts imports the bank statement; the queue then shows UTR matches. */
export function StatementImport() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; errors: string[] } | null>(null);
  const [result, setResult] = useState<string | null>(null);

  if (!open) return <button className="btn" onClick={() => setOpen(true)}>Import bank statement (CSV)</button>;
  return (
    <form className="card" style={{ marginBottom: 18 }} onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setError(null);
      const res = await fetch("/api/payments/statements", { method: "POST", body: new FormData(e.currentTarget) }).catch(() => null);
      const body = await res?.json().catch(() => null);
      setBusy(false);
      if (res?.ok) {
        setResult(`${body.added} new credit line(s) imported${body.duplicates ? `, ${body.duplicates} already imported` : ""}. ${body.pendingMatched} of ${body.pendingTotal} waiting payment(s) now match.${body.skippedRows?.length ? ` ${body.skippedRows.length} row(s) could not be read.` : ""}`);
        router.refresh();
      } else setError({ message: body?.message ?? "Import failed.", errors: body?.errors ?? [] });
    }}>
      <h2 className="label">Import bank statement</h2>
      <p className="hint">CSV with a header row: date, credit/amount, and UTR/reference or narration columns. Matching only helps you check; you still approve each payment.</p>
      <Field label="Statement file" htmlFor="stmt"><input id="stmt" name="file" type="file" accept=".csv,text/csv" required /></Field>
      <Errors error={error} />
      {result && <p className="notice" role="status">{result}</p>}
      <div className="btn-row">
        <button className="btn primary" type="submit" disabled={busy}>{busy ? "Importing…" : "Import"}</button>
        <button className="btn" type="button" onClick={() => { setOpen(false); setResult(null); }}>Close</button>
      </div>
    </form>
  );
}
