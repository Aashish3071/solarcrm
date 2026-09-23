import { STATUS_LABELS } from "@solarcrm/shared";
import { PageHead, QueueTable, done } from "@/components/QueueTable";
import { inr } from "@/lib/format";
import { api } from "@/lib/server-api";
import type { ProjectListRow } from "@/lib/types";

// FR-013, FR-016 – FR-020: loan application, approval, re-confirmation and split (stage 12).
export default async function LoanPage() {
  const rows = (await api<ProjectListRow[]>("/projects")).filter((p) => p.loanRequired && done(p, "PROJECT_INITIATED"));
  const status = (p: ProjectListRow) => {
    if (done(p, "LOAN_PROCESSED")) return <span className="tag green">Processed</span>;
    if (!p.loan) return <span className="tag amber">Not submitted</span>;
    const differs = p.loan.status === "APPROVED" && p.loan.approvedAmount && Number(p.loan.approvedAmount) !== Number(p.loan.requestedAmount);
    if (differs && !p.loan.clientReconfirmedAt) return <span className="tag amber">Awaiting client re-confirmation</span>;
    return <span className="tag">{STATUS_LABELS[p.loan.status] ?? p.loan.status}</span>;
  };
  return (
    <>
      <PageHead title="Loan Processing" sub="Submit to the bank, record the approved amount, re-confirm changes with the client (FR-016 – FR-019, stage 12)." />
      <QueueTable
        rows={rows}
        empty="No initiated projects need a loan."
        columns={[
          { head: "Bank / NBFC", cell: (p) => p.loan?.bank ?? "—" },
          { head: "Requested", cell: (p) => inr(p.loan?.requestedAmount ?? p.loanAmount) },
          { head: "Approved", cell: (p) => inr(p.loan?.approvedAmount) },
          { head: "Status", cell: status },
          { head: "Loan Officer", cell: (p) => p.team.LOAN_OFFICER ?? <span className="tag amber">Not assigned</span> },
        ]}
      />
    </>
  );
}
