import Link from "next/link";
import { PeoplePanel, RulesPanel, type Person, type Rule } from "@/components/AutomationConsole";
import { dateTime } from "@/lib/format";
import { api } from "@/lib/server-api";

interface Run { id: string; rule: string; projectId: string | null; outcome: string; detail: Record<string, unknown>; at: string }

const OUTCOME: Record<string, string> = {
  ASSIGNED: "Assigned", SUGGESTED: "Suggested", NO_CANDIDATE: "No one available", AUTO_FAILED: "Auto-assign failed",
  FOLLOW_UPS_CREATED: "Follow-ups created", SLA_STARTED: "SLA started", SLA_WARNING: "SLA warning", SLA_BREACHED: "SLA breached",
};

/** Addendum FR-A01 – A05: rules, availability and run log. */
export default async function AutomationPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const [rules, people, runs] = await Promise.all([
    tab ? Promise.resolve([] as Rule[]) : api<Rule[]>("/automation/rules"),
    tab === "people" ? api<Person[]>("/automation/people") : Promise.resolve([] as Person[]),
    tab === "runs" ? api<Run[]>("/automation/runs") : Promise.resolve([] as Run[]),
  ]);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Automation</h1>
          <p>Routing, work assignment, follow-ups and SLAs. Rules are data; every change is versioned and audited, and every run is logged.</p>
        </div>
      </div>
      <nav className="tabs" aria-label="Automation views">
        <Link href="/automation" aria-current={!tab ? "page" : undefined}>Rules</Link>
        <Link href="/automation?tab=people" aria-current={tab === "people" ? "page" : undefined}>Availability</Link>
        <Link href="/automation?tab=runs" aria-current={tab === "runs" ? "page" : undefined}>Run log</Link>
      </nav>
      {!tab && <RulesPanel rules={rules} />}
      {tab === "people" && <PeoplePanel people={people} />}
      {tab === "runs" && (
        <section className="card flush">
          {runs.length === 0 ? <p className="empty">No automation runs yet.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Time</th><th>Rule</th><th>Outcome</th><th>Detail</th><th></th></tr></thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td>{dateTime(r.at)}</td>
                      <td>{r.rule}</td>
                      <td><span className={`tag ${r.outcome.includes("BREACH") || r.outcome.includes("FAIL") || r.outcome === "NO_CANDIDATE" ? "red" : r.outcome.includes("WARN") ? "amber" : ""}`}>{OUTCOME[r.outcome] ?? r.outcome}</span></td>
                      <td><small>{String(r.detail.reason ?? r.detail.stage ?? "")}</small></td>
                      <td>{r.projectId && <Link className="btn sm" href={`/projects/${r.projectId}`}>Open</Link>}</td>
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
