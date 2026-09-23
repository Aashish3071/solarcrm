import Link from "next/link";
import type { Stage } from "@solarcrm/shared";
import { dateTime } from "@/lib/format";
import { api } from "@/lib/server-api";
import type { ProjectListRow } from "@/lib/types";

// FR-004 – FR-006: supervisor assignment, scheduling and assessment (stages 3–5).
const STATUS: { stage: Stage; label: string; tag: string }[] = [
  { stage: "SUPERVISOR_ASSIGNED", label: "Needs supervisor", tag: "amber" },
  { stage: "VISIT_SCHEDULED", label: "Needs scheduling", tag: "amber" },
  { stage: "VISIT_COMPLETED", label: "Scheduled", tag: "" },
];

export default async function SiteVisitsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams;
  const all = await api<ProjectListRow[]>("/projects");
  const done = show === "done";
  const rows = all.filter((p) =>
    done
      ? p.completedStages.includes("VISIT_COMPLETED")
      : p.completedStages.includes("REQUIREMENT_CAPTURED") && !p.completedStages.includes("VISIT_COMPLETED"),
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Site Visits</h1>
          <p>Assign a supervisor, schedule the visit and record the assessment (FR-004 – FR-006, stages 3–5).</p>
        </div>
      </div>
      <nav className="tabs" aria-label="Visit views">
        <Link href="/site-visits" aria-current={!done ? "page" : undefined}>Open</Link>
        <Link href="/site-visits?show=done" aria-current={done ? "page" : undefined}>Completed</Link>
      </nav>
      <section className="card flush">
        {rows.length === 0 ? (
          <p className="empty">{done ? "No completed visits yet." : "No visits are waiting."}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Customer</th><th>Capacity</th><th>Supervisor</th><th>Visit</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {rows.map((p) => {
                  const st = STATUS.find((s) => p.availableStages.includes(s.stage));
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/projects/${p.id}`}>{p.customerName}</Link>
                        <small style={{ display: "block", color: "var(--mute)" }}>{p.code}</small>
                      </td>
                      <td>{p.requiredKw ? `${p.requiredKw} kW` : "—"}</td>
                      <td>{p.team.SITE_SUPERVISOR ?? "Unassigned"}</td>
                      <td>{p.visit?.completedAt ? `Done ${dateTime(p.visit.completedAt)}` : dateTime(p.visit?.scheduledAt)}</td>
                      <td>
                        {done ? (
                          <span className={`tag ${p.visit?.feasible ? "green" : "red"}`}>{p.visit?.feasible ? "Feasible" : "Not feasible"}</span>
                        ) : (
                          st && <span className={`tag ${st.tag}`}>{st.label}</span>
                        )}
                      </td>
                      <td><Link className="btn sm" href={`/projects/${p.id}`}>{done ? "View" : "Open"}</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
