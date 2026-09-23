import Link from "next/link";
import { VerifyPayment } from "@/components/LaterForms";
import { VerifyForm } from "@/components/StageActions";
import { ago, dateTime, inr } from "@/lib/format";
import { api, type Me } from "@/lib/server-api";
import { PAYMENT_KIND_LABEL, type Payment } from "@/lib/types";

interface QueueRow {
  id: string;
  projectId: string;
  projectCode: string;
  customerName: string;
  kind: Payment["kind"];
  amount: string;
  mode: string;
  utr: string;
  loggedAt: string;
}
interface HistoryRow {
  id: string;
  projectId: string;
  projectCode: string;
  customerName: string;
  kind: Payment["kind"];
  amount: string;
  utr: string;
  status: "APPROVED" | "REJECTED";
  rejectionReason: string | null;
  verifiedAt: string;
}
interface Summary {
  totalOutstanding: string;
  collectionsThisMonth: string;
  overdueReceivables: string;
  overdueProjects: number;
  pendingVerification: number;
}
interface ScheduleRow {
  projectId: string;
  projectCode: string;
  customerName: string;
  contractValue: string | null;
  verified: string;
  overdue: string;
  items: { id: string; label: string; payer: "CUSTOMER" | "BANK"; amount: string; dueDate: string }[];
}

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const [me, summary, queue, history] = await Promise.all([
    api<Me>("/auth/me"),
    api<Summary>("/payments/summary"),
    api<QueueRow[]>("/payments/queue"),
    tab === "history" ? api<HistoryRow[]>("/payments/history") : Promise.resolve([] as HistoryRow[]),
  ]);
  const schedules = tab === "schedules" ? await api<ScheduleRow[]>("/payments/schedules") : [];
  const canVerify = me.role === "ACCOUNTS" || me.role === "ADMIN";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Payments</h1>
          <p>Sales logs each payment; Accounts verifies it against the bank statement (FR-009, FR-010, FR-036 – FR-038).</p>
        </div>
      </div>

      <div className="grid g4">
        <section className="card"><h2 className="label">Total outstanding</h2><div className="stat"><b>{inr(summary.totalOutstanding)}</b><span>Confirmed contracts minus verified receipts</span></div></section>
        <section className="card"><h2 className="label">Collections this month</h2><div className="stat"><b style={{ color: "var(--green)" }}>{inr(summary.collectionsThisMonth)}</b><span>Verified by Accounts</span></div></section>
        <section className="card"><h2 className="label">Overdue receivables</h2><div className={`stat${Number(summary.overdueReceivables) ? " red" : ""}`}><b>{inr(summary.overdueReceivables)}</b><span>{summary.overdueProjects} project(s) past a scheduled due date</span></div></section>
        <section className="card"><h2 className="label">Pending verification</h2><div className={`stat${summary.pendingVerification ? " red" : ""}`}><b>{summary.pendingVerification}</b><span>Logged, not yet verified</span></div></section>
      </div>

      <nav className="tabs" aria-label="Payment views">
        <Link href="/payments" aria-current={!tab ? "page" : undefined}>Verification queue</Link>
        <Link href="/payments?tab=schedules" aria-current={tab === "schedules" ? "page" : undefined}>Schedules</Link>
        <Link href="/payments?tab=history" aria-current={tab === "history" ? "page" : undefined}>Receipt history</Link>
      </nav>

      {tab === "schedules" ? (
        <section className="card flush">
          {schedules.length === 0 ? <p className="empty">No payment schedules yet. Sales adds them on the project after finalizing terms.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Project</th><th>Milestones</th><th>Contract</th><th>Verified</th><th>Overdue</th></tr></thead>
                <tbody>
                  {schedules.map((s) => (
                    <tr key={s.projectId}>
                      <td><Link href={`/projects/${s.projectId}`}>{s.customerName}</Link><small style={{ display: "block", color: "var(--mute)" }}>{s.projectCode}</small></td>
                      <td>
                        {s.items.map((i) => (
                          <small key={i.id} style={{ display: "block" }}>{i.label} · {i.payer === "BANK" ? "Bank" : "Customer"} · {inr(i.amount)} · due {dateTime(i.dueDate).slice(0, 11)}</small>
                        ))}
                      </td>
                      <td>{inr(s.contractValue)}</td>
                      <td>{inr(s.verified)}</td>
                      <td>{Number(s.overdue) ? <span className="tag red">{inr(s.overdue)}</span> : <span className="tag green">None</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : tab === "history" ? (
        <section className="card flush">
          {history.length === 0 ? <p className="empty">No verified or rejected payments yet.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Project</th><th>Type</th><th>Amount</th><th>UTR</th><th>Result</th></tr></thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td>{dateTime(h.verifiedAt)}</td>
                      <td><Link href={`/projects/${h.projectId}`}>{h.customerName}</Link><small style={{ display: "block", color: "var(--mute)" }}>{h.projectCode}</small></td>
                      <td>{PAYMENT_KIND_LABEL[h.kind]}</td>
                      <td>{inr(h.amount)}</td>
                      <td>{h.utr}</td>
                      <td>
                        <span className={`tag ${h.status === "APPROVED" ? "green" : "red"}`}>{h.status === "APPROVED" ? "Verified" : "Rejected"}</span>
                        {h.rejectionReason && <small style={{ display: "block", color: "var(--mute)" }}>{h.rejectionReason}</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section className="card flush">
          {queue.length === 0 ? <p className="empty">Nothing is waiting for verification.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Project</th><th>Type</th><th>Amount</th><th>Mode</th><th>UTR</th><th>Waiting</th><th>{canVerify ? "Decision" : "Status"}</th></tr></thead>
                <tbody>
                  {queue.map((q) => (
                    <tr key={q.id}>
                      <td><Link href={`/projects/${q.projectId}`}>{q.customerName}</Link><small style={{ display: "block", color: "var(--mute)" }}>{q.projectCode}</small></td>
                      <td>{PAYMENT_KIND_LABEL[q.kind]}</td>
                      <td>{inr(q.amount)}</td>
                      <td>{q.mode}</td>
                      <td>{q.utr}</td>
                      <td>{ago(q.loggedAt)}</td>
                      <td style={{ minWidth: 220 }}>
                        {canVerify && q.kind === "ADVANCE" ? (
                          <VerifyForm ctx={{ projectId: q.projectId, pendingAdvance: null }} compact />
                        ) : canVerify ? (
                          <VerifyPayment projectId={q.projectId} paymentId={q.id} />
                        ) : (
                          <span className="tag amber">Awaiting Accounts</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
