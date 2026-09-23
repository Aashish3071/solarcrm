import { STATUS_LABELS } from "@solarcrm/shared";
import { PageHead, QueueTable, done } from "@/components/QueueTable";
import { api } from "@/lib/server-api";
import type { ProjectListRow } from "@/lib/types";

// FR-021, FR-022, FR-034: DISCOM application, meter approval and final approval (stages 13, 21).
export default async function DiscomPage() {
  const rows = (await api<ProjectListRow[]>("/projects")).filter((p) => done(p, "PROJECT_INITIATED"));
  return (
    <>
      <PageHead title="DISCOM" sub="Submit the application with meter details and track approval through to final approval (FR-021, FR-022, FR-034)." />
      <QueueTable
        rows={rows}
        empty="No initiated projects yet."
        columns={[
          { head: "Application no.", cell: (p) => p.discom?.applicationNo ?? "—" },
          { head: "Meter no.", cell: (p) => p.discom?.meterNumber ?? "—" },
          {
            head: "Status",
            cell: (p) => {
              const s = p.discom?.status;
              const tag = done(p, "FINAL_DISCOM_APPROVED") ? "green" : s === "RETURNED" ? "red" : s ? "" : "amber";
              return <span className={`tag ${tag}`}>{s ? STATUS_LABELS[s] ?? s : "Not submitted"}</span>;
            },
          },
          { head: "DISCOM Officer", cell: (p) => p.team.DISCOM_OFFICER ?? <span className="tag amber">Not assigned</span> },
        ]}
      />
    </>
  );
}
