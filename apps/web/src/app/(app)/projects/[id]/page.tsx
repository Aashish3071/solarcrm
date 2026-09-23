import Link from "next/link";
import { ROLE_LABELS, STAGES, STAGE_DEFS, type Role, type Stage } from "@solarcrm/shared";
import { api } from "@/lib/server-api";

interface ProjectDetail {
  id: string;
  code: string;
  customerName: string;
  phone: string;
  address: string;
  requiredKw: string;
  loanRequired: boolean;
  leadSource: "DIRECT" | "SALES_PARTNER";
  partnerName: string | null;
  ownerName: string | null;
  completedStages: string[];
  skippedStages: string[];
  currentStage: Stage | null;
  currentStageNumber: number;
  availableStages: Stage[];
  assignments: { role: Role; name: string; assignedAt: string }[];
  events: { stage: Stage; action: "COMPLETED" | "REOPENED"; actorRole: Role; at: string }[];
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await api<ProjectDetail>(`/projects/${id}`);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{p.code}</h1>
          <p>
            {p.customerName} · {p.requiredKw} kW · {p.leadSource === "DIRECT" ? "Direct" : `Partner: ${p.partnerName}`}
          </p>
        </div>
        <Link className="btn" href="/projects">Back to projects</Link>
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

      <div className="grid g2">
        <section className="card flush" aria-labelledby="team">
          <div className="card-head"><h2 className="label" id="team">Team</h2></div>
          <ul className="rows">
            <li><span>Sales owner</span><span>{p.ownerName}</span></li>
            {p.assignments.map((a) => (
              <li key={a.role}><span>{ROLE_LABELS[a.role]}</span><span>{a.name}</span></li>
            ))}
          </ul>
          <div className="card-head" style={{ borderTop: "1px solid var(--line)" }}><h2 className="label">Open now</h2></div>
          <ul className="rows">
            {p.availableStages.length === 0 ? (
              <li><span>No open stages.</span></li>
            ) : (
              p.availableStages.map((s) => (
                <li key={s}>
                  <span>{STAGE_DEFS[s].number}. {STAGE_DEFS[s].label}</span>
                  <small>{STAGE_DEFS[s].system ? "System" : STAGE_DEFS[s].actors.map((r) => ROLE_LABELS[r]).join(", ")}</small>
                </li>
              ))
            )}
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
                <small>{fmt(e.at)}</small>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
