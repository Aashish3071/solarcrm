import Link from "next/link";
import { TaskActions } from "@/components/TaskActions";
import { remaining } from "@/lib/format";
import type { WorkData } from "@/lib/types";
import { api } from "@/lib/server-api";

const KIND = { FOLLOW_UP: "Follow-up", ASSIGNMENT: "Assignment", SLA_ESCALATION: "SLA escalation" } as const;
const QUEUE: Record<string, string> = { ADMIN: "Manager queue", ACCOUNTS: "Accounts queue", STORE_MANAGER: "Store queue", PROJECT_ENGINEER: "Engineer queue" };

function due(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/** Addendum FR-A03/A04: tasks, follow-ups and SLA clocks for the signed-in person. */
export default async function WorkPage() {
  const [w, people] = await Promise.all([api<WorkData>("/work"), api<{ id: string; name: string; role: string }[]>("/users").catch(() => [])]);
  const now = Date.now();
  return (
    <>
      <div className="page-head">
        <div><h1>My Work</h1><p>Overdue first, then due today. Follow-ups stop automatically when the stage moves on.</p></div>
      </div>
      <section className="card" style={{ marginBottom: 18 }}>
        <div className="tiles" style={{ padding: 0 }}>
          <div className={`tile ${w.counts.overdue ? "red" : ""}`}><b>{w.counts.overdue}</b><span>Overdue</span></div>
          <div className="tile amber"><b>{w.counts.dueToday}</b><span>Due today</span></div>
          <div className="tile green"><b>{w.counts.completedToday}</b><span>Completed today</span></div>
          <div className="tile"><b>{w.counts.next7Days}</b><span>Next 7 days</span></div>
        </div>
      </section>

      <div className="grid g2">
        <section className="card flush" aria-labelledby="tasks">
          <div className="card-head"><div><h2 className="label" id="tasks">Tasks</h2><p>{w.tasks.length} open</p></div></div>
          {w.tasks.length === 0 ? <p className="empty">You are all caught up.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Due</th><th>Task</th><th>Action</th></tr></thead>
                <tbody>
                  {w.tasks.map((t) => (
                    <tr key={t.id}>
                      <td>{new Date(t.dueAt).getTime() < now ? <span className="tag red">{due(t.dueAt)}</span> : due(t.dueAt)}</td>
                      <td>
                        {t.title}
                        <small style={{ display: "block", color: "var(--mute)" }}>
                          <Link href={`/projects/${t.projectId}`}>{t.customerName}</Link> · {t.projectCode} · {KIND[t.kind]}{t.queue ? ` · ${QUEUE[t.queue] ?? t.queue}` : ""}
                        </small>
                      </td>
                      <td style={{ minWidth: 230 }}><TaskActions task={t} people={people} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card flush" aria-labelledby="clocks">
          <div className="card-head"><div><h2 className="label" id="clocks">SLA clocks</h2><p>Stages you are responsible for</p></div></div>
          {w.clocks.length === 0 ? <p className="empty">No running clocks.</p> : (
            <ul className="rows">
              {w.clocks.map((c) => (
                <li key={c.projectId + c.stage}>
                  <div><Link href={`/projects/${c.projectId}`}>{c.customerName}</Link><small>{c.label} · {c.projectCode}</small></div>
                  <span className={`tag ${c.state === "BREACHED" ? "red" : c.state === "WARN" ? "amber" : "green"}`}>
                    {c.state === "PAUSED" ? "Paused" : remaining(c.remainingMs)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
