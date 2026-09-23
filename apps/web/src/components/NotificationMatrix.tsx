"use client";

import { CHANNELS, RECIPIENTS } from "@solarcrm/shared";
import { useState } from "react";
import { useAction } from "@/lib/client-api";
import { Errors } from "./FormBits";

export interface MatrixRow { event: string; label: string; recipients: string[]; channels: string[]; active: boolean }

const R_LABEL: Record<string, string> = {
  RESPONSIBLE: "Stage owner", SALES_OWNER: "Sales owner", CUSTOMER: "Customer", SITE_SUPERVISOR: "Site Supervisor",
  OFFICE_EXECUTIVE: "Office Executive", PROJECT_ENGINEER: "Project Engineer", LOAN_OFFICER: "Loan Officer",
  DISCOM_OFFICER: "DISCOM Officer", ACCOUNTS: "Accounts",
};
const C_LABEL: Record<string, string> = { IN_APP: "In-app", EMAIL: "Email", SMS: "SMS", WHATSAPP: "WhatsApp" };

function Row({ row }: { row: MatrixRow }) {
  const { run, busy, error } = useAction();
  const [r, setR] = useState(row.recipients);
  const [c, setC] = useState(row.channels);
  const [active, setActive] = useState(row.active);
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <fieldset className="action" style={{ border: 0, margin: 0 }}>
      <legend style={{ fontWeight: 600, padding: 0, marginBottom: 10 }}>{row.label}</legend>
      <div className="radio-row" style={{ flexWrap: "wrap", minHeight: 0, gap: "6px 16px" }}>
        <span className="hint" style={{ margin: 0, width: 90 }}>Recipients</span>
        {RECIPIENTS.map((x) => (
          <label key={x}><input type="checkbox" checked={r.includes(x)} onChange={() => toggle(r, setR, x)} /> {R_LABEL[x]}</label>
        ))}
      </div>
      <div className="radio-row" style={{ flexWrap: "wrap", minHeight: 0, gap: "6px 16px", margin: "8px 0" }}>
        <span className="hint" style={{ margin: 0, width: 90 }}>Channels</span>
        {CHANNELS.map((x) => (
          <label key={x}><input type="checkbox" checked={c.includes(x)} onChange={() => toggle(c, setC, x)} /> {C_LABEL[x]}</label>
        ))}
        <label style={{ marginLeft: "auto" }}><input type="checkbox" checked={active} onChange={() => setActive(!active)} /> Active</label>
      </div>
      <Errors error={error} />
      <button className="btn sm" disabled={busy} onClick={() => run("PUT", `/notifications/rules/${row.event}`, { recipients: r, channels: c, active })}>{busy ? "Saving…" : "Save"}</button>
    </fieldset>
  );
}

export function NotificationMatrix({ rows }: { rows: MatrixRow[] }) {
  return (
    <section className="card flush" style={{ marginBottom: 18 }} aria-label="Notification matrix">
      <div className="card-head"><div><h2 className="label">Notification matrix</h2><p>FR-044 · Booklet §9 defaults. Customers get SMS, WhatsApp and email; staff get in-app and email.</p></div></div>
      {rows.map((r) => <Row key={r.event} row={r} />)}
    </section>
  );
}
