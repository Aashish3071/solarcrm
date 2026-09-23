import { STATUS_LABELS } from "@solarcrm/shared";
import { PageHead, QueueTable, done } from "@/components/QueueTable";
import { api } from "@/lib/server-api";
import type { ProjectListRow } from "@/lib/types";

// FR-012: government portal registration (stage 11), manual until an API exists.
export default async function GovPage() {
  const rows = (await api<ProjectListRow[]>("/projects")).filter((p) => done(p, "PROJECT_INITIATED"));
  return (
    <>
      <PageHead title="Government Registration" sub="Register each project on the government portal and record the registration date (FR-012, stage 11)." />
      <QueueTable
        rows={rows}
        empty="No initiated projects yet."
        columns={[
          { head: "Status", cell: (p) => <span className={`tag ${done(p, "GOV_REGISTERED") ? "green" : "amber"}`}>{STATUS_LABELS[p.gov?.status ?? "NOT_STARTED"]}</span> },
          { head: "Registration no.", cell: (p) => p.gov?.registrationNo ?? "—" },
          { head: "Office Executive", cell: (p) => p.team.OFFICE_EXECUTIVE ?? "—" },
        ]}
      />
    </>
  );
}
