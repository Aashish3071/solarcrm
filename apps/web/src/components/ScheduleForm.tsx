"use client";

import { useState } from "react";
import { completeStage, useAction } from "@/lib/client-api";
import type { ProjectDetail } from "@/lib/types";
import { Errors } from "./FormBits";

type Row = { label: string; payer: "CUSTOMER" | "BANK"; amount: string; dueDate: string };

/** FR-007 / FR-036: dated milestones for the agreed terms; must total the final cost. */
export function ScheduleForm({ p }: { p: ProjectDetail }) {
  const { run, busy, error } = useAction();
  const initial: Row[] = p.schedule.length
    ? p.schedule.map((s) => ({ label: s.label, payer: s.payer, amount: s.amount, dueDate: s.dueDate.slice(0, 10) }))
    : [{ label: "Advance", payer: "CUSTOMER", amount: "", dueDate: "" }];
  const [rows, setRows] = useState<Row[]>(initial);
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const target = Number(p.terms?.finalCost ?? 0);
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      run("PUT", `/projects/${p.id}/schedule`, { items: rows.map((r) => ({ ...r, amount: Number(r.amount) })) });
    }}>
      <p className="hint">Agreed terms: {p.terms?.paymentTerms}. The schedule must add up to the final cost.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Milestone</th><th>Payer</th><th>Amount (₹)</th><th>Due date</th><th></th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td><input aria-label={`Milestone ${i + 1} label`} value={r.label} onChange={(e) => set(i, { label: e.target.value })} required /></td>
                <td>
                  <select aria-label={`Milestone ${i + 1} payer`} value={r.payer} onChange={(e) => set(i, { payer: e.target.value as Row["payer"] })}>
                    <option value="CUSTOMER">Customer</option>
                    {p.loanRequired && <option value="BANK">Bank (loan)</option>}
                  </select>
                </td>
                <td><input aria-label={`Milestone ${i + 1} amount`} type="number" min="1" value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} required /></td>
                <td><input aria-label={`Milestone ${i + 1} due date`} type="date" value={r.dueDate} onChange={(e) => set(i, { dueDate: e.target.value })} required /></td>
                <td>{rows.length > 1 && <button type="button" className="btn sm" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove milestone ${i + 1}`}>Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={Math.abs(total - target) < 0.01 ? "hint" : "notice"} style={{ margin: "12px 0" }}>
        Scheduled ₹{total.toLocaleString("en-IN")} of ₹{target.toLocaleString("en-IN")}
      </p>
      <Errors error={error} />
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => setRows([...rows, { label: "", payer: "CUSTOMER", amount: "", dueDate: "" }])}>Add milestone</button>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save schedule"}</button>
      </div>
    </form>
  );
}

/** FR-036/037: close collection once everything is received and verified; stage 23 then runs automatically. */
export function CloseCollection({ p }: { p: ProjectDetail }) {
  const { run, busy, error } = useAction();
  const verified = p.payments.filter((x) => x.status === "APPROVED").reduce((s, x) => s + Number(x.amount), 0);
  const pending = p.payments.filter((x) => x.status === "LOGGED").length;
  const target = Number(p.terms?.finalCost ?? 0);
  return (
    <div>
      <p>Verified ₹{verified.toLocaleString("en-IN")} of ₹{target.toLocaleString("en-IN")}{pending ? ` · ${pending} payment(s) awaiting Accounts` : ""}.</p>
      <p className="hint">Closing collection calculates the sales incentive and partner commission automatically (stage 23).</p>
      <Errors error={error} />
      <button className="btn primary" disabled={busy} onClick={() => run("POST", completeStage(p.id, "PAYMENTS_COLLECTED"), { input: {} })}>
        Close payment collection
      </button>
    </div>
  );
}
