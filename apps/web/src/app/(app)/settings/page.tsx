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
interface Integrations {
  inbound: { key: string; label: string; configured: boolean; url: string }[];
  outbound: { key: string; label: string; configured: boolean; counts: Record<string, number> }[];
  log: { id: string; connector: string; direction: string; event: string; status: string; at: string }[];
}
interface Delivery { id: string; event: string; channel: string; address: string | null; status: string; attempts: number; error: string | null; createdAt: string; projectId: string | null }

/** FR-043 rules and masters; FR-044 notification matrix and delivery log. Every change is audited. */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const notif = tab === "notifications";
  const integ = tab === "integrations";
  const [cfg, users, matrix, log] = await Promise.all([
    notif || integ ? null : api<ConfigList>("/config"),
    notif || integ ? [] : api<{ id: string; name: string; role: string }[]>("/users"),
    notif ? api<MatrixRow[]>("/notifications/rules") : [],
    notif ? api<Delivery[]>("/notifications/log") : [],
  ]);
  const ints = integ ? await api<Integrations>("/integrations/status") : null;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings &amp; Data</h1>
          <p>Business rules, master lists and notifications. Completed incentives keep the rules they were calculated with.</p>
        </div>
      </div>
      <nav className="tabs" aria-label="Settings sections">
        <Link href="/settings" aria-current={!notif && !integ ? "page" : undefined}>Rules &amp; masters</Link>
        <Link href="/settings?tab=notifications" aria-current={notif ? "page" : undefined}>Notifications</Link>
        <Link href="/settings?tab=integrations" aria-current={integ ? "page" : undefined}>Integrations</Link>
      </nav>
      {cfg && <SettingsEditor params={cfg.params} overrides={cfg.overrides} perUserKeys={cfg.perUserKeys} users={users} />}
      {ints && (
        <>
          <section className="card flush" style={{ marginBottom: 18 }} aria-label="Connectors">
            <div className="card-head"><div><h2 className="label">Connectors</h2><p>Booklet §6–7. Manual screens always work; connectors add automation when configured on the server.</p></div></div>
            <ul className="rows">
              {ints.inbound.map((c) => (
                <li key={c.key}><div>{c.label}<small>Inbound webhook · POST {c.url} · HMAC-SHA256 signed</small></div><span className={`tag ${c.configured ? "green" : ""}`}>{c.configured ? "Configured" : "Not configured"}</span></li>
              ))}
              {ints.outbound.map((c) => (
                <li key={c.key}>
                  <div>{c.label}<small>Outbound, one-way · {Object.entries(c.counts).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(" · ") || "nothing queued"}</small></div>
                  <span className={`tag ${c.configured ? "green" : ""}`}>{c.configured ? "Configured" : "Not configured"}</span>
                </li>
              ))}
              <li><div>Government portal · Bank / NBFC<small>No public APIs identified yet (open points 4, 6); manual status screens are used.</small></div><span className="tag">Manual</span></li>
            </ul>
          </section>
          <section className="card flush" aria-label="Integration log">
            <div className="card-head"><h2 className="label">Integration log</h2></div>
            {ints.log.length === 0 ? <p className="empty">No integration calls yet.</p> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Time</th><th>Connector</th><th>Direction</th><th>Event</th><th>Result</th></tr></thead>
                <tbody>{ints.log.map((l) => (
                  <tr key={l.id}><td>{dateTime(l.at)}</td><td>{l.connector}</td><td>{l.direction.toLowerCase()}</td><td>{l.event}</td><td><span className={`tag ${l.status.startsWith("2") ? "green" : "red"}`}>{l.status}</span></td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
        </>
      )}
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
