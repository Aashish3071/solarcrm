import Link from "next/link";
import { STAGE_DEFS, type Stage } from "@solarcrm/shared";
import { api } from "@/lib/server-api";

interface ProjectRow {
  id: string;
  code: string;
  customerName: string;
  requiredKw: string;
  leadSource: "DIRECT" | "SALES_PARTNER";
  partnerName: string | null;
  ownerName: string | null;
  currentStage: Stage | null;
  currentStageNumber: number;
}

export default async function ProjectsPage() {
  const rows = await api<ProjectRow[]>("/projects");
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p>Every lead and project through the 23 stages (FRD §5).</p>
        </div>
      </div>
      <section className="card flush">
        {rows.length === 0 ? (
          <p className="empty">No projects yet. Leads are created from the Leads module (Phase 1).</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Project</th><th>Customer</th><th>Capacity</th><th>Source</th><th>Owner</th><th>Current stage</th></tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/projects/${p.id}`}>{p.code}</Link></td>
                    <td>{p.customerName}</td>
                    <td>{p.requiredKw} kW</td>
                    <td>{p.leadSource === "DIRECT" ? "Direct" : `Partner · ${p.partnerName ?? ""}`}</td>
                    <td>{p.ownerName}</td>
                    <td>
                      {p.currentStage ? (
                        <span className="tag amber">{p.currentStageNumber}. {STAGE_DEFS[p.currentStage].label}</span>
                      ) : (
                        <span className="tag green">Closed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
