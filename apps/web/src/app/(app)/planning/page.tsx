import { PageHead, QueueTable, done } from "@/components/QueueTable";
import { day } from "@/lib/format";
import { api } from "@/lib/server-api";
import type { ProjectListRow } from "@/lib/types";

// FR-023 – FR-030: revisit & design, planning, material dispatch and receipt (stages 14–18).
const material = (p: ProjectListRow) => {
  if (done(p, "RECEIVED_AT_SITE")) return <span className="tag green">Received at site</span>;
  if (done(p, "DISPATCHED")) return <span className="tag">Dispatched</span>;
  if (done(p, "MATERIAL_READY")) return <span className="tag">Ready to dispatch</span>;
  if (done(p, "PROJECT_PLANNED")) return <span className="tag amber">Preparing</span>;
  return "—";
};

export default async function PlanningPage() {
  const rows = (await api<ProjectListRow[]>("/projects")).filter((p) => done(p, "PROJECT_INITIATED") && !done(p, "INSTALLATION_DONE"));
  return (
    <>
      <PageHead title="Planning & Material" sub="Design upload, start date with auto end date, material readiness, dispatch and receipt (FR-023 – FR-030)." />
      <QueueTable
        rows={rows}
        empty="Nothing is in planning."
        columns={[
          { head: "Design", cell: (p) => (done(p, "DESIGN_UPLOADED") ? <span className="tag green">Uploaded</span> : <span className="tag amber">Pending</span>) },
          { head: "Planned start", cell: (p) => day(p.plan?.plannedStart) },
          { head: "Expected end", cell: (p) => day(p.plan?.expectedEnd) },
          { head: "Material", cell: material },
          { head: "Engineer", cell: (p) => p.team.PROJECT_ENGINEER ?? "—" },
        ]}
      />
    </>
  );
}
