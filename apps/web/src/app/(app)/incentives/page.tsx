import Link from "next/link";
import { dateTime, inr } from "@/lib/format";
import { api, type Me } from "@/lib/server-api";

interface Row {
  projectId: string;
  projectCode: string;
  customerName: string;
  salesName: string | null;
  partnerName: string | null;
  orderValue: string;
  discountPct: string;
  incentivePct: string | null;
  incentiveAmount: string | null;
  partnerCommissionPct: string;
  partnerCommissionAmount: string;
  provisional: boolean;
  calculatedAt: string;
}

/** FR-039 – FR-043: calculated automatically at stage 23. */
export default async function IncentivesPage() {
  const [me, rows] = await Promise.all([api<Me>("/auth/me"), api<Row[]>("/incentives")]);
  const partnerView = me.role === "SALES_PARTNER";
  const sum = (f: (r: Row) => string | null) => rows.reduce((s, r) => s + Number(f(r) ?? 0), 0);
  const avgDiscount = rows.length ? sum((r) => r.discountPct) / rows.length : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Incentives</h1>
          <p>{partnerView ? "Your partner commission on completed collections (FR-041, FR-042)." : "Sales incentive and partner commission, calculated when payment collection closes (FR-039 – FR-043)."}</p>
        </div>
      </div>
      <p className="notice" style={{ marginBottom: 18 }}>
        Provisional: the incentive formula for discounts between 3% and 4% and the partner commission rules are awaiting client confirmation (open points 10, 11). Percentages are editable in Settings.
      </p>
      <div className="grid g3">
        {!partnerView && <section className="card"><h2 className="label">Total incentive</h2><div className="stat"><b>{inr(sum((r) => r.incentiveAmount))}</b><span>{rows.length} project(s)</span></div></section>}
        <section className="card"><h2 className="label">Partner commission</h2><div className="stat"><b>{inr(sum((r) => r.partnerCommissionAmount))}</b><span>Full Sales Partners</span></div></section>
        <section className="card"><h2 className="label">Average discount</h2><div className="stat"><b>{avgDiscount.toFixed(2)}%</b><span>Ceiling 4% (FR-039)</span></div></section>
      </div>
      <section className="card flush">
        {rows.length === 0 ? <p className="empty">No incentives calculated yet. They appear when a project&apos;s payment collection is closed.</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Project</th>{!partnerView && <th>Sales</th>}<th>Partner</th><th>Order value</th><th>Discount</th>
                  {!partnerView && <th>Incentive</th>}<th>Partner commission</th><th>Calculated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.projectId}>
                    <td><Link href={`/projects/${r.projectId}`}>{r.customerName}</Link><small style={{ display: "block", color: "var(--mute)" }}>{r.projectCode}</small></td>
                    {!partnerView && <td>{r.salesName}</td>}
                    <td>{r.partnerName ?? "Direct"}</td>
                    <td>{inr(r.orderValue)}</td>
                    <td>{Number(r.discountPct)}%</td>
                    {!partnerView && <td>{inr(r.incentiveAmount)} <small style={{ color: "var(--mute)" }}>({Number(r.incentivePct)}%)</small></td>}
                    <td>{Number(r.partnerCommissionAmount) ? <>{inr(r.partnerCommissionAmount)} <small style={{ color: "var(--mute)" }}>({Number(r.partnerCommissionPct)}%)</small></> : "—"}</td>
                    <td>{dateTime(r.calculatedAt)}</td>
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
