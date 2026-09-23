import Link from "next/link";
import { NotificationMatrix, type MatrixRow } from "@/components/NotificationMatrix";
import { SettingsEditor } from "@/components/SettingsEditor";
import { dateTime } from "@/lib/format";
import { api } from "@/lib/server-api";

interface ConfigList {
  params: { key: string; value: unknown; description: string | null; updatedAt: string }[];
  overrides: { key: string; userId: string; value: unknown }[];
  perUserKeys: string[];
}
interface Delivery { id: string; event: string; channel: string; address: string | null; status: string; attempts: number; error: string | null; createdAt: string; projectId: string | null }

/** FR-043 rules and masters; FR-044 notification matrix and delivery log. Every change is audited. */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const notif = tab === "notifications";
  const [cfg, users, matrix, log] = await Promise.all([
    notif ? null : api<ConfigList>("/config"),
    notif ? [] : api<{ id: string; name: string; role: string }[]>("/users"),
    notif ? api<MatrixRow[]>("/notifications/rules") : [],
    notif ? api<Delivery[]>("/notifications/log") : [],
  ]);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings &amp; Data</h1>
          <p>Business rules, master lists and notifications. Completed incentives keep the rules they were calculated with.</p>
        </div>
      </div>
      <nav className="tabs" aria-label="Settings sections">
        <Link href="/settings" aria-current={!notif ? "page" : undefined}>Rules &amp; masters</Link>
        <Link href="/settings?tab=notifications" aria-current={notif ? "page" : undefined}>Notifications</Link>
      </nav>
      {cfg && <SettingsEditor params={cfg.params} overrides={cfg.overrides} perUserKeys={cfg.perUserKeys} users={users} />}
      {notif && (
        <>
          <NotificationMatrix rows={matrix} />
          <section className="card flush" aria-label="Delivery log">
            <div className="card-head">
              <div><h2 className="label">Delivery log</h2><p>External messages. Without a provider (open point 14) they are marked Skipped rather than sent.</p></div>
            </div>
            {log.length === 0 ? <p className="empty">No external messages yet.</p> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Time</th><th>Event</th><th>Channel</th><th>To</th><th>Status</th></tr></thead>
                  <tbody>
                    {log.map((d) => (
                      <tr key={d.id}>
                        <td>{dateTime(d.createdAt)}</td>
                        <td>{d.event.replace(/_/g, " ").toLowerCase()}</td>
                        <td>{d.channel}</td>
                        <td>{d.address}</td>
                        <td>
                          <span className={`tag ${d.status === "SENT" ? "green" : d.status === "FAILED" ? "red" : d.status === "QUEUED" ? "" : "amber"}`}>{d.status.toLowerCase()}</span>
                          {d.error && <small style={{ display: "block", color: "var(--mute)" }}>{d.error}</small>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
