"use client";

import { DISCOM_STATUSES, GOV_STATUSES, LOAN_STATUSES, PAYMENT_MODES, STATUS_LABELS } from "@solarcrm/shared";
import { useState } from "react";
import { completeStage, useAction } from "@/lib/client-api";
import type { ProjectDetail } from "@/lib/types";
import { Errors, Field, num, val } from "./FormBits";

type Person = { id: string; name: string; role: string };
const dateOnly = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
const today = () => new Date().toISOString().slice(0, 10);

function Submit({ busy, label, kind = "primary" }: { busy: boolean; label: string; kind?: string }) {
  return <button className={`btn ${kind}`} type="submit" disabled={busy}>{busy ? "Saving…" : label}</button>;
}

/** FR-012: portal status; "Registered" completes stage 11. */
export function GovForm({ p }: { p: ProjectDetail }) {
  const { run, busy, error } = useAction();
  const [status, setStatus] = useState(p.gov?.status ?? "SUBMITTED");
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      run("PUT", `/projects/${p.id}/gov`, { status, registrationNo: val(f, "no"), registrationDate: val(f, "date"), notes: val(f, "notes") });
    }}>
      <p className="hint">Manual mode: no government portal API is connected (open point 4). Upload the acknowledgement under Documents.</p>
      <div className="form-grid">
        <Field label="Status" htmlFor="gov-status">
          <select id="gov-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {GOV_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </Field>
        <Field label={`Registration number${status === "REGISTERED" ? "" : " (if issued)"}`} htmlFor="gov-no">
          <input id="gov-no" name="no" defaultValue={p.gov?.registrationNo ?? ""} required={status === "REGISTERED"} />
        </Field>
        {status === "REGISTERED" && (
          <Field label="Registration date" htmlFor="gov-date">
            <input id="gov-date" name="date" type="date" max={today()} required />
          </Field>
        )}
      </div>
      <Field label="Notes" htmlFor="gov-notes"><input id="gov-notes" name="notes" defaultValue={p.gov?.notes ?? ""} /></Field>
      <Errors error={error} />
      <Submit busy={busy} label={status === "REGISTERED" ? "Save and complete registration" : "Save status"} />
    </form>
  );
}

/** FR-016/017: application and the bank's decision. */
export function LoanForm({ p }: { p: ProjectDetail }) {
  const { run, busy, error } = useAction();
  const complete = useAction();
  const [status, setStatus] = useState(p.loan?.status ?? "SUBMITTED");
  const approvedDiffers = p.loan?.status === "APPROVED" && p.loan.approvedAmount !== null && Number(p.loan.approvedAmount) !== Number(p.loan.requestedAmount);
  const canComplete = p.loan?.status === "APPROVED" && (!approvedDiffers || p.loan.clientReconfirmedAt);

  return (
    <>
      <form onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run("PUT", `/projects/${p.id}/loan`, {
          bank: val(f, "bank"), status, requestedAmount: num(f, "req"), approvedAmount: status === "APPROVED" ? num(f, "appr") : undefined, notes: val(f, "notes"),
        });
      }}>
        <p className="hint">Manual mode: bank status is updated here until a bank/NBFC connector exists (open point 6).</p>
        <div className="form-grid">
          <Field label="Bank / NBFC" htmlFor="loan-bank"><input id="loan-bank" name="bank" defaultValue={p.loan?.bank ?? ""} required /></Field>
          <Field label="Status" htmlFor="loan-status">
            <select id="loan-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              {LOAN_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </Field>
          <Field label="Requested amount (₹)" htmlFor="loan-req">
            <input id="loan-req" name="req" type="number" min="1" defaultValue={p.loan?.requestedAmount ?? p.loanAmount ?? ""} required />
          </Field>
          {status === "APPROVED" && (
            <Field label="Approved amount (₹)" htmlFor="loan-appr" hint="If it differs, Sales must re-confirm with the client (FR-018).">
              <input id="loan-appr" name="appr" type="number" min="1" defaultValue={p.loan?.approvedAmount ?? ""} required />
            </Field>
          )}
        </div>
        <Field label="Notes" htmlFor="loan-notes"><input id="loan-notes" name="notes" defaultValue={p.loan?.notes ?? ""} /></Field>
        <Errors error={error} />
        <Submit busy={busy} label="Save loan status" />
      </form>
      {p.loan?.status === "APPROVED" && (
        <div style={{ marginTop: 16 }}>
          {approvedDiffers && !p.loan.clientReconfirmedAt && (
            <p className="notice">Approved amount differs from requested. Waiting for Sales to re-confirm the new terms with the client.</p>
          )}
          <Errors error={complete.error} />
          <button className="btn primary" disabled={!canComplete || complete.busy}
            onClick={() => complete.run("POST", completeStage(p.id, "LOAN_PROCESSED"), { input: {} })}>
            Complete loan processing
          </button>
        </div>
      )}
    </>
  );
}

/** FR-018: Sales re-confirms changed loan terms. */
export function LoanReconfirm({ p }: { p: ProjectDetail }) {
  const { run, busy, error } = useAction();
  return (
    <div>
      <p>The bank approved ₹{Number(p.loan!.approvedAmount).toLocaleString("en-IN")} against ₹{Number(p.loan!.requestedAmount).toLocaleString("en-IN")} requested. Confirm the new terms with the client, then record it here.</p>
      <Errors error={error} />
      <button className="btn primary" disabled={busy} onClick={() => run("POST", `/projects/${p.id}/loan/reconfirm`)}>Client has re-confirmed</button>
    </div>
  );
}

/** FR-021/022/034: application, status updates, meter and final approval. */
export function DiscomForm({ p }: { p: ProjectDetail }) {
  const { run, busy, error } = useAction();
  const [status, setStatus] = useState(p.discom?.status ?? "SUBMITTED");
  const finalBlocked = status === "FINAL_APPROVED" && !p.completedStages.includes("COMPLETED");
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      run("PUT", `/projects/${p.id}/discom`, { applicationNo: val(f, "app"), status, meterNumber: val(f, "meter"), notes: val(f, "notes") });
    }}>
      <p className="hint">Manual mode: DISCOM status is updated here (Booklet §6.2). Status list is a placeholder until the DISCOM master is supplied (open point 5).</p>
      <div className="form-grid">
        <Field label="Application number" htmlFor="dc-app"><input id="dc-app" name="app" defaultValue={p.discom?.applicationNo ?? ""} required /></Field>
        <Field label="Status" htmlFor="dc-status">
          <select id="dc-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {DISCOM_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </Field>
        <Field label="Meter number" htmlFor="dc-meter"><input id="dc-meter" name="meter" defaultValue={p.discom?.meterNumber ?? ""} required={status === "FINAL_APPROVED"} /></Field>
      </div>
      <Field label="Notes" htmlFor="dc-notes"><input id="dc-notes" name="notes" defaultValue={p.discom?.notes ?? ""} /></Field>
      {finalBlocked && <p className="notice">Final approval can be recorded after the project is completed (stage 20).</p>}
      <Errors error={error} />
      <Submit busy={busy} label={!p.discom ? "Submit application" : status === "FINAL_APPROVED" ? "Record final approval" : "Save status"} />
    </form>
  );
}

/** Generic stage completion with a small set of fields. */
export function SimpleStageForm({
  p, stage, label, fields = [], note,
}: {
  p: ProjectDetail;
  stage: string;
  label: string;
  fields?: { name: string; label: string; type?: string; required?: boolean; hint?: string; max?: string }[];
  note?: React.ReactNode;
}) {
  const { run, busy, error } = useAction();
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const input: Record<string, unknown> = {};
      for (const fd of fields) input[fd.name] = val(f, fd.name);
      run("POST", completeStage(p.id, stage), { input });
    }}>
      {note}
      {fields.length > 0 && (
        <div className="form-grid">
          {fields.map((fd) => (
            <Field key={fd.name} label={fd.label} htmlFor={`${stage}-${fd.name}`} hint={fd.hint}>
              <input id={`${stage}-${fd.name}`} name={fd.name} type={fd.type ?? "text"} required={fd.required} max={fd.max} />
            </Field>
          ))}
        </div>
      )}
      <Errors error={error} />
      <Submit busy={busy} label={label} />
    </form>
  );
}

/** FR-025: reschedule the start date. */
export function RescheduleForm({ p }: { p: ProjectDetail }) {
  const { run, busy, error } = useAction();
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn sm" onClick={() => setOpen(true)}>Reschedule start date</button>;
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      run("PUT", `/projects/${p.id}/plan/reschedule`, { startDate: val(f, "start"), reason: val(f, "reason") }).then((ok) => ok && setOpen(false));
    }}>
      <div className="form-grid">
        <Field label="New start date" htmlFor="rs-start"><input id="rs-start" name="start" type="date" defaultValue={dateOnly(p.plan?.plannedStart)} required /></Field>
        <Field label="Reason" htmlFor="rs-reason"><input id="rs-reason" name="reason" required /></Field>
      </div>
      <Errors error={error} />
      <div className="btn-row"><Submit busy={busy} label="Save new date" /><button className="btn" type="button" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}

/** FR-014/015: team assignment after initiation. */
export function AssignForm({ p, role, label, people }: { p: ProjectDetail; role: string; label: string; people: Person[] }) {
  const { run, busy, error } = useAction();
  const current = p.assignments.find((a) => a.role === role);
  return (
    <form className="assign-row" onSubmit={(e) => {
      e.preventDefault();
      run("POST", `/projects/${p.id}/assignments`, { role, userId: val(new FormData(e.currentTarget), "user") });
    }}>
      <Field label={label} htmlFor={`as-${role}`}>
        <select id={`as-${role}`} name="user" defaultValue={current?.userId ?? ""} required>
          <option value="" disabled>Select</option>
          {people.filter((x) => x.role === role).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </Field>
      <Submit busy={busy} label={current ? "Change" : "Assign"} kind="" />
      <Errors error={error} />
    </form>
  );
}

/** FR-032/035: training assignment and completion. */
export function TrainingForm({ p, people, role, meId }: { p: ProjectDetail; people: Person[]; role: string; meId: string }) {
  const assign = useAction();
  const complete = useAction();
  const assignee = people.find((x) => x.id === p.install?.trainingAssigneeId);
  const hasCert = p.documents.some((d) => d.type === "TRAINING_CERTIFICATE");
  if (p.install?.trainingCompletedAt) return <p>Training completed on {new Date(p.install.trainingCompletedAt).toLocaleDateString("en-GB")}.</p>;
  return (
    <div>
      {(role === "PROJECT_ENGINEER" || role === "ADMIN") && (
        <form onSubmit={(e) => {
          e.preventDefault();
          assign.run("PUT", `/projects/${p.id}/training`, { assigneeId: val(new FormData(e.currentTarget), "who") });
        }}>
          <div className="form-grid">
            <Field label="Client training assigned to" htmlFor="tr-who">
              <select id="tr-who" name="who" defaultValue={p.install?.trainingAssigneeId ?? ""} required>
                <option value="" disabled>Select</option>
                {people.filter((x) => ["SITE_SUPERVISOR", "PROJECT_ENGINEER", "OFFICE_EXECUTIVE"].includes(x.role)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
          </div>
          <Errors error={assign.error} />
          <Submit busy={assign.busy} label={assignee ? "Change trainer" : "Assign training"} kind="" />
        </form>
      )}
      {p.install?.trainingAssigneeId && (role === "ADMIN" || role === "PROJECT_ENGINEER" || p.install.trainingAssigneeId === meId) && (
        <div style={{ marginTop: 14 }}>
          <p className="hint">{hasCert ? "Signed training certificate uploaded." : "Upload the client-signed training certificate under Documents first."}</p>
          <Errors error={complete.error} />
          <button className="btn primary" disabled={!hasCert || complete.busy} onClick={() => complete.run("POST", `/projects/${p.id}/training/complete`)}>
            Mark training complete
          </button>
        </div>
      )}
    </div>
  );
}

/** FR-020, FR-036, FR-038: Sales logs instalments and collections. */
export function LogPaymentForm({ p }: { p: ProjectDetail }) {
  const { run, busy, error } = useAction();
  const kinds = [
    ...(p.loanRequired && p.completedStages.includes("LOAN_PROCESSED") ? [["LOAN_INSTALMENT_1", "Loan instalment 1"], ["LOAN_INSTALMENT_2", "Loan instalment 2"]] : []),
    ["COLLECTION", "Customer collection"],
  ];
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      run("POST", `/projects/${p.id}/payments`, { kind: val(f, "kind"), amount: num(f, "amount"), mode: val(f, "mode"), utr: val(f, "utr") })
        .then((ok) => ok && (e.target as HTMLFormElement).reset());
    }}>
      <div className="form-grid">
        <Field label="Payment" htmlFor="lp-kind">
          <select id="lp-kind" name="kind">{kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <Field label="Amount (₹)" htmlFor="lp-amt"><input id="lp-amt" name="amount" type="number" min="1" required /></Field>
        <Field label="Mode" htmlFor="lp-mode">
          <select id="lp-mode" name="mode" required defaultValue="">
            <option value="" disabled>Select</option>
            {PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="UTR number" htmlFor="lp-utr"><input id="lp-utr" name="utr" required autoComplete="off" /></Field>
      </div>
      <Errors error={error} />
      <Submit busy={busy} label="Log payment" />
    </form>
  );
}

/** FR-037: Accounts verifies an instalment or collection. */
export function VerifyPayment({ projectId, paymentId }: { projectId: string; paymentId: string }) {
  const approve = useAction();
  const reject = useAction();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const url = `/projects/${projectId}/payments/${paymentId}/verify`;
  if (rejecting) {
    return (
      <form onSubmit={(e) => { e.preventDefault(); reject.run("POST", url, { decision: "REJECTED", reason }); }}>
        <Field label="Reason for rejection" htmlFor={`vr-${paymentId}`}>
          <input id={`vr-${paymentId}`} value={reason} onChange={(e) => setReason(e.target.value)} required />
        </Field>
        <Errors error={reject.error} />
        <div className="btn-row">
          <button className="btn danger sm" type="submit" disabled={reject.busy}>Confirm rejection</button>
          <button className="btn sm" type="button" onClick={() => setRejecting(false)}>Cancel</button>
        </div>
      </form>
    );
  }
  return (
    <div>
      <Errors error={approve.error} />
      <div className="btn-row">
        <button className="btn primary sm" disabled={approve.busy} onClick={() => approve.run("POST", url, { decision: "APPROVED" })}>Approve</button>
        <button className="btn sm" onClick={() => setRejecting(true)}>Reject</button>
      </div>
    </div>
  );
}

export { dateOnly, today };

/** FR-A05: a manager can reassign the lead owner at any time, with a reason. */
export function OwnerForm({ p, people }: { p: ProjectDetail; people: Person[] }) {
  const { run, busy, error } = useAction();
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      run("PUT", `/projects/${p.id}/owner`, { userId: val(f, "owner"), reason: val(f, "reason") });
    }}>
      <div className="form-grid">
        <Field label="Sales owner" htmlFor="own-user">
          <select id="own-user" name="owner" required defaultValue="">
            <option value="" disabled>Select</option>
            {people.filter((x) => x.role === "SALES").map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="Reason" htmlFor="own-reason"><input id="own-reason" name="reason" required /></Field>
      </div>
      <Errors error={error} />
      <Submit busy={busy} label="Reassign owner" kind="" />
    </form>
  );
}
