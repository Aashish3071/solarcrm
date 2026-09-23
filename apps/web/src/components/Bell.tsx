"use client";

import { Bell as BellIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface Item { id: string; title: string; body: string; projectId: string | null; readAt: string | null; createdAt: string }

/** FR-044 in-app alerts. Polls every 60 s; opens a list anchored to the sidebar footer. */
export function Bell() {
  const [data, setData] = useState<{ unread: number; items: Item[] }>({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const btn = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/notifications").catch(() => null);
    if (r?.ok) setData(await r.json());
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function openItem(n: Item) {
    if (!n.readAt) await fetch(`/api/notifications/${n.id}/read`, { method: "POST" });
    setOpen(false);
    if (n.projectId) router.push(`/projects/${n.projectId}`);
    load();
  }

  return (
    <div style={{ position: "relative" }}>
      <button ref={btn} className="icon-btn" aria-label={`Notifications, ${data.unread} unread`} aria-expanded={open} onClick={() => setOpen((v) => !v)} style={{ position: "relative" }}>
        <BellIcon aria-hidden="true" />
        {data.unread > 0 && <span className="bell-badge" aria-hidden="true">{data.unread > 9 ? "9+" : data.unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <header>
            <b>Notifications</b>
            {data.unread > 0 && (
              <button className="btn sm" onClick={async () => { await fetch("/api/notifications/read-all", { method: "POST" }); load(); }}>Mark all read</button>
            )}
          </header>
          {data.items.length === 0 ? <p className="empty">No notifications yet.</p> : (
            <ul>
              {data.items.map((n) => (
                <li key={n.id}>
                  <button className={n.readAt ? "" : "unread"} onClick={() => openItem(n)}>
                    <span>{n.title}</span>
                    <small>{n.body}</small>
                    <small>{new Date(n.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
