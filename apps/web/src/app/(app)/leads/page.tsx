import Link from "next/link";
import { STAGE_DEFS, type Stage } from "@solarcrm/shared";
import { NewLead } from "@/components/NewLead";
import { dateTime } from "@/lib/format";
import { api, type Me } from "@/lib/server-api";
import type { ProjectRow } from "@/lib/types";

// Leads are projects in FRD stages 1–5 (lead to completed site visit).
const COLUMNS: Stage[] = ["LEAD_CREATED", "REQUIREMENT_CAPTURED", "SUPERVISOR_ASSIGNED", "VISIT_SCHEDULED", "VISIT_COMPLETED"];
const NEXT_STEP: Partial<Record<Stage, string>> = {
  LEAD_CREATED: "Capture requirement",
  REQUIREMENT_CAPTURED: "Assign supervisor",
  SUPERVISOR_ASSIGNED: "Schedule visit",
  VISIT_SCHEDULED: "Record assessment",
  VISIT_COMPLETED: "Finalize terms",
};

/** The last stage a lead has completed, which is the column it sits in. */
const column = (p: ProjectRow): Stage | null => [...COLUMNS].reverse().find((s) => p.completedStages.includes(s)) ?? null;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string }> }) {
  const { view, q } = await searchParams;
  const [me, all, partners] = await Promise.all([
    api<Me>("/auth/me"),
    api<ProjectRow[]>("/projects").catch(() => [] as ProjectRow[]),
    api<{ id: string; name: string; type: string }[]>("/partners"),
  ]);
  const needle = q?.trim().toLowerCase();
  const leads = all
    .filter((p) => !p.completedStages.includes("SALES_FINALIZED"))
    .filter((p) => !needle || p.customerName.toLowerCase().includes(needle) || p.phone.includes(needle) || p.code.toLowerCase().includes(needle));
  const list = view === "list";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Leads</h1>
          <p>From first contact to a completed site visit (FR-001 – FR-006, stages 1–5).</p>
        </div>
        <div className="head-actions">
          <form role="search" action="/leads">
            {list && <input type="hidden" name="view" value="list" />}
            <label className="sr-only" htmlFor="lead-q">Search leads</label>
            <input id="lead-q" name="q" type="search" placeholder="Search name, phone or code" defaultValue={q} style={{ width: 260 }} />
          </form>
          <NewLead partners={partners} isPartner={me.role === "SALES_PARTNER"} />
        </div>
      </div>

      <nav className="tabs" aria-label="Lead views">
        <Link href={`/leads${q ? `?q=${encodeURIComponent(q)}` : ""}`} aria-current={!list ? "page" : undefined}>Kanban</Link>
        <Link href={`/leads?view=list${q ? `&q=${encodeURIComponent(q)}` : ""}`} aria-current={list ? "page" : undefined}>List</Link>
      </nav>

      {list ? (
        <section className="card flush">
          {leads.length === 0 ? <p className="empty">No leads found.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Customer</th><th>Code</th><th>Source</th><th>Capacity</th><th>Stage</th><th>Next step</th><th>Created</th></tr></thead>
                <tbody>
                  {leads.map((p) => {
                    const c = column(p);
                    return (
                      <tr key={p.id}>
                        <td><Link href={`/projects/${p.id}`}>{p.customerName}</Link></td>
                        <td>{p.code}</td>
                        <td>{p.leadSource === "DIRECT" ? "Direct" : p.partnerName}</td>
                        <td>{p.requiredKw ? `${p.requiredKw} kW` : "—"}</td>
                        <td>{c ? `${STAGE_DEFS[c].number}. ${STAGE_DEFS[c].label}` : "—"}</td>
                        <td>{c && NEXT_STEP[c]}</td>
                        <td>{dateTime(p.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <div className="kanban">
          {COLUMNS.map((s) => {
            const cards = leads.filter((p) => column(p) === s);
            return (
              <section className="kcol" key={s} aria-labelledby={`col-${s}`}>
                <h2 id={`col-${s}`}>{STAGE_DEFS[s].number}. {STAGE_DEFS[s].label} <span>{cards.length}</span></h2>
                {cards.map((p) => (
                  <Link className="kcard" key={p.id} href={`/projects/${p.id}`}>
                    <b>{p.customerName}</b>
                    <small>{p.code}{p.requiredKw ? ` · ${p.requiredKw} kW` : ""}</small>
                    <small>{p.leadSource === "DIRECT" ? "Direct" : p.partnerName} · Next: {NEXT_STEP[s]}</small>
                  </Link>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
