import Link from "next/link";
import { inr } from "@/lib/format";
import { api } from "@/lib/server-api";

interface Kpis {
  period: { from: string | null; to: string | null; projects: number };
  leads: { direct: Src; partner: Src; byStage: { stage: string; count: number }[] };
  siteVisit: { avgAssignmentToVisitHours: number | null; avgScheduledVsActualHours: number | null; lateSchedulingWithReason: number };
  schedule: { avgStartDelayDays: number | null; avgEndDelayDays: number | null; rescheduledProjects: number };
  payments: { pendingVerification: number; oldestPendingHours: number | null; avgLoggedToVerifiedHours: number | null; rejected: number; verifiedTotal: number };
  loan: { projectsWithLoan: number; bankContribution: number; customerContribution: number; avgApprovalDays: number | null };
  discom: { byStatus: { status: string; count: number }[]; avgApprovalDays: number | null };
  material: { avgDispatchToSiteHours: number | null; delayed: { code: string; customer: string; reasons: string[] }[] };
  incentive: { totalIncentive: number; totalPartnerCommission: number; avgDiscountPct: number | null };
}
interface Src { leads: number; converted: number; conversionPct: number | null }

const n = (v: number | null, unit = "") => (v === null ? "—" : `${v}${unit}`);

function Kpi({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return <div className="stat"><b>{value}</b><span>{label}</span>{hint && <small className="hint">{hint}</small>}</div>;
}

/** Booklet §11 tracking areas. Layouts and exports are open point (FRD §9); this covers every KPI listed there. */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { from, to } = await searchParams;
  const qs = new URLSearchParams(Object.entries({ from, to }).filter(([, v]) => v) as [string, string][]).toString();
  const k = await api<Kpis>(`/reports/kpis${qs ? `?${qs}` : ""}`);
  const max = Math.max(1, ...k.leads.byStage.map((s) => s.count));

  return (
    <>
      <div className="page-head">
        <div><h1>Reports</h1><p>Booklet §11 KPIs for projects created in the selected period ({k.period.projects} projects).</p></div>
        <form className="head-actions" action="/reports">
          <label className="sr-only" htmlFor="rf">From</label>
          <input id="rf" type="date" name="from" defaultValue={from} style={{ width: 160 }} />
          <label className="sr-only" htmlFor="rt">To</label>
          <input id="rt" type="date" name="to" defaultValue={to} style={{ width: 160 }} />
          <button className="btn" type="submit">Apply</button>
          <Link className="btn primary" href={`/api/reports/projects.csv${qs ? `?${qs}` : ""}`} prefetch={false}>Export CSV</Link>
        </form>
      </div>

      <div className="grid g3">
        <section className="card"><h2 className="label">Leads &amp; conversion</h2><div className="stats">
          <Kpi label="Direct leads" value={k.leads.direct.leads} hint={`${n(k.leads.direct.conversionPct, "%")} converted`} />
          <Kpi label="Partner leads" value={k.leads.partner.leads} hint={`${n(k.leads.partner.conversionPct, "%")} converted`} />
        </div></section>
        <section className="card"><h2 className="label">Site visit</h2><div className="stats">
          <Kpi label="Assignment → visit (h)" value={n(k.siteVisit.avgAssignmentToVisitHours)} />
          <Kpi label="Scheduled vs actual (h)" value={n(k.siteVisit.avgScheduledVsActualHours)} />
          <Kpi label="Late with reason" value={k.siteVisit.lateSchedulingWithReason} />
        </div></section>
        <section className="card"><h2 className="label">Project schedule</h2><div className="stats">
          <Kpi label="Avg start delay (d)" value={n(k.schedule.avgStartDelayDays)} />
          <Kpi label="Avg end delay (d)" value={n(k.schedule.avgEndDelayDays)} />
          <Kpi label="Rescheduled" value={k.schedule.rescheduledProjects} />
        </div></section>
        <section className="card"><h2 className="label">Payments</h2><div className="stats">
          <Kpi label="Pending verification" value={k.payments.pendingVerification} hint={k.payments.oldestPendingHours ? `oldest ${k.payments.oldestPendingHours}h` : undefined} />
          <Kpi label="Logged → verified (h)" value={n(k.payments.avgLoggedToVerifiedHours)} />
          <Kpi label="Verified" value={inr(k.payments.verifiedTotal)} />
        </div></section>
        <section className="card"><h2 className="label">Loan</h2><div className="stats">
          <Kpi label="Customer contribution" value={inr(k.loan.customerContribution)} />
          <Kpi label="Bank contribution" value={inr(k.loan.bankContribution)} />
          <Kpi label="Approval (d)" value={n(k.loan.avgApprovalDays)} />
        </div></section>
        <section className="card"><h2 className="label">DISCOM &amp; material</h2><div className="stats">
          <Kpi label="DISCOM approval (d)" value={n(k.discom.avgApprovalDays)} />
          <Kpi label="Dispatch → site (h)" value={n(k.material.avgDispatchToSiteHours)} />
          <Kpi label="Delayed material" value={k.material.delayed.length} />
        </div></section>
        <section className="card"><h2 className="label">Incentive &amp; commission</h2><div className="stats">
          <Kpi label="Incentive paid" value={inr(k.incentive.totalIncentive)} />
          <Kpi label="Partner commission" value={inr(k.incentive.totalPartnerCommission)} />
          <Kpi label="Avg discount" value={n(k.incentive.avgDiscountPct, "%")} />
        </div></section>
      </div>

      <div className="grid g2">
        <section className="card flush" aria-labelledby="bystage">
          <div className="card-head"><h2 className="label" id="bystage">Projects by current stage</h2></div>
          <div style={{ padding: "14px 22px 18px" }}>
            {k.leads.byStage.length === 0 ? <p className="hint">No projects in this period.</p> : k.leads.byStage.map((s) => (
              <div className="bar-row" key={s.stage}><span>{s.stage}</span><div className="bar" role="img" aria-label={`${s.stage}: ${s.count}`}><i style={{ width: `${(s.count / max) * 100}%` }} /></div><span>{s.count}</span></div>
            ))}
          </div>
        </section>
        <section className="card flush" aria-labelledby="dstat">
          <div className="card-head"><h2 className="label" id="dstat">DISCOM applications by status · delayed material</h2></div>
          <ul className="rows">
            {k.discom.byStatus.map((d) => <li key={d.status}><span>{d.status.replace(/_/g, " ").toLowerCase()}</span><span>{d.count}</span></li>)}
            {k.material.delayed.map((m) => <li key={m.code}><div>{m.customer}<small>{m.code}</small></div><small>{m.reasons.join(" · ")}</small></li>)}
            {k.discom.byStatus.length + k.material.delayed.length === 0 && <li><span className="hint">Nothing to show for this period.</span></li>}
          </ul>
        </section>
      </div>
    </>
  );
}
