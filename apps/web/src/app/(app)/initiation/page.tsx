import { PageHead, QueueTable, done } from "@/components/QueueTable";
import { api } from "@/lib/server-api";
import type { ProjectListRow } from "@/lib/types";

// FR-011, FR-014, FR-015: initiation after approved advance, then team assignment (stage 10).
export default async function InitiationPage() {
  const all = await api<ProjectListRow[]>("/projects");
  const rows = all.filter((p) => done(p, "PAYMENT_VERIFIED") && !done(p, "PROJECT_PLANNED"));
  const who = (p: ProjectListRow, role: keyof ProjectListRow["team"], needed = true) =>
    !needed ? <span className="tag">Not required</span> : p.team[role] ?? <span className="tag amber">Not assigned</span>;
  return (
    <>
      <PageHead title="Project Initiation" sub="After Accounts approves the advance: assign the Office Executive, then the Loan Officer, DISCOM Officer and Project Engineer (FR-011, FR-014, FR-015)." />
      <QueueTable
        rows={rows}
        empty="No projects are waiting for initiation or team assignment."
        columns={[
          { head: "Office Executive", cell: (p) => (done(p, "PROJECT_INITIATED") ? p.team.OFFICE_EXECUTIVE : <span className="tag amber">Initiate project</span>) },
          { head: "Loan Officer", cell: (p) => who(p, "LOAN_OFFICER", p.loanRequired) },
          { head: "DISCOM Officer", cell: (p) => who(p, "DISCOM_OFFICER") },
          { head: "Project Engineer", cell: (p) => who(p, "PROJECT_ENGINEER") },
        ]}
      />
    </>
  );
}
