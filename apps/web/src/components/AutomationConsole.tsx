"use client";

import { STAGE_DEFS, STRATEGIES, type Stage } from "@solarcrm/shared";
import { useState } from "react";
import { useAction } from "@/lib/client-api";
import { Errors, Field } from "./FormBits";

export interface Rule {
  id: string;
  name: string;
  kind: "ROUTING" | "ASSIGNMENT" | "FOLLOW_UP" | "SLA";
  trigger: string;
  config: Record<string, unknown>;
  mode: "SUGGEST" | "AUTO";
  active: boolean;
  version: number;
}
export interface Person { id: string; name: string; role: string; awayUntil: string | null; maxOpen: number | null; territories: string[] }

const STRATEGY_LABEL: Record<string, string> = { ROUND_ROBIN: "Round-robin", LEAST_LOAD: "Least open work", TERRITORY: "Territory (PIN code)" };
const trig = (t: string) => (t === "LEAD_CREATED" ? "When a lead is created" : `When "${STAGE_DEFS[t as Stage]?.label ?? t}" opens`);

function RuleCard({ rule }: { rule: Rule }) {
  const save = useAction();
  const dry = useAction();
  const [result, setResult] = useState<string | null>(null);
  const c = rule.config as Record<string, any>;
  const id = (f: string) => `r-${rule.id}-${f}`;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const config: Record<string, unknown> = {};
    if (rule.kind === "ROUTING" || rule.kind === "ASSIGNMENT") config.strategy = f.get("strategy");
    if (rule.kind === "ROUTING") config.onlyPartnerLeads = f.get("partnerOnly") === "on";
    if (rule.kind === "FOLLOW_UP") {
      config.title = f.get("title");
      config.offsetsHours = String(f.get("offsets")).split(",").map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x));
    }
    if (rule.kind === "SLA") {
      config.targetHours = Number(f.get("target"));
      config.warnPct = Number(f.get("warn"));
      config.escalateTo = f.get("escalate");
    }
    save.run("PUT", `/automation/rules/${rule.id}`, {
      mode: rule.kind === "FOLLOW_UP" || rule.kind === "SLA" ? undefined : f.get("mode"),
      active: f.get("active") === "on",
      config,
    });
  }

  return (
    <form className="action" onSubmit={submit} aria-labelledby={id("name")}>
      <h3 id={id("name")}>
        {rule.name} <small>{trig(rule.trigger)} · v{rule.version}</small>
      </h3>
      <div className="form-grid">
        {(rule.kind === "ROUTING" || rule.kind === "ASSIGNMENT") && (
          <>
            <Field label="Assign by" htmlFor={id("strategy")}>
              <select id={id("strategy")} name="strategy" defaultValue={c.strategy}>
                {STRATEGIES.map((s) => <option key={s} value={s}>{STRATEGY_LABEL[s]}</option>)}
              </select>
            </Field>
            <Field label="Mode" htmlFor={id("mode")} hint="Suggest creates a task for a person to confirm; Auto assigns straight away.">
              <select id={id("mode")} name="mode" defaultValue={rule.mode}>
                <option value="SUGGEST">Suggest only</option>
                <option value="AUTO">Auto-assign</option>
              </select>
            </Field>
            <Field label="Roles" htmlFor={id("roles")}>
              <input id={id("roles")} disabled value={(c.roles ?? [c.role ?? "SALES"]).join(", ")} />
            </Field>
          </>
        )}
        {rule.kind === "FOLLOW_UP" && (
          <>
            <Field label="Task title" htmlFor={id("title")}><input id={id("title")} name="title" defaultValue={c.title} required /></Field>
            <Field label="Remind after (hours, comma separated)" htmlFor={id("offsets")}><input id={id("offsets")} name="offsets" defaultValue={(c.offsetsHours ?? []).join(", ")} required /></Field>
          </>
        )}
        {rule.kind === "SLA" && (
          <>
            <Field label="Target (hours)" htmlFor={id("target")}><input id={id("target")} name="target" type="number" min="0.5" step="0.5" defaultValue={c.targetHours} required /></Field>
            <Field label="Warn at (% of target)" htmlFor={id("warn")}><input id={id("warn")} name="warn" type="number" min="1" max="99" defaultValue={c.warnPct} required /></Field>
            <Field label="Escalate to" htmlFor={id("escalate")}>
              <select id={id("escalate")} name="escalate" defaultValue={c.escalateTo}>
                <option value="ADMIN">Manager (Admin)</option>
                <option value="PROJECT_ENGINEER">Project Engineer queue</option>
                <option value="OFFICE_EXECUTIVE">Office Executive queue</option>
                <option value="ACCOUNTS">Accounts queue</option>
              </select>
            </Field>
          </>
        )}
      </div>
      <div className="radio-row" style={{ minHeight: 0, marginBottom: 12 }}>
        <label><input type="checkbox" name="active" defaultChecked={rule.active} /> Active</label>
        {rule.kind === "ROUTING" && <label><input type="checkbox" name="partnerOnly" defaultChecked={!!c.onlyPartnerLeads} /> Only Sales Partner leads</label>}
      </div>
      <Errors error={save.error ?? dry.error} />
      {result && <p className="notice">{result}</p>}
      <div className="btn-row">
        <button className="btn primary sm" type="submit" disabled={save.busy}>{save.busy ? "Saving…" : "Save"}</button>
        {(rule.kind === "ROUTING" || rule.kind === "ASSIGNMENT") && (
          <button type="button" className="btn sm" disabled={dry.busy} onClick={async () => {
            const r = await dry.run("POST", `/automation/rules/${rule.id}/dry-run`);
            if (r) setResult(r.map((x: { role: string; pick: { reason: string } }) => `${x.role}: ${x.pick.reason}`).join("  ·  "));
          }}>Dry run</button>
        )}
      </div>
    </form>
  );
}

function PersonRow({ p }: { p: Person }) {
  const save = useAction();
  return (
    <tr>
      <td>{p.name}<small style={{ display: "block", color: "var(--mute)" }}>{p.role.replace(/_/g, " ").toLowerCase()}</small></td>
      <td colSpan={4}>
        <form className="btn-row" onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const max = String(f.get("max") ?? "").trim();
          save.run("PUT", `/automation/people/${p.id}`, {
            awayUntil: String(f.get("away") || "") || null,
            maxOpen: max ? Number(max) : null,
            territories: String(f.get("terr") ?? "").split(",").map((x) => x.trim()).filter(Boolean),
          });
        }}>
          <label className="sr-only" htmlFor={`aw-${p.id}`}>Away until</label>
          <input id={`aw-${p.id}`} name="away" type="date" defaultValue={p.awayUntil?.slice(0, 10) ?? ""} style={{ width: 150 }} title="Away until" />
          <label className="sr-only" htmlFor={`mx-${p.id}`}>Maximum open items</label>
          <input id={`mx-${p.id}`} name="max" type="number" min="1" placeholder="No cap" defaultValue={p.maxOpen ?? ""} style={{ width: 100 }} title="Maximum open items" />
          <label className="sr-only" htmlFor={`tr-${p.id}`}>Territories</label>
          <input id={`tr-${p.id}`} name="terr" placeholder="PIN prefixes e.g. 110, 4110" defaultValue={p.territories.join(", ")} style={{ width: 220 }} title="Territories" />
          <button className="btn sm" type="submit" disabled={save.busy}>Save</button>
          <Errors error={save.error} />
        </form>
      </td>
    </tr>
  );
}

export function RulesPanel({ rules }: { rules: Rule[] }) {
  const groups: [Rule["kind"], string, string][] = [
    ["ROUTING", "Lead routing", "FR-A01"],
    ["ASSIGNMENT", "Work assignment", "FR-A02"],
    ["FOLLOW_UP", "Follow-ups", "FR-A03"],
    ["SLA", "SLAs", "FR-A04"],
  ];
  return (
    <>
      {groups.map(([kind, title, src]) => (
        <section key={kind} className="card flush" style={{ marginBottom: 18 }} aria-label={title}>
          <div className="card-head"><div><h2 className="label">{title}</h2><p>{src}</p></div></div>
          {rules.filter((r) => r.kind === kind).map((r) => <RuleCard key={r.id} rule={r} />)}
        </section>
      ))}
    </>
  );
}

export function PeoplePanel({ people }: { people: Person[] }) {
  return (
    <section className="card flush">
      <div className="card-head"><div><h2 className="label">Availability &amp; capacity</h2><p>People who are away or at capacity are skipped; territories are PIN code prefixes.</p></div></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Person</th><th colSpan={4}>Away until · max open items · territories</th></tr></thead>
          <tbody>{people.map((p) => <PersonRow key={p.id} p={p} />)}</tbody>
        </table>
      </div>
    </section>
  );
}
