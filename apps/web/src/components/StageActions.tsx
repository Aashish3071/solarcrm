"use client";

import { PAYMENT_MODES, STAGE_DEFS, type Role, type Stage } from "@solarcrm/shared";
import { useState } from "react";
import { completeStage, useAction } from "@/lib/client-api";
import { Errors, Field, num, val } from "./FormBits";

export interface ActionContext {
  projectId: string;
  role: Role;
  availableStages: Stage[];
  supervisorAssignedAt: string | null;
  requiredKw: string | null;
  packageName: string | null;
  masters: { projectTypes?: string[]; packages?: string[] };
  people: { id: string; name: string; role: string }[];
  pendingAdvance: { amount: string; mode: string; utr: string } | null;
}

/** Forms for the stages Phase 1 builds (1–10). Each maps to its FRD requirement. */
const BUILT: Stage[] = [
  "REQUIREMENT_CAPTURED",
  "SUPERVISOR_ASSIGNED",
  "VISIT_SCHEDULED",
  "VISIT_COMPLETED",
  "SALES_FINALIZED",
  "CUSTOMER_CONFIRMED",
  "ADVANCE_LOGGED",
  "PAYMENT_VERIFIED",
  "PROJECT_INITIATED",
];

export function StageActions(ctx: ActionContext) {
  const mine = ctx.availableStages.filter((s) => ctx.role === "ADMIN" || STAGE_DEFS[s].actors.includes(ctx.role));
  if (mine.length === 0) {
    return <p className="empty">Nothing here is waiting on your role.</p>;
  }
  return (
    <div className="actions">
      {mine.map((s) => (
        <section key={s} className="action" aria-labelledby={`act-${s}`}>
          <h3 id={`act-${s}`}>
            {STAGE_DEFS[s].number}. {STAGE_DEFS[s].label} <small>{STAGE_DEFS[s].frd}</small>
          </h3>
          {BUILT.includes(s) ? <StageForm stage={s} ctx={ctx} /> : <p className="hint">This step's screen is built in the next part of Phase 1.</p>}
        </section>
      ))}
    </div>
  );
}

function StageForm({ stage, ctx }: { stage: Stage; ctx: ActionContext }) {
  const { run, busy, error } = useAction();
  const [loanRequired, setLoanRequired] = useState(false);
  const [visitAt, setVisitAt] = useState("");
  const id = (f: string) => `${stage}-${f}`;

  async function submit(e: React.FormEvent<HTMLFormElement>, build: (f: FormData) => Record<string, unknown>) {
    e.preventDefault();
    await run("POST", completeStage(ctx.projectId, stage), { input: build(new FormData(e.currentTarget)) });
  }

  const people = (role: string) => ctx.people.filter((p) => p.role === role);
  const submitBtn = (label: string) => (
    <button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : label}</button>
  );

  switch (stage) {
    case "REQUIREMENT_CAPTURED":
      return (
        <form onSubmit={(e) => submit(e, (f) => ({
          requiredKw: num(f, "requiredKw"),
          loanRequired,
          loanAmount: loanRequired ? num(f, "loanAmount") : undefined,
          projectType: val(f, "projectType"),
          packageName: val(f, "packageName"),
        }))}>
          <div className="form-grid">
            <Field label="Required capacity (kW)" htmlFor={id("kw")}>
              <input id={id("kw")} name="requiredKw" type="number" min="0.1" step="0.1" required />
            </Field>
            <Field label="Project type" htmlFor={id("type")} hint="Placeholder list until the client supplies masters (open point 2).">
              <select id={id("type")} name="projectType" required defaultValue="">
                <option value="" disabled>Select</option>
                {ctx.masters.projectTypes?.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Package" htmlFor={id("pkg")}>
              <select id={id("pkg")} name="packageName" required defaultValue="">
                <option value="" disabled>Select</option>
                {ctx.masters.packages?.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <fieldset className="field">
              <legend>Loan required</legend>
              <div className="radio-row">
                <label><input type="radio" name="loan" checked={!loanRequired} onChange={() => setLoanRequired(false)} /> No</label>
                <label><input type="radio" name="loan" checked={loanRequired} onChange={() => setLoanRequired(true)} /> Yes</label>
              </div>
            </fieldset>
            {loanRequired && (
              <Field label="Loan amount (₹)" htmlFor={id("loan")}>
                <input id={id("loan")} name="loanAmount" type="number" min="1" required />
              </Field>
            )}
          </div>
          <p className="hint">Indicative pricing (FR-003) appears once the pricing formula and rate masters are confirmed (open point 3).</p>
          <Errors error={error} />
          {submitBtn("Save requirement")}
        </form>
      );

    case "SUPERVISOR_ASSIGNED":
      return (
        <form onSubmit={(e) => submit(e, (f) => ({ supervisorId: val(f, "supervisorId") }))}>
          <div className="form-grid">
            <Field label="Site Supervisor" htmlFor={id("sup")}>
              <select id={id("sup")} name="supervisorId" required defaultValue="">
                <option value="" disabled>Select</option>
                {people("SITE_SUPERVISOR").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          </div>
          <Errors error={error} />
          {submitBtn("Assign supervisor")}
        </form>
      );

    case "VISIT_SCHEDULED": {
      const assigned = ctx.supervisorAssignedAt ? new Date(ctx.supervisorAssignedAt).getTime() : 0;
      const late = visitAt && new Date(visitAt).getTime() - assigned > 24 * 3600_000;
      return (
        <form onSubmit={(e) => submit(e, (f) => ({
          scheduledAt: visitAt ? new Date(visitAt).toISOString() : undefined,
          reason: val(f, "reason"),
        }))}>
          <div className="form-grid">
            <Field label="Visit date and time" htmlFor={id("at")}>
              <input id={id("at")} type="datetime-local" required value={visitAt} onChange={(e) => setVisitAt(e.target.value)} />
            </Field>
            {late && (
              <Field label="Reason for visiting after 24 hours" htmlFor={id("reason")} hint="Required when the visit is more than 24 hours after assignment (FR-005).">
                <input id={id("reason")} name="reason" required />
              </Field>
            )}
          </div>
          <Errors error={error} />
          {submitBtn("Confirm schedule")}
        </form>
      );
    }

    case "VISIT_COMPLETED":
      return (
        <form onSubmit={(e) => submit(e, (f) => ({
          feasible: val(f, "feasible") === "yes" ? true : val(f, "feasible") === "no" ? false : undefined,
          actualKw: num(f, "actualKw"),
          suggestedPackage: val(f, "suggestedPackage"),
          deviations: val(f, "deviations"),
          siteNotes: val(f, "siteNotes"),
        }))}>
          <div className="form-grid">
            <Field label="Technically feasible" htmlFor={id("feas")}>
              <select id={id("feas")} name="feasible" required defaultValue="">
                <option value="" disabled>Select</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </Field>
            <Field label="Feasible capacity (kW)" htmlFor={id("kw")} hint={ctx.requiredKw ? `Requested: ${ctx.requiredKw} kW` : undefined}>
              <input id={id("kw")} name="actualKw" type="number" min="0.1" step="0.1" required />
            </Field>
            <Field label="Suggested package change" htmlFor={id("pkg")}>
              <select id={id("pkg")} name="suggestedPackage" defaultValue="">
                <option value="">No change</option>
                {ctx.masters.packages?.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Actual site details" htmlFor={id("notes")}>
            <textarea id={id("notes")} name="siteNotes" rows={2} />
          </Field>
          <Field label="Deviations from the original requirement" htmlFor={id("dev")}>
            <textarea id={id("dev")} name="deviations" rows={2} />
          </Field>
          <p className="hint">Site photos are added with document uploads in the next part of Phase 1.</p>
          <Errors error={error} />
          {submitBtn("Submit assessment")}
        </form>
      );

    case "SALES_FINALIZED":
      return (
        <form onSubmit={(e) => submit(e, (f) => ({
          packageName: val(f, "packageName"),
          finalCost: num(f, "finalCost"),
          discountPct: num(f, "discountPct") ?? 0,
          paymentTerms: val(f, "paymentTerms"),
        }))}>
          <div className="form-grid">
            <Field label="Final package" htmlFor={id("pkg")}>
              <select id={id("pkg")} name="packageName" defaultValue={ctx.packageName ?? ""}>
                {ctx.masters.packages?.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Final cost (₹)" htmlFor={id("cost")}>
              <input id={id("cost")} name="finalCost" type="number" min="1" required />
            </Field>
            <Field label="Discount (%)" htmlFor={id("disc")} hint="Maximum 4% (FR-039).">
              <input id={id("disc")} name="discountPct" type="number" min="0" step="0.01" defaultValue="0" required />
            </Field>
          </div>
          <Field label="Payment terms" htmlFor={id("terms")} hint="For example: Advance 30%, Bank 60%, Final 10%.">
            <input id={id("terms")} name="paymentTerms" required />
          </Field>
          <Errors error={error} />
          {submitBtn("Finalize terms")}
        </form>
      );

    case "CUSTOMER_CONFIRMED":
      return (
        <form onSubmit={(e) => submit(e, (f) => ({ note: val(f, "note") }))}>
          <Field label="How the customer confirmed" htmlFor={id("note")} hint="Advance payment stays locked until this is recorded (FR-008).">
            <input id={id("note")} name="note" placeholder="For example: signed quote, WhatsApp confirmation" />
          </Field>
          <Errors error={error} />
          {submitBtn("Record confirmation")}
        </form>
      );

    case "ADVANCE_LOGGED":
      return (
        <form onSubmit={(e) => submit(e, (f) => ({ amount: num(f, "amount"), mode: val(f, "mode"), utr: val(f, "utr") }))}>
          <div className="form-grid">
            <Field label="Amount (₹)" htmlFor={id("amt")}>
              <input id={id("amt")} name="amount" type="number" min="1" required />
            </Field>
            <Field label="Payment mode" htmlFor={id("mode")}>
              <select id={id("mode")} name="mode" required defaultValue="">
                <option value="" disabled>Select</option>
                {PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="UTR number" htmlFor={id("utr")}>
              <input id={id("utr")} name="utr" required autoComplete="off" />
            </Field>
          </div>
          <Errors error={error} />
          {submitBtn("Log payment")}
        </form>
      );

    case "PAYMENT_VERIFIED":
      return <VerifyForm ctx={ctx} />;

    case "PROJECT_INITIATED":
      return (
        <form onSubmit={(e) => submit(e, (f) => ({ officeExecutiveId: val(f, "oe") }))}>
          <div className="form-grid">
            <Field label="Office Executive" htmlFor={id("oe")}>
              <select id={id("oe")} name="oe" required defaultValue="">
                <option value="" disabled>Select</option>
                {people("OFFICE_EXECUTIVE").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          </div>
          <Errors error={error} />
          {submitBtn("Initiate project")}
        </form>
      );

    default:
      return null;
  }
}

/** FR-010: approve, or reject with a reason (sends the advance back to Sales). */
export function VerifyForm({ ctx, compact }: { ctx: Pick<ActionContext, "projectId" | "pendingAdvance">; compact?: boolean }) {
  const approve = useAction();
  const reject = useAction();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <div>
      {!compact && ctx.pendingAdvance && (
        <p className="hint">
          Check against the bank statement: ₹{Number(ctx.pendingAdvance.amount).toLocaleString("en-IN")} · {ctx.pendingAdvance.mode} · UTR {ctx.pendingAdvance.utr}
        </p>
      )}
      {rejecting ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await reject.run("POST", `/projects/${ctx.projectId}/payment-rejection`, { reason })) setRejecting(false);
          }}
        >
          <Field label="Reason for rejection" htmlFor={`rej-${ctx.projectId}`}>
            <input id={`rej-${ctx.projectId}`} value={reason} onChange={(e) => setReason(e.target.value)} required />
          </Field>
          <Errors error={reject.error} />
          <div className="btn-row">
            <button className="btn danger" type="submit" disabled={reject.busy}>Confirm rejection</button>
            <button className="btn" type="button" onClick={() => setRejecting(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <Errors error={approve.error} />
          <div className="btn-row">
            <button
              className="btn primary"
              disabled={approve.busy}
              onClick={() => approve.run("POST", completeStage(ctx.projectId, "PAYMENT_VERIFIED"), { input: { decision: "APPROVED" } })}
            >
              Approve
            </button>
            <button className="btn" onClick={() => setRejecting(true)}>Reject</button>
          </div>
        </>
      )}
    </div>
  );
}
