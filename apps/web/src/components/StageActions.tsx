"use client";

import { PAYMENT_MODES, STAGE_DEFS, type Role, type Stage } from "@solarcrm/shared";
import { useState } from "react";
import { completeStage, useAction } from "@/lib/client-api";
import type { ProjectDetail } from "@/lib/types";
import { Errors, Field, num, val } from "./FormBits";
import {
  AssignForm, DiscomForm, OwnerForm, GovForm, LoanForm, LoanReconfirm, LogPaymentForm, RescheduleForm,
  SimpleStageForm, TrainingForm, VerifyPayment, dateOnly, today,
} from "./LaterForms";
import { CloseCollection, ScheduleForm } from "./ScheduleForm";

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

/** Stages 2–10 use the forms below; 11–21 use LaterForms. */
const EARLY: Stage[] = [
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

function Block({ id, title, source, children }: { id: string; title: string; source?: string; children: React.ReactNode }) {
  return (
    <section className="action" aria-labelledby={`act-${id}`}>
      <h3 id={`act-${id}`}>{title} {source && <small>{source}</small>}</h3>
      {children}
    </section>
  );
}

/**
 * Everything the signed-in role can do on this project right now: stage
 * completions it owns plus the non-stage actions (assignments, reschedule,
 * training, re-confirmation, further payments). The server re-checks all of it.
 */
export function StageActions({ p, ctx, meId }: { p: ProjectDetail; ctx: ActionContext; meId: string }) {
  const role = ctx.role;
  const admin = role === "ADMIN";
  const is = (...r: Role[]) => admin || r.includes(role);
  const mine = ctx.availableStages.filter((s) => admin || STAGE_DEFS[s].actors.includes(role));
  const blocks: React.ReactNode[] = [];
  const title = (s: Stage) => `${STAGE_DEFS[s].number}. ${STAGE_DEFS[s].label}`;

  for (const s of mine) {
    const src = STAGE_DEFS[s].frd;
    if (EARLY.includes(s)) {
      blocks.push(<Block key={s} id={s} title={title(s)} source={src}><StageForm stage={s} ctx={ctx} /></Block>);
      continue;
    }
    let body: React.ReactNode;
    switch (s) {
      case "GOV_REGISTERED": body = <GovForm p={p} />; break;
      case "LOAN_PROCESSED": body = <LoanForm p={p} />; break;
      case "DISCOM_APPLIED":
      case "FINAL_DISCOM_APPROVED": body = <DiscomForm p={p} />; break;
      case "DESIGN_UPLOADED":
        body = <SimpleStageForm p={p} stage={s} label="Complete site revisit & design"
          note={<p className="hint">Upload the final site design and the installation plan under Documents first (FR-024).</p>}
          fields={[{ name: "revisitAt", label: "Site revisit date", type: "date", required: true, max: today() }, { name: "revisitNotes", label: "Revisit notes" }]} />;
        break;
      case "PROJECT_PLANNED":
        body = <SimpleStageForm p={p} stage={s} label="Save plan"
          note={<p className="hint">The expected end date is calculated automatically from the start date (FR-026).</p>}
          fields={[{ name: "startDate", label: "Project start date", type: "date", required: true }]} />;
        break;
      case "MATERIAL_READY":
      case "RECEIVED_AT_SITE": {
        const late = p.plan?.plannedStart && new Date() > new Date(p.plan.plannedStart);
        body = <SimpleStageForm p={p} stage={s} label={s === "MATERIAL_READY" ? "Mark ready to dispatch" : "Confirm received at site"}
          note={late ? <p className="notice">This is after the planned start date ({dateOnly(p.plan!.plannedStart)}), so a delay remark is required.</p> : null}
          fields={[{ name: "remark", label: late ? "Delay remark" : "Remark (optional)", required: !!late }]} />;
        break;
      }
      case "DISPATCHED":
        body = <SimpleStageForm p={p} stage={s} label="Mark dispatched" />;
        break;
      case "INSTALLATION_DONE": {
        const photos = p.documents.filter((d) => d.type === "INSTALLATION_PHOTO").length;
        body = <SimpleStageForm p={p} stage={s} label="Record execution"
          note={<p className={photos ? "hint" : "notice"}>{photos ? `${photos} installation photo(s) uploaded.` : "Upload at least one installation photo under Documents first (FR-031)."}</p>}
          fields={[{ name: "startedAt", label: "Execution start date", type: "date", required: true, max: today() }, { name: "endedAt", label: "Execution end date", type: "date", required: true, max: today() }]} />;
        break;
      }
      case "COMPLETED": {
        const cert = p.documents.some((d) => d.type === "COMPLETION_CERTIFICATE");
        body = <SimpleStageForm p={p} stage={s} label="Mark project complete"
          note={<p className={cert ? "hint" : "notice"}>{cert ? "Signed completion certificate uploaded." : "Upload the signed completion certificate under Documents first (FR-033)."} Alerts to the Office Executive arrive with notifications (Phase 3).</p>} />;
        break;
      }
      case "PAYMENTS_COLLECTED":
        body = <CloseCollection p={p} />;
        break;
      default:
        body = <p className="hint">Completed automatically by the system.</p>;
    }
    blocks.push(<Block key={s} id={s} title={title(s)} source={src}>{body}</Block>);
  }

  const initiated = p.completedStages.includes("PROJECT_INITIATED");
  if (initiated && is("OFFICE_EXECUTIVE")) {
    blocks.push(
      <Block key="team" id="team" title="Assign project team" source="FR-014">
        {p.loanRequired && <AssignForm p={p} role="LOAN_OFFICER" label="Loan Officer" people={ctx.people} />}
        <AssignForm p={p} role="DISCOM_OFFICER" label="DISCOM Officer" people={ctx.people} />
        <AssignForm p={p} role="PROJECT_ENGINEER" label="Project Engineer" people={ctx.people} />
      </Block>,
    );
  }
  if (initiated && is("PROJECT_ENGINEER") && !p.completedStages.includes("INSTALLATION_DONE")) {
    blocks.push(
      <Block key="sup" id="sup" title="Site Supervisor for execution" source="FR-015">
        <AssignForm p={p} role="SITE_SUPERVISOR" label="Site Supervisor" people={ctx.people} />
        {p.completedStages.includes("PROJECT_PLANNED") && <RescheduleForm p={p} />}
      </Block>,
    );
  }
  if (is("SALES") && p.loan?.status === "APPROVED" && p.loan.approvedAmount && Number(p.loan.approvedAmount) !== Number(p.loan.requestedAmount) && !p.loan.clientReconfirmedAt) {
    blocks.push(<Block key="reconf" id="reconf" title="Re-confirm loan terms with client" source="FR-018"><LoanReconfirm p={p} /></Block>);
  }
  if (is("DISCOM_OFFICER") && p.completedStages.includes("DISCOM_APPLIED") && !p.completedStages.includes("FINAL_DISCOM_APPROVED") && !mine.includes("FINAL_DISCOM_APPROVED")) {
    blocks.push(<Block key="dc" id="dc" title="Update DISCOM status" source="FR-022"><DiscomForm p={p} /></Block>);
  }
  if (p.completedStages.includes("COMPLETED") && (is("PROJECT_ENGINEER") || p.install?.trainingAssigneeId === meId)) {
    blocks.push(<Block key="tr" id="tr" title="Client training" source="FR-032, FR-035"><TrainingForm p={p} people={ctx.people} role={role} meId={meId} /></Block>);
  }
  if (is("SALES") && p.completedStages.includes("SALES_FINALIZED") && !p.completedStages.includes("PAYMENTS_COLLECTED")) {
    blocks.push(<Block key="sched" id="sched" title="Payment schedule" source="FR-007, FR-036"><ScheduleForm p={p} /></Block>);
  }
  if (initiated && is("SALES")) {
    blocks.push(<Block key="pay" id="pay" title="Log a payment" source="FR-020, FR-036, FR-038"><LogPaymentForm p={p} /></Block>);
  }
  const toVerify = p.payments.filter((x) => x.kind !== "ADVANCE" && x.status === "LOGGED");
  if (toVerify.length && is("ACCOUNTS")) {
    blocks.push(
      <Block key="ver" id="ver" title="Verify payments" source="FR-020, FR-037">
        {toVerify.map((x) => (
          <div key={x.id} style={{ marginBottom: 12 }}>
            <p style={{ margin: "0 0 6px" }}>{x.kind.replace(/_/g, " ").toLowerCase()} · ₹{Number(x.amount).toLocaleString("en-IN")} · {x.mode} · UTR {x.utr}</p>
            <VerifyPayment projectId={p.id} paymentId={x.id} />
          </div>
        ))}
      </Block>,
    );
  }

  if (admin && !p.completedStages.includes("INCENTIVE_CALCULATED")) {
    blocks.push(<Block key="own" id="own" title="Reassign lead owner" source="FR-A05"><OwnerForm p={p} people={ctx.people} /></Block>);
  }

  if (blocks.length === 0) return <p className="empty">Nothing here is waiting on your role.</p>;
  return <div className="actions">{blocks}</div>;
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
