import Link from "next/link";
import type { Stage } from "@solarcrm/shared";
import { inr } from "@/lib/format";
import { api } from "@/lib/server-api";
import type { ProjectListRow } from "@/lib/types";

// FR-007 – FR-009, FR-039: final terms, customer confirmation, advance payment (stages 6–8).
const NEXT: { stage: Stage; label: string; tag: string }[] = [
  { stage: "SALES_FINALIZED", label: "Finalize terms", tag: "amber" },
  { stage: "CUSTOMER_CONFIRMED", label: "Record confirmation", tag: "amber" },
  { stage: "ADVANCE_LOGGED", label: "Log advance", tag: "amber" },
  { stage: "PAYMENT_VERIFIED", label: "Awaiting Accounts", tag: "" },
];

export default async function FinalizePage() {
  const all = await api<ProjectListRow[]>("/projects");
  const rows = all.filter((p) => p.completedStages.includes("VISIT_COMPLETED") && !p.completedStages.includes("PAYMENT_VERIFIED"));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Finalize &amp; Advance</h1>
          <p>Lock package, cost and terms, record the customer&apos;s confirmation, then log the advance (FR-007 – FR-009, stages 6–8).</p>
        </div>
      </div>
      <section className="card flush">
        {rows.length === 0 ? (
          <p className="empty">No projects are waiting for finalization or advance.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Customer</th><th>Final cost</th><th>Discount</th><th>Confirmation</th><th>Next step</th><th></th></tr></thead>
              <tbody>
                {rows.map((p) => {
                  const next = NEXT.find((n) => p.availableStages.includes(n.stage));
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/projects/${p.id}`}>{p.customerName}</Link>
                        <small style={{ display: "block", color: "var(--mute)" }}>{p.code}</small>
                      </td>
                      <td>{inr(p.terms?.finalCost)}</td>
                      <td>{p.terms ? `${Number(p.terms.discountPct)}%` : "—"}</td>
                      <td>{p.terms?.confirmedAt ? <span className="tag green">Confirmed</span> : <span className="tag amber">Pending</span>}</td>
                      <td>{next && <span className={`tag ${next.tag}`}>{next.label}</span>}</td>
                      <td><Link className="btn sm" href={`/projects/${p.id}`}>Open</Link></td>
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
