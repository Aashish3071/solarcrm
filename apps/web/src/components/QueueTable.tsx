import Link from "next/link";
import type { ProjectListRow } from "@/lib/types";

export interface Column {
  head: string;
  cell: (p: ProjectListRow) => React.ReactNode;
}

/** Module list: rows link to the project page, where the role's actions live. */
export function QueueTable({ rows, columns, empty }: { rows: ProjectListRow[]; columns: Column[]; empty: string }) {
  return (
    <section className="card flush">
      {rows.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Project</th>{columns.map((c) => <th key={c.head}>{c.head}</th>)}<th></th></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/projects/${p.id}`}>{p.customerName}</Link>
                    <small style={{ display: "block", color: "var(--mute)" }}>{p.code}{p.requiredKw ? ` · ${p.requiredKw} kW` : ""}</small>
                  </td>
                  {columns.map((c) => <td key={c.head}>{c.cell(p)}</td>)}
                  <td><Link className="btn sm" href={`/projects/${p.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function PageHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1><p>{sub}</p></div>
    </div>
  );
}

export const done = (p: ProjectListRow, s: string) => p.completedStages.includes(s as never);
export const open = (p: ProjectListRow, s: string) => p.availableStages.includes(s as never);
