import Link from "next/link";
import { ROLE_LABELS, STAGES, STAGE_DEFS, type Role } from "@solarcrm/shared";
import { StageActions } from "@/components/StageActions";
import { dateTime, inr } from "@/lib/format";
import { api, type Me } from "@/lib/server-api";
import { PAYMENT_KIND_LABEL, type ProjectDetail } from "@/lib/types";

const STATUS_TAG = { LOGGED: "amber", APPROVED: "green", REJECTED: "red" } as const;
const STATUS_TEXT = { LOGGED: "Awaiting Accounts", APPROVED: "Verified", REJECTED: "Rejected" } as const;

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, p, masters, people] = await Promise.all([
    api<Me>("/auth/me"),
    api<ProjectDetail>(`/projects/${id}`),
    api<{ projectTypes?: string[]; packages?: string[] }>("/masters"),
    api<{ id: string; name: string; role: string }[]>("/users").catch(() => []),
  ]);
  const pendingAdvance = p.payments.find((x) => x.kind === "ADVANCE" && x.status === "LOGGED") ?? null;
  const supervisorAssignedAt = p.assignments.find((a) => a.role === "SITE_SUPERVISOR")?.assignedAt ?? null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{p.code} · {p.customerName}</h1>
          <p>
            {p.requiredKw ? `${p.requiredKw} kW · ` : ""}
            {p.leadSource === "DIRECT" ? "Direct" : `Partner: ${p.partnerName}`} · {p.address}
          </p>
        </div>
        <Link className="btn" href={me.modules.includes("projects") ? "/projects" : "/leads"}>Back</Link>
      </div>

      <section className="card" style={{ marginBottom: 18 }} aria-labelledby="progress">
        <h2 className="label" id="progress">
          Progress · {p.currentStage ? `stage ${p.currentStageNumber} of 23` : "closed"}
        </h2>
        <ol className="stages">
          {STAGES.map((s) => {
            const cls = p.completedStages.includes(s) ? "done" : p.skippedStages.includes(s) ? "skip" : p.availableStages.includes(s) ? "open" : "";
            const state = cls === "done" ? "completed" : cls === "skip" ? "not required" : cls === "open" ? "open now" : "not started";
            return (
              <li key={s} className={cls} aria-label={`${STAGE_DEFS[s].number}. ${STAGE_DEFS[s].label}: ${state}`}>
                {STAGE_DEFS[s].number}. {STAGE_DEFS[s].label}
              </li>
            );
          })}
        </ol>
      </section>

      <section className="card flush" style={{ marginBottom: 18 }} aria-labelledby="todo">
        <div className="card-head">
          <div>
            <h2 className="label" id="todo">Your next steps</h2>
            <p>Every rule is checked again by the server when you save.</p>
          </div>
        </div>
        <StageActions
          projectId={p.id}
          role={me.role as Role}
          availableStages={p.availableStages}
          supervisorAssignedAt={supervisorAssignedAt}
          requiredKw={p.requiredKw}
          packageName={p.packageName}
          masters={masters}
          people={people}
          pendingAdvance={pendingAdvance && { amount: pendingAdvance.amount, mode: pendingAdvance.mode, utr: pendingAdvance.utr }}
        />
      </section>

      <div className="grid g2">
        <div>
          <section className="card flush" style={{ marginBottom: 18 }} aria-labelledby="req">
            <div className="card-head"><h2 className="label" id="req">Customer &amp; requirement</h2></div>
            <dl className="kv">
              <dt>Phone</dt><dd>{p.phone}</dd>
              {p.email && (<><dt>Email</dt><dd>{p.email}</dd></>)}
              <dt>Capacity</dt><dd>{p.requiredKw ? `${p.requiredKw} kW` : "Not captured"}</dd>
              <dt>Project type</dt><dd>{p.projectType ?? "—"}</dd>
              <dt>Package</dt><dd>{p.packageName ?? "—"}</dd>
              <dt>Loan</dt><dd>{p.completedStages.includes("REQUIREMENT_CAPTURED") ? (p.loanRequired ? inr(p.loanAmount) : "Not required") : "—"}</dd>
            </dl>
          </section>

          {p.siteVisit && (
            <section className="card flush" style={{ marginBottom: 18 }} aria-labelledby="visit">
              <div className="card-head"><h2 className="label" id="visit">Site visit</h2></div>
              <dl className="kv">
                <dt>Scheduled</dt><dd>{dateTime(p.siteVisit.scheduledAt)}</dd>
                {p.siteVisit.lateReason && (<><dt>Reason (over 24h)</dt><dd>{p.siteVisit.lateReason}</dd></>)}
                {p.siteVisit.completedAt && (
                  <>
                    <dt>Completed</dt><dd>{dateTime(p.siteVisit.completedAt)}</dd>
                    <dt>Feasible</dt><dd>{p.siteVisit.feasible ? "Yes" : "No"}</dd>
                    <dt>Feasible capacity</dt><dd>{p.siteVisit.actualKw} kW{p.requiredKw && p.siteVisit.actualKw !== p.requiredKw ? ` (requested ${p.requiredKw} kW)` : ""}</dd>
                    {p.siteVisit.suggestedPackage && (<><dt>Suggested package</dt><dd>{p.siteVisit.suggestedPackage}</dd></>)}
                    {p.siteVisit.siteNotes && (<><dt>Site details</dt><dd>{p.siteVisit.siteNotes}</dd></>)}
                    {p.siteVisit.deviations && (<><dt>Deviations</dt><dd>{p.siteVisit.deviations}</dd></>)}
                  </>
                )}
              </dl>
            </section>
          )}

          {p.terms && (
            <section className="card flush" style={{ marginBottom: 18 }} aria-labelledby="terms">
              <div className="card-head"><h2 className="label" id="terms">Final terms</h2></div>
              <dl className="kv">
                <dt>Package</dt><dd>{p.terms.packageName}</dd>
                <dt>Final cost</dt><dd>{inr(p.terms.finalCost)}</dd>
                <dt>Discount</dt><dd>{Number(p.terms.discountPct)}%</dd>
                <dt>Payment terms</dt><dd>{p.terms.paymentTerms}</dd>
                <dt>Customer confirmation</dt>
                <dd>{p.terms.confirmedAt ? `${dateTime(p.terms.confirmedAt)}${p.terms.confirmationNote ? ` · ${p.terms.confirmationNote}` : ""}` : <span className="tag amber">Pending</span>}</dd>
              </dl>
            </section>
          )}

          {p.payments.length > 0 && (
            <section className="card flush" style={{ marginBottom: 18 }} aria-labelledby="pay">
              <div className="card-head"><h2 className="label" id="pay">Payments</h2></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Type</th><th>Amount</th><th>Mode</th><th>UTR</th><th>Status</th></tr></thead>
                  <tbody>
                    {p.payments.map((x) => (
                      <tr key={x.id}>
                        <td>{PAYMENT_KIND_LABEL[x.kind]}</td>
                        <td>{inr(x.amount)}</td>
                        <td>{x.mode}</td>
                        <td>{x.utr}</td>
                        <td>
                          <span className={`tag ${STATUS_TAG[x.status]}`}>{STATUS_TEXT[x.status]}</span>
                          {x.rejectionReason && <small style={{ display: "block", color: "var(--mute)" }}>{x.rejectionReason}</small>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        <div>
          <section className="card flush" style={{ marginBottom: 18 }} aria-labelledby="team">
            <div className="card-head"><h2 className="label" id="team">Team</h2></div>
            <ul className="rows">
              <li><span>Sales owner</span><span>{p.ownerName}</span></li>
              {p.assignments.map((a) => (
                <li key={a.role}><span>{ROLE_LABELS[a.role]}</span><span>{a.name}</span></li>
              ))}
            </ul>
          </section>
          <section className="card flush" aria-labelledby="timeline">
            <div className="card-head"><h2 className="label" id="timeline">Timeline</h2></div>
            <ul className="rows">
              {p.events.map((e, i) => (
                <li key={i}>
                  <div>
                    {e.action === "REOPENED" ? "Reopened: " : ""}
                    {STAGE_DEFS[e.stage]?.label ?? e.stage}
                    <small>{ROLE_LABELS[e.actorRole] ?? e.actorRole}</small>
                  </div>
                  <small>{dateTime(e.at)}</small>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
