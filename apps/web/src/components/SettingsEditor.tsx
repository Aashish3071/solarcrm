"use client";

import { useState } from "react";
import { useAction } from "@/lib/client-api";
import { Errors, Field } from "./FormBits";

interface Param { key: string; value: unknown; description: string | null; updatedAt: string }
interface Override { key: string; userId: string; value: unknown }

const GROUPS: [string, string][] = [
  ["sales.", "Sales & discount"],
  ["incentive.", "Incentive"],
  ["partner.", "Partner commission"],
  ["planning.", "Planning"],
  ["masters.", "Masters (placeholder lists)"],
];

function ParamRow({ p }: { p: Param }) {
  const { run, busy, error } = useAction();
  const isList = Array.isArray(p.value);
  const [value, setValue] = useState(isList ? (p.value as string[]).join("\n") : String(p.value));
  const id = `cfg-${p.key}`;
  return (
    <form className="action" onSubmit={(e) => {
      e.preventDefault();
      const v = isList ? value.split("\n").map((x) => x.trim()).filter(Boolean) : Number(value);
      run("PUT", `/config/${encodeURIComponent(p.key)}`, { value: v });
    }}>
      <Field label={p.description ?? p.key} htmlFor={id} hint={`${p.key} · ${isList ? "one per line" : "number"}`}>
        {isList
          ? <textarea id={id} rows={Math.max(2, (p.value as string[]).length)} value={value} onChange={(e) => setValue(e.target.value)} />
          : <input id={id} type="number" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} style={{ maxWidth: 200 }} />}
      </Field>
      <Errors error={error} />
      <button className="btn sm" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
    </form>
  );
}

/** FR-043: percentages can differ per salesperson. */
function Overrides({ keys, overrides, users }: { keys: string[]; overrides: Override[]; users: { id: string; name: string; role: string }[] }) {
  const set = useAction();
  const clear = useAction();
  const sales = users.filter((u) => u.role === "SALES");
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? id;
  return (
    <div className="action">
      {overrides.length > 0 && (
        <ul className="rows" style={{ marginBottom: 14, border: "1px solid var(--line)", borderRadius: 6 }}>
          {overrides.map((o) => (
            <li key={o.key + o.userId}>
              <span>{name(o.userId)} · {o.key} = {String(o.value)}</span>
              <button className="btn sm" disabled={clear.busy} onClick={() => clear.run("DELETE", `/config/${encodeURIComponent(o.key)}/users/${o.userId}`)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        set.run("PUT", `/config/${encodeURIComponent(String(f.get("key")))}`, { value: Number(f.get("value")), userId: f.get("user") });
      }}>
        <div className="form-grid">
          <Field label="Salesperson" htmlFor="ov-user">
            <select id="ov-user" name="user" required defaultValue="">
              <option value="" disabled>Select</option>
              {sales.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label="Setting" htmlFor="ov-key">
            <select id="ov-key" name="key">{keys.map((k) => <option key={k}>{k}</option>)}</select>
          </Field>
          <Field label="Value (%)" htmlFor="ov-val"><input id="ov-val" name="value" type="number" step="0.01" min="0" max="100" required /></Field>
        </div>
        <Errors error={set.error ?? clear.error} />
        <button className="btn" type="submit" disabled={set.busy}>Add override</button>
      </form>
    </div>
  );
}

export function SettingsEditor({ params, overrides, perUserKeys, users }: { params: Param[]; overrides: Override[]; perUserKeys: string[]; users: { id: string; name: string; role: string }[] }) {
  return (
    <>
      {GROUPS.map(([prefix, title]) => {
        const rows = params.filter((p) => p.key.startsWith(prefix));
        if (!rows.length) return null;
        return (
          <section className="card flush" style={{ marginBottom: 18 }} key={prefix} aria-label={title}>
            <div className="card-head"><h2 className="label">{title}</h2></div>
            {rows.map((p) => <ParamRow key={p.key} p={p} />)}
          </section>
        );
      })}
      <section className="card flush" aria-label="Per-user overrides">
        <div className="card-head"><div><h2 className="label">Per-salesperson overrides</h2><p>FR-043: incentive percentages configurable per user.</p></div></div>
        <Overrides keys={perUserKeys} overrides={overrides} users={users} />
      </section>
    </>
  );
}
