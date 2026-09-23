import { PageHead, QueueTable, done } from "@/components/QueueTable";
import { day } from "@/lib/format";
import { api } from "@/lib/server-api";
import type { ProjectListRow } from "@/lib/types";

// FR-031 – FR-033, FR-035: execution with photos, completion certificate, client training (stages 19–20).
export default async function InstallationPage() {
  const rows = (await api<ProjectListRow[]>("/projects")).filter((p) => done(p, "RECEIVED_AT_SITE") && !(done(p, "COMPLETED") && p.install?.trainingCompletedAt));
  return (
    <>
      <PageHead title="Installation & Completion" sub="Record execution with mandatory photos, upload the signed completion certificate, then complete client training (FR-031 – FR-035)." />
      <QueueTable
        rows={rows}
        empty="No installations in progress."
        columns={[
          { head: "Execution", cell: (p) => (done(p, "INSTALLATION_DONE") ? `${day(p.plan?.actualStart)} → ${day(p.plan?.actualEnd)}` : <span className="tag amber">In progress</span>) },
          { head: "Completion", cell: (p) => (done(p, "COMPLETED") ? <span className="tag green">Completed</span> : <span className="tag">Pending</span>) },
          {
            head: "Training",
            cell: (p) => (p.install?.trainingCompletedAt ? <span className="tag green">Done</span> : p.install?.trainingAssigneeId ? <span className="tag">Assigned</span> : done(p, "COMPLETED") ? <span className="tag amber">Assign</span> : "—"),
          },
          { head: "Supervisor", cell: (p) => p.team.SITE_SUPERVISOR ?? "—" },
        ]}
      />
    </>
  );
}
