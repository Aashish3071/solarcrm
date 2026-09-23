import Link from "next/link";
import { STAGES, STAGE_DEFS } from "@solarcrm/shared";
import { api, type Me } from "@/lib/server-api";
import type { WorkData } from "@/lib/types";

interface Summary {
  leads: { today: number; week: number; month: number };
  projects: { total: number; active: number; installedThisMonth: number };
  pendingVerification: number;
  myActions: { projectId: string; code: string; customerName: string; stage: string; label: string }[];
  myActionsCount: number;
}

interface ProjectRow {
  currentStage: string | null;
}

// Pipeline groups follow the FRD's stage blocks (§4.1–4.12).
const GROUPS: [string, number, number][] = [
  ["Lead & requirement", 1, 2],
  ["Site visit", 3, 5],
  ["Finalization & advance", 6, 9],
  ["Registration · loan · DISCOM", 10, 14],
  ["Planning & material", 15, 18],
  ["Installation & completion", 19, 21],
  ["Collection & incentive", 22, 23],
];

function greeting(d: Date) {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function DashboardPage() {
  const [me, s, projects, work] = await Promise.all([
    api<Me>("/auth/me"),
    api<Summary>("/dashboard/summary"),
    fetchProjects(),
    api<WorkData>("/work").catch(() => null),
  ]);
  const now = new Date();
  const date = now.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).replace(/,/g, "");

  const pipeline = GROUPS.map(([name, from, to]) => ({
    name,
    count: projects.filter((p) => {
      const n = p.currentStage ? STAGE_DEFS[p.currentStage as (typeof STAGES)[number]].number : 24;
      return n >= from && n <= to;
    }).length,
  }));
  const max = Math.max(1, ...pipeline.map((g) => g.count));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{greeting(now)}, {me.name.split(" ")[0]}</h1>
          <p>What needs attention now, what is finished, and what is coming.</p>
        </div>
        <span className="date-pill">{date}</span>
      </div>

      <div className="grid g3">
        <section className="card" aria-labelledby="today">
          <h2 className="label" id="today">Today</h2>
          <div className="stats">
            <div className="stat"><b>{s.leads.today}</b><span>New leads</span></div>
            <div className="stat"><b>{s.myActionsCount}</b><span>Waiting on you</span></div>
            <div className={`stat${s.pendingVerification ? " red" : ""}`}><b>{s.pendingVerification}</b><span>Payments to verify</span></div>
          </div>
        </section>
        <section className="card" aria-labelledby="week">
          <h2 className="label" id="week">This week</h2>
          <div className="stats">
            <div className="stat"><b>{s.leads.week}</b><span>New leads</span></div>
            <div className="stat"><b>{s.projects.active}</b><span>Active projects</span></div>
          </div>
        </section>
        <section className="card" aria-labelledby="month">
          <h2 className="label" id="month">This month</h2>
          <div className="stats">
            <div className="stat"><b>{s.leads.month}</b><span>New leads</span></div>
            <div className="stat"><b>{s.projects.installedThisMonth}</b><span>Installed</span></div>
            <div className="stat"><b>{s.projects.total}</b><span>All projects</span></div>
          </div>
        </section>
      </div>

      {work && (
        <section className="card flush" style={{ marginBottom: 18 }} aria-labelledby="glance">
          <div className="card-head"><div><h2 className="label" id="glance">Today at a glance</h2><p>Your workload right now</p></div><Link href="/work">My Work</Link></div>
          <div className="tiles">
            <div className={`tile ${work.counts.overdue ? "red" : ""}`}><b>{work.counts.overdue}</b><span>Overdue</span></div>
            <div className="tile amber"><b>{work.counts.dueToday}</b><span>Due today</span></div>
            <div className="tile green"><b>{work.counts.completedToday}</b><span>Completed today</span></div>
            <div className={`tile ${work.counts.slaBreached ? "red" : ""}`}><b>{work.counts.slaBreached}</b><span>SLA breaches</span></div>
          </div>
        </section>
      )}

      <div className="grid g2">
        <section className="card flush" aria-labelledby="myday">
          <div className="card-head">
            <div>
              <h2 className="label" id="myday">My day</h2>
              <p>Stages your role can complete now</p>
            </div>
            <Link href="/projects">All projects</Link>
          </div>
          {s.myActions.length === 0 ? (
            <p className="empty">Nothing is waiting on you.</p>
          ) : (
            <ul className="rows">
              {s.myActions.slice(0, 8).map((a) => (
                <li key={a.projectId + a.stage}>
                  <div>
                    <Link href={`/projects/${a.projectId}`}>{a.customerName}</Link>
                    <small>{a.code}</small>
                  </div>
                  <span className="tag amber">{a.label}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card flush" aria-labelledby="pipeline">
          <div className="card-head">
            <div>
              <h2 className="label" id="pipeline">Pipeline</h2>
              <p>Projects by current stage</p>
            </div>
          </div>
          <div style={{ padding: "14px 22px 18px" }}>
            {pipeline.map((g) => (
              <div className="bar-row" key={g.name}>
                <span>{g.name}</span>
                <div className="bar" role="img" aria-label={`${g.name}: ${g.count}`}><i style={{ width: `${(g.count / max) * 100}%` }} /></div>
                <span>{g.count}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

async function fetchProjects() {
  return api<ProjectRow[]>("/projects").catch(() => [] as ProjectRow[]);
}
